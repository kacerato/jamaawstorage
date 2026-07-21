BEGIN;

-- Compatibilidade para bancos em que a migration 050 ainda nao foi aplicada.
-- Em uma execucao normal pelo runner este bloco e idempotente; no editor SQL,
-- evita que a 051 dependa da criacao manual previa do ledger de devolucoes.
CREATE TABLE IF NOT EXISTS public.stock_return_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  return_request_id UUID NOT NULL REFERENCES public.stock_return_requests(id) ON DELETE CASCADE,
  event_type TEXT NOT NULL CHECK (event_type IN ('received', 'held_for_triage', 'returned_to_stock')),
  quantity INTEGER NOT NULL CHECK (quantity > 0),
  stock_delta INTEGER NOT NULL CHECK (stock_delta >= 0),
  item_condition TEXT NULL CHECK (item_condition IS NULL OR item_condition IN ('new', 'used', 'damaged')),
  actor_id UUID NULL REFERENCES public.profiles(id),
  details TEXT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_stock_return_events_request
  ON public.stock_return_events(return_request_id, created_at);
CREATE INDEX IF NOT EXISTS idx_stock_return_events_created_at
  ON public.stock_return_events(created_at DESC);

ALTER TABLE public.stock_return_events ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "stock_return_events_select_supervisor" ON public.stock_return_events;
CREATE POLICY "stock_return_events_select_supervisor" ON public.stock_return_events
FOR SELECT
USING ((SELECT public.is_active_supervisor()));

-- Recupera apenas fatos de devolucao que podem ser afirmados a partir do
-- estado persistido. Os NOT EXISTS permitem repetir a migration com seguranca.
INSERT INTO public.stock_return_events (
  return_request_id, event_type, quantity, stock_delta, item_condition, actor_id, details, created_at
)
SELECT
  request.id, 'received', request.quantity, 0, request.item_condition,
  request.created_by, 'Devolucao recebida para conferencia.', request.created_at
FROM public.stock_return_requests request
WHERE NOT EXISTS (
  SELECT 1 FROM public.stock_return_events event
  WHERE event.return_request_id = request.id AND event.event_type = 'received'
);

INSERT INTO public.stock_return_events (
  return_request_id, event_type, quantity, stock_delta, item_condition, actor_id, details, created_at
)
SELECT
  request.id, 'held_for_triage', request.held_quantity, 0, request.item_condition,
  request.approved_by, 'Quantidade mantida em triagem.', request.updated_at
FROM public.stock_return_requests request
WHERE request.held_quantity > 0
  AND NOT EXISTS (
    SELECT 1 FROM public.stock_return_events event
    WHERE event.return_request_id = request.id AND event.event_type = 'held_for_triage'
  );

INSERT INTO public.stock_return_events (
  return_request_id, event_type, quantity, stock_delta, item_condition, actor_id, details, created_at
)
SELECT
  request.id, 'returned_to_stock', request.approved_quantity, request.approved_quantity,
  COALESCE(request.approved_condition, request.item_condition), request.approved_by,
  'Quantidade devolvida ao estoque.', COALESCE(request.approved_at, request.updated_at)
FROM public.stock_return_requests request
WHERE request.approved_quantity > 0
  AND NOT EXISTS (
    SELECT 1 FROM public.stock_return_events event
    WHERE event.return_request_id = request.id AND event.event_type = 'returned_to_stock'
  );

CREATE OR REPLACE FUNCTION public.record_stock_return_event()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    INSERT INTO public.stock_return_events (
      return_request_id, event_type, quantity, stock_delta, item_condition, actor_id, details, created_at
    ) VALUES (
      NEW.id, 'received', NEW.quantity, 0, NEW.item_condition, NEW.created_by,
      'Devolucao recebida para conferencia.', NEW.created_at
    );
    RETURN NEW;
  END IF;

  IF NEW.held_quantity > OLD.held_quantity THEN
    INSERT INTO public.stock_return_events (
      return_request_id, event_type, quantity, stock_delta, item_condition, actor_id, details
    ) VALUES (
      NEW.id, 'held_for_triage', NEW.held_quantity - OLD.held_quantity, 0,
      NEW.item_condition, NEW.approved_by,
      COALESCE(NULLIF(NEW.triage_notes, ''), 'Quantidade mantida em triagem.')
    );
  END IF;

  IF NEW.approved_quantity > OLD.approved_quantity THEN
    INSERT INTO public.stock_return_events (
      return_request_id, event_type, quantity, stock_delta, item_condition, actor_id, details, created_at
    ) VALUES (
      NEW.id, 'returned_to_stock', NEW.approved_quantity - OLD.approved_quantity,
      NEW.approved_quantity - OLD.approved_quantity,
      COALESCE(NEW.approved_condition, NEW.item_condition), NEW.approved_by,
      COALESCE(NULLIF(NEW.triage_notes, ''), 'Quantidade devolvida ao estoque.'),
      COALESCE(NEW.approved_at, now())
    );
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_stock_return_events ON public.stock_return_requests;
CREATE TRIGGER trg_stock_return_events
  AFTER INSERT OR UPDATE OF approved_quantity, held_quantity
  ON public.stock_return_requests
  FOR EACH ROW EXECUTE FUNCTION public.record_stock_return_event();

REVOKE ALL ON FUNCTION public.record_stock_return_event() FROM PUBLIC, anon, authenticated;

-- A timeline de estoque passa a ler uma unica fonte. O trigger captura o saldo
-- real antes/depois; triggers de dominio apenas enriquecem o evento com a
-- retirada ou devolucao que causou a alteracao.
CREATE TABLE IF NOT EXISTS public.stock_movement_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  operation_id UUID NOT NULL DEFAULT gen_random_uuid(),
  transaction_id BIGINT NOT NULL DEFAULT txid_current(),
  stock_item_id UUID NOT NULL REFERENCES public.stock_items(id) ON DELETE RESTRICT,
  event_kind TEXT NOT NULL CHECK (event_kind IN (
    'initial_entry', 'entry', 'exit', 'return', 'received', 'triage', 'restoration',
    'adjustment', 'reclassification', 'cancelled'
  )),
  source TEXT NOT NULL DEFAULT 'manual' CHECK (source IN (
    'manual', 'withdrawal', 'return', 'import', 'assistant', 'system'
  )),
  quantity_delta INTEGER NOT NULL DEFAULT 0,
  quantity_new_delta INTEGER NOT NULL DEFAULT 0,
  quantity_used_delta INTEGER NOT NULL DEFAULT 0,
  quantity_damaged_delta INTEGER NOT NULL DEFAULT 0,
  balance_before INTEGER NULL,
  balance_after INTEGER NULL,
  quantity_new_before INTEGER NULL,
  quantity_new_after INTEGER NULL,
  quantity_used_before INTEGER NULL,
  quantity_used_after INTEGER NULL,
  quantity_damaged_before INTEGER NULL,
  quantity_damaged_after INTEGER NULL,
  actor_id UUID NULL REFERENCES public.profiles(id) ON DELETE SET NULL,
  related_entity_type TEXT NULL,
  related_entity_id UUID NULL,
  related_code TEXT NULL,
  counterparty_type TEXT NULL,
  counterparty_id UUID NULL,
  counterparty_name TEXT NULL,
  description TEXT NULL,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  provenance TEXT NOT NULL DEFAULT 'live' CHECK (provenance IN ('live', 'backfill')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_stock_movement_events_created
  ON public.stock_movement_events(created_at DESC, id DESC);
CREATE INDEX IF NOT EXISTS idx_stock_movement_events_item_created
  ON public.stock_movement_events(stock_item_id, created_at DESC, id DESC);
CREATE INDEX IF NOT EXISTS idx_stock_movement_events_operation
  ON public.stock_movement_events(operation_id, created_at, id);
CREATE INDEX IF NOT EXISTS idx_stock_movement_events_transaction
  ON public.stock_movement_events(transaction_id, stock_item_id);
CREATE INDEX IF NOT EXISTS idx_stock_movement_events_related
  ON public.stock_movement_events(related_entity_type, related_entity_id);

ALTER TABLE public.stock_movement_events ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "stock_movement_events_select_supervisor" ON public.stock_movement_events;
CREATE POLICY "stock_movement_events_select_supervisor" ON public.stock_movement_events
FOR SELECT
USING ((SELECT public.is_active_supervisor()));

CREATE OR REPLACE FUNCTION public.capture_stock_movement_event()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  previous_total INTEGER := 0;
  previous_new INTEGER := 0;
  previous_used INTEGER := 0;
  previous_damaged INTEGER := 0;
  delta_total INTEGER;
  delta_new INTEGER;
  delta_used INTEGER;
  delta_damaged INTEGER;
  resolved_kind TEXT;
  resolved_source TEXT;
  configured_operation_id UUID;
BEGIN
  IF TG_OP = 'UPDATE' THEN
    previous_total := OLD.current_quantity;
    previous_new := OLD.quantity_new;
    previous_used := OLD.quantity_used;
    previous_damaged := OLD.quantity_damaged;
  END IF;

  delta_total := NEW.current_quantity - previous_total;
  delta_new := NEW.quantity_new - previous_new;
  delta_used := NEW.quantity_used - previous_used;
  delta_damaged := NEW.quantity_damaged - previous_damaged;

  IF delta_total = 0 AND delta_new = 0 AND delta_used = 0 AND delta_damaged = 0 THEN
    RETURN NEW;
  END IF;

  resolved_source := COALESCE(
    NULLIF(current_setting('app.stock_movement_source', true), ''),
    'manual'
  );
  resolved_kind := NULLIF(current_setting('app.stock_movement_kind', true), '');

  IF resolved_kind IS NULL THEN
    resolved_kind := CASE
      WHEN TG_OP = 'INSERT' THEN 'initial_entry'
      WHEN delta_total > 0 THEN 'entry'
      WHEN delta_total < 0 THEN 'adjustment'
      ELSE 'reclassification'
    END;
  END IF;

  configured_operation_id := NULLIF(
    current_setting('app.stock_movement_operation_id', true),
    ''
  )::UUID;

  INSERT INTO public.stock_movement_events (
    operation_id,
    stock_item_id,
    event_kind,
    source,
    quantity_delta,
    quantity_new_delta,
    quantity_used_delta,
    quantity_damaged_delta,
    balance_before,
    balance_after,
    quantity_new_before,
    quantity_new_after,
    quantity_used_before,
    quantity_used_after,
    quantity_damaged_before,
    quantity_damaged_after,
    actor_id,
    related_entity_type,
    related_entity_id,
    related_code,
    description
  ) VALUES (
    COALESCE(configured_operation_id, gen_random_uuid()),
    NEW.id,
    resolved_kind,
    resolved_source,
    delta_total,
    delta_new,
    delta_used,
    delta_damaged,
    previous_total,
    NEW.current_quantity,
    previous_new,
    NEW.quantity_new,
    previous_used,
    NEW.quantity_used,
    previous_damaged,
    NEW.quantity_damaged,
    auth.uid(),
    NULLIF(current_setting('app.stock_movement_related_type', true), ''),
    NULLIF(current_setting('app.stock_movement_related_id', true), '')::UUID,
    NULLIF(current_setting('app.stock_movement_related_code', true), ''),
    NULLIF(current_setting('app.stock_movement_description', true), '')
  );

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_capture_stock_movement_event ON public.stock_items;
CREATE TRIGGER trg_capture_stock_movement_event
  AFTER INSERT OR UPDATE OF current_quantity, quantity_new, quantity_used, quantity_damaged
  ON public.stock_items
  FOR EACH ROW EXECUTE FUNCTION public.capture_stock_movement_event();

-- Enriquecimento da baixa que foi causada pela inclusao de uma linha de retirada.
CREATE OR REPLACE FUNCTION public.link_stock_event_to_withdrawal_item()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  withdrawal_row RECORD;
  effective_type TEXT;
  effective_id UUID;
  effective_name TEXT;
BEGIN
  SELECT w.id, w.code, w.requested_by, w.authorized_by, w.destination_type,
         w.collaborator_id, w.work_site_id
    INTO withdrawal_row
  FROM public.withdrawals w
  WHERE w.id = NEW.withdrawal_id;

  effective_type := COALESCE(NEW.destination_type::TEXT, withdrawal_row.destination_type::TEXT);
  effective_id := CASE
    WHEN effective_type = 'collaborator' THEN COALESCE(NEW.collaborator_id, withdrawal_row.collaborator_id)
    ELSE COALESCE(NEW.work_site_id, withdrawal_row.work_site_id)
  END;

  IF effective_type = 'collaborator' THEN
    SELECT full_name INTO effective_name FROM public.people WHERE id = effective_id;
  ELSE
    SELECT name INTO effective_name FROM public.work_sites WHERE id = effective_id;
  END IF;

  UPDATE public.stock_movement_events event
     SET operation_id = withdrawal_row.id,
         event_kind = 'exit',
         source = 'withdrawal',
         related_entity_type = 'withdrawal',
         related_entity_id = withdrawal_row.id,
         related_code = withdrawal_row.code,
         counterparty_type = effective_type,
         counterparty_id = effective_id,
         counterparty_name = effective_name,
         description = format('Saida registrada na retirada %s para %s.',
           COALESCE(withdrawal_row.code, 'sem codigo'),
           COALESCE(effective_name, 'destino nao informado')),
         metadata = event.metadata || jsonb_build_object('withdrawal_item_id', NEW.id)
   WHERE event.transaction_id = txid_current()
     AND event.stock_item_id = NEW.stock_item_id
     AND event.quantity_delta = -NEW.quantity
     AND event.related_entity_id IS NULL;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS zz_link_stock_event_to_withdrawal_item ON public.withdrawal_items;
CREATE TRIGGER zz_link_stock_event_to_withdrawal_item
  AFTER INSERT ON public.withdrawal_items
  FOR EACH ROW EXECUTE FUNCTION public.link_stock_event_to_withdrawal_item();

CREATE OR REPLACE FUNCTION public.link_stock_restoration_to_withdrawal()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.status = 'rejected' AND OLD.status IS DISTINCT FROM 'rejected' THEN
    UPDATE public.stock_movement_events event
       SET operation_id = NEW.id,
           event_kind = 'restoration',
           source = 'withdrawal',
           related_entity_type = 'withdrawal',
           related_entity_id = NEW.id,
           related_code = NEW.code,
           description = format('Estoque restaurado pelo cancelamento da retirada %s.', COALESCE(NEW.code, 'sem codigo'))
     WHERE event.transaction_id = txid_current()
       AND event.quantity_delta > 0
       AND event.related_entity_id IS NULL
       AND EXISTS (
         SELECT 1 FROM public.withdrawal_items wi
         WHERE wi.withdrawal_id = NEW.id
           AND wi.stock_item_id = event.stock_item_id
       );
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS zz_link_stock_restoration_to_withdrawal ON public.withdrawals;
CREATE TRIGGER zz_link_stock_restoration_to_withdrawal
  AFTER UPDATE OF status ON public.withdrawals
  FOR EACH ROW EXECUTE FUNCTION public.link_stock_restoration_to_withdrawal();

-- Preserva devolucoes e seus eventos: cancelar substitui exclusao fisica.
ALTER TABLE public.stock_return_requests
  DROP CONSTRAINT IF EXISTS stock_return_requests_status_check;
ALTER TABLE public.stock_return_requests
  ADD CONSTRAINT stock_return_requests_status_check
  CHECK (status IN ('pending', 'held', 'approved', 'cancelled'));

ALTER TABLE public.stock_return_events
  DROP CONSTRAINT IF EXISTS stock_return_events_event_type_check;
ALTER TABLE public.stock_return_events
  ADD CONSTRAINT stock_return_events_event_type_check
  CHECK (event_type IN ('received', 'held_for_triage', 'returned_to_stock', 'cancelled'));

ALTER TABLE public.stock_return_events
  DROP CONSTRAINT IF EXISTS stock_return_events_return_request_id_fkey;
ALTER TABLE public.stock_return_events
  ADD CONSTRAINT stock_return_events_return_request_id_fkey
  FOREIGN KEY (return_request_id) REFERENCES public.stock_return_requests(id) ON DELETE RESTRICT;

CREATE OR REPLACE FUNCTION public.mirror_stock_return_event_to_movement()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  request_row RECORD;
  withdrawal_id UUID;
  withdrawal_code TEXT;
  source_name TEXT;
BEGIN
  SELECT request.*
    INTO request_row
  FROM public.stock_return_requests request
  WHERE request.id = NEW.return_request_id;

  IF request_row.origin_withdrawal_item_id IS NOT NULL THEN
    SELECT w.id, w.code
      INTO withdrawal_id, withdrawal_code
    FROM public.withdrawal_items wi
    JOIN public.withdrawals w ON w.id = wi.withdrawal_id
    WHERE wi.id = request_row.origin_withdrawal_item_id;
  END IF;

  IF request_row.source_type = 'collaborator' THEN
    SELECT full_name INTO source_name FROM public.people WHERE id = request_row.source_person_id;
  ELSE
    SELECT name INTO source_name FROM public.work_sites WHERE id = request_row.source_work_site_id;
  END IF;

  IF NEW.event_type = 'returned_to_stock' THEN
    UPDATE public.stock_movement_events event
       SET operation_id = request_row.id,
           event_kind = 'return',
           source = 'return',
           related_entity_type = 'return_request',
           related_entity_id = request_row.id,
           related_code = withdrawal_code,
           counterparty_type = request_row.source_type,
           counterparty_id = COALESCE(request_row.source_person_id, request_row.source_work_site_id),
           counterparty_name = source_name,
           description = COALESCE(NEW.details, format('Devolucao de %s voltou ao estoque.', COALESCE(source_name, 'origem nao informada'))),
           metadata = event.metadata || jsonb_build_object(
             'return_event_id', NEW.id,
             'withdrawal_id', withdrawal_id,
             'condition', NEW.item_condition
           )
     WHERE event.transaction_id = txid_current()
       AND event.stock_item_id = request_row.stock_item_id
       AND event.quantity_delta = NEW.stock_delta
       AND event.related_entity_id IS NULL;
  ELSE
    INSERT INTO public.stock_movement_events (
      operation_id, transaction_id, stock_item_id, event_kind, source,
      quantity_delta, actor_id, related_entity_type, related_entity_id,
      related_code, counterparty_type, counterparty_id, counterparty_name,
      description, metadata, created_at
    ) VALUES (
      request_row.id,
      txid_current(),
      request_row.stock_item_id,
      CASE
        WHEN NEW.event_type = 'cancelled' THEN 'cancelled'
        WHEN NEW.event_type = 'received' THEN 'received'
        ELSE 'triage'
      END,
      'return',
      0,
      NEW.actor_id,
      'return_request',
      request_row.id,
      withdrawal_code,
      request_row.source_type,
      COALESCE(request_row.source_person_id, request_row.source_work_site_id),
      source_name,
      NEW.details,
      jsonb_build_object(
        'return_event_id', NEW.id,
        'return_stage', NEW.event_type,
        'stage_quantity', NEW.quantity,
        'condition', NEW.item_condition,
        'withdrawal_id', withdrawal_id
      ),
      NEW.created_at
    );
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS zz_mirror_stock_return_event_to_movement ON public.stock_return_events;
CREATE TRIGGER zz_mirror_stock_return_event_to_movement
  AFTER INSERT ON public.stock_return_events
  FOR EACH ROW EXECUTE FUNCTION public.mirror_stock_return_event_to_movement();

CREATE OR REPLACE FUNCTION public.delete_stock_return_request(p_request_id UUID)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  target_request public.stock_return_requests%ROWTYPE;
  origin_withdrawal_id UUID;
BEGIN
  IF NOT public.is_active_supervisor() THEN
    RAISE EXCEPTION 'Acesso negado: somente supervisores ativos podem cancelar devolucoes.';
  END IF;

  SELECT * INTO target_request
  FROM public.stock_return_requests
  WHERE id = p_request_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Devolucao nao encontrada.';
  END IF;

  IF target_request.status = 'approved' OR target_request.approved_quantity > 0 THEN
    RAISE EXCEPTION 'Nao e possivel cancelar uma devolucao que ja voltou ao estoque.';
  END IF;

  IF target_request.status = 'cancelled' THEN
    RETURN;
  END IF;

  IF target_request.source_type = 'collaborator' THEN
    SELECT withdrawal_id INTO origin_withdrawal_id
    FROM public.withdrawal_items
    WHERE id = target_request.origin_withdrawal_item_id;

    INSERT INTO public.person_inventories (person_id, stock_item_id, quantity, last_withdrawal_id)
    VALUES (target_request.source_person_id, target_request.stock_item_id, target_request.quantity, origin_withdrawal_id)
    ON CONFLICT (person_id, stock_item_id) DO UPDATE
    SET quantity = public.person_inventories.quantity + EXCLUDED.quantity,
        last_withdrawal_id = COALESCE(EXCLUDED.last_withdrawal_id, public.person_inventories.last_withdrawal_id),
        updated_at = now();
  END IF;

  PERFORM set_config('app.return_cancellation_authorized', 'yes', true);

  UPDATE public.stock_return_requests
     SET status = 'cancelled',
         held_quantity = 0,
         updated_at = now()
   WHERE id = target_request.id;

  INSERT INTO public.stock_return_events (
    return_request_id, event_type, quantity, stock_delta, item_condition,
    actor_id, details
  ) VALUES (
    target_request.id, 'cancelled', target_request.quantity, 0,
    target_request.item_condition, auth.uid(),
    'Devolucao cancelada; nenhum saldo de estoque foi alterado.'
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.prevent_unmanaged_return_cancellation()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF NEW.status = 'cancelled'
     AND OLD.status IS DISTINCT FROM 'cancelled'
     AND current_setting('app.return_cancellation_authorized', true) IS DISTINCT FROM 'yes' THEN
    RAISE EXCEPTION 'Use a acao de cancelamento para preservar inventario e historico.';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_prevent_unmanaged_return_cancellation ON public.stock_return_requests;
CREATE TRIGGER trg_prevent_unmanaged_return_cancellation
  BEFORE UPDATE OF status ON public.stock_return_requests
  FOR EACH ROW EXECUTE FUNCTION public.prevent_unmanaged_return_cancellation();

-- Backfill seguro das retiradas e etapas de devolucao. Saldos antes/depois
-- ficam nulos quando o estado historico nao pode ser comprovado.
INSERT INTO public.stock_movement_events (
  operation_id, stock_item_id, event_kind, source, quantity_delta, actor_id,
  related_entity_type, related_entity_id, related_code, counterparty_type,
  counterparty_id, counterparty_name, description, metadata, provenance, created_at
)
SELECT
  w.id,
  wi.stock_item_id,
  'exit',
  'withdrawal',
  -wi.quantity,
  w.authorized_by,
  'withdrawal',
  w.id,
  w.code,
  COALESCE(wi.destination_type::TEXT, w.destination_type::TEXT),
  CASE WHEN COALESCE(wi.destination_type, w.destination_type) = 'collaborator'
    THEN COALESCE(wi.collaborator_id, w.collaborator_id)
    ELSE COALESCE(wi.work_site_id, w.work_site_id) END,
  CASE WHEN COALESCE(wi.destination_type, w.destination_type) = 'collaborator'
    THEN person.full_name ELSE work_site.name END,
  format('Saida registrada na retirada %s.', COALESCE(w.code, 'sem codigo')),
  jsonb_build_object('withdrawal_item_id', wi.id),
  'backfill',
  COALESCE(w.withdrawn_at, w.created_at)
FROM public.withdrawal_items wi
JOIN public.withdrawals w ON w.id = wi.withdrawal_id
LEFT JOIN public.people person ON person.id = COALESCE(wi.collaborator_id, w.collaborator_id)
LEFT JOIN public.work_sites work_site ON work_site.id = COALESCE(wi.work_site_id, w.work_site_id)
WHERE w.status <> 'rejected'
  AND NOT EXISTS (
    SELECT 1 FROM public.stock_movement_events event
    WHERE event.related_entity_type = 'withdrawal'
      AND event.related_entity_id = w.id
      AND event.metadata->>'withdrawal_item_id' = wi.id::TEXT
  );

INSERT INTO public.stock_movement_events (
  operation_id, stock_item_id, event_kind, source, quantity_delta, actor_id,
  related_entity_type, related_entity_id, related_code, counterparty_type,
  counterparty_id, counterparty_name, description, metadata, provenance, created_at
)
SELECT
  request.id,
  request.stock_item_id,
  CASE event.event_type
    WHEN 'returned_to_stock' THEN 'return'
    WHEN 'cancelled' THEN 'cancelled'
    WHEN 'received' THEN 'received'
    ELSE 'triage'
  END,
  'return',
  event.stock_delta,
  event.actor_id,
  'return_request',
  request.id,
  w.code,
  request.source_type,
  COALESCE(request.source_person_id, request.source_work_site_id),
  COALESCE(person.full_name, work_site.name),
  event.details,
  jsonb_build_object(
    'return_event_id', event.id,
    'return_stage', event.event_type,
    'stage_quantity', event.quantity,
    'condition', event.item_condition,
    'withdrawal_id', w.id
  ),
  'backfill',
  event.created_at
FROM public.stock_return_events event
JOIN public.stock_return_requests request ON request.id = event.return_request_id
LEFT JOIN public.withdrawal_items wi ON wi.id = request.origin_withdrawal_item_id
LEFT JOIN public.withdrawals w ON w.id = wi.withdrawal_id
LEFT JOIN public.people person ON person.id = request.source_person_id
LEFT JOIN public.work_sites work_site ON work_site.id = request.source_work_site_id
WHERE NOT EXISTS (
  SELECT 1 FROM public.stock_movement_events movement
  WHERE movement.metadata->>'return_event_id' = event.id::TEXT
);

-- Ajustes antigos entram apenas quando nao ha retirada/devolucao equivalente
-- no mesmo intervalo. A partir desta migration nao existe mais heuristica.
INSERT INTO public.stock_movement_events (
  stock_item_id, event_kind, source, quantity_delta,
  balance_before, balance_after, actor_id, related_entity_type,
  related_entity_id, related_code, description, provenance, created_at
)
SELECT
  log.record_id,
  CASE
    WHEN (log.new_data->>'current_quantity')::INTEGER > (log.old_data->>'current_quantity')::INTEGER THEN 'entry'
    ELSE 'adjustment'
  END,
  'manual',
  (log.new_data->>'current_quantity')::INTEGER - (log.old_data->>'current_quantity')::INTEGER,
  (log.old_data->>'current_quantity')::INTEGER,
  (log.new_data->>'current_quantity')::INTEGER,
  log.user_id,
  'stock_item',
  log.record_id,
  COALESCE(log.new_data->>'code', log.old_data->>'code'),
  'Ajuste historico recuperado da auditoria.',
  'backfill',
  log.created_at
FROM public.audit_logs log
WHERE log.table_name = 'stock_items'
  AND log.action = 'UPDATE'
  AND log.record_id IS NOT NULL
  AND jsonb_typeof(log.old_data->'current_quantity') = 'number'
  AND jsonb_typeof(log.new_data->'current_quantity') = 'number'
  AND (log.new_data->>'current_quantity')::INTEGER <> (log.old_data->>'current_quantity')::INTEGER
  AND EXISTS (SELECT 1 FROM public.stock_items item WHERE item.id = log.record_id)
  AND NOT EXISTS (
    SELECT 1 FROM public.stock_movement_events movement
    WHERE movement.stock_item_id = log.record_id
      AND movement.quantity_delta = (log.new_data->>'current_quantity')::INTEGER - (log.old_data->>'current_quantity')::INTEGER
      AND movement.source IN ('withdrawal', 'return')
      AND movement.created_at BETWEEN log.created_at - interval '90 seconds' AND log.created_at + interval '90 seconds'
  );

REVOKE ALL ON FUNCTION public.capture_stock_movement_event() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.link_stock_event_to_withdrawal_item() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.link_stock_restoration_to_withdrawal() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.mirror_stock_return_event_to_movement() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.prevent_unmanaged_return_cancellation() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.delete_stock_return_request(UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.delete_stock_return_request(UUID) TO authenticated, service_role;

COMMIT;
