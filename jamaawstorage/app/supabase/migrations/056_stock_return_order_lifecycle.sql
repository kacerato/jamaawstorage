BEGIN;

-- ---------------------------------------------------------------------------
-- Ciclo de vida da devolucao. Toda escrita passa por aqui: as tabelas da
-- migration 054 so expoem SELECT via RLS.
--
--   create_return_draft      draft            monta a selecao, sem efeito
--   submit_return_for_triage awaiting_triage  recebe o material, baixa inventario
--   save_return_triage       triaged          classifica em new/used/damaged
--   complete_return          completed        credita o estoque, uma unica vez
--   cancel_return            cancelled        desfaz o que ainda nao foi creditado
--
-- O termo em PDF e gerado pelo cliente a partir do retorno de
-- submit_return_for_triage. Ele documenta a entrega; nao e condicao para
-- avancar, e por isso nenhuma transicao verifica anexo.
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.assert_return_supervisor()
RETURNS UUID
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  profile_id UUID;
BEGIN
  IF NOT public.is_active_supervisor() THEN
    RAISE EXCEPTION 'Acesso negado: somente supervisores ativos podem gerenciar devolucoes.';
  END IF;

  SELECT id INTO profile_id FROM public.profiles WHERE id = auth.uid();
  RETURN profile_id;
END;
$$;

-- ---------------------------------------------------------------------------
-- Etapa 1: rascunho.
-- p_items: [{ "stock_item_id": uuid, "quantity": int, "reported_condition": text,
--             "origin_withdrawal_item_id": uuid|null, "notes": text|null }]
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.create_return_draft(
  p_source_type TEXT,
  p_source_person_id UUID,
  p_source_work_site_id UUID,
  p_items JSONB,
  p_reason TEXT DEFAULT 'general',
  p_notes TEXT DEFAULT NULL
)
RETURNS public.stock_returns
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  actor_id UUID;
  new_return public.stock_returns%ROWTYPE;
  item JSONB;
  item_quantity INTEGER;
  item_stock_id UUID;
  available_quantity INTEGER;
BEGIN
  actor_id := public.assert_return_supervisor();

  IF p_source_type NOT IN ('collaborator', 'work_site') THEN
    RAISE EXCEPTION 'Informe se a devolucao vem de um colaborador ou de uma obra.';
  END IF;

  IF p_items IS NULL OR jsonb_typeof(p_items) <> 'array' OR jsonb_array_length(p_items) = 0 THEN
    RAISE EXCEPTION 'Selecione ao menos um item para devolver.';
  END IF;

  INSERT INTO public.stock_returns (
    source_type, source_person_id, source_work_site_id,
    status, reason, notes, created_by
  )
  VALUES (
    p_source_type,
    CASE WHEN p_source_type = 'collaborator' THEN p_source_person_id END,
    CASE WHEN p_source_type = 'work_site' THEN p_source_work_site_id END,
    'draft',
    COALESCE(NULLIF(trim(p_reason), ''), 'general'),
    NULLIF(trim(p_notes), ''),
    actor_id
  )
  RETURNING * INTO new_return;

  FOR item IN SELECT * FROM jsonb_array_elements(p_items)
  LOOP
    item_stock_id := (item->>'stock_item_id')::UUID;
    item_quantity := (item->>'quantity')::INTEGER;

    IF item_stock_id IS NULL OR item_quantity IS NULL OR item_quantity <= 0 THEN
      RAISE EXCEPTION 'Cada item precisa de um produto e de uma quantidade maior que zero.';
    END IF;

    -- O colaborador so pode devolver o que consta no inventario dele. Validar
    -- ja no rascunho evita montar um termo que nao podera ser recebido.
    IF p_source_type = 'collaborator' THEN
      SELECT quantity INTO available_quantity
      FROM public.person_inventories
      WHERE person_id = p_source_person_id AND stock_item_id = item_stock_id;

      IF COALESCE(available_quantity, 0) < item_quantity THEN
        RAISE EXCEPTION 'O colaborador possui apenas % unidade(s) desse item no inventario.',
          COALESCE(available_quantity, 0);
      END IF;
    END IF;

    INSERT INTO public.stock_return_items (
      stock_return_id, stock_item_id, quantity, reported_condition,
      origin_withdrawal_item_id, notes
    )
    VALUES (
      new_return.id,
      item_stock_id,
      item_quantity,
      COALESCE(NULLIF(item->>'reported_condition', ''), 'used'),
      NULLIF(item->>'origin_withdrawal_item_id', '')::UUID,
      NULLIF(trim(item->>'notes'), '')
    );
  END LOOP;

  RETURN new_return;
END;
$$;

-- ---------------------------------------------------------------------------
-- Etapa 2: recebimento. O material sai do inventario de origem e o codigo do
-- termo passa a valer. O estoque geral ainda nao e tocado: o material esta no
-- almoxarifado aguardando conferencia, e esse e justamente o sentido de
-- 'awaiting_triage'.
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.submit_return_for_triage(
  p_return_id UUID
)
RETURNS public.stock_returns
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  actor_id UUID;
  target_return public.stock_returns%ROWTYPE;
  item RECORD;
  available_quantity INTEGER;
  source_name TEXT;
BEGIN
  actor_id := public.assert_return_supervisor();

  SELECT * INTO target_return
  FROM public.stock_returns
  WHERE id = p_return_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Devolucao nao encontrada.';
  END IF;

  IF target_return.status <> 'draft' THEN
    RAISE EXCEPTION 'Somente uma devolucao em rascunho pode ser enviada para triagem.';
  END IF;

  IF NOT EXISTS (SELECT 1 FROM public.stock_return_items WHERE stock_return_id = p_return_id) THEN
    RAISE EXCEPTION 'A devolucao precisa ter ao menos um item.';
  END IF;

  IF target_return.source_type = 'collaborator' THEN
    SELECT full_name INTO source_name FROM public.people WHERE id = target_return.source_person_id;

    FOR item IN
      SELECT stock_item_id, quantity
      FROM public.stock_return_items
      WHERE stock_return_id = p_return_id
      ORDER BY stock_item_id
    LOOP
      SELECT quantity INTO available_quantity
      FROM public.person_inventories
      WHERE person_id = target_return.source_person_id
        AND stock_item_id = item.stock_item_id
      FOR UPDATE;

      IF COALESCE(available_quantity, 0) < item.quantity THEN
        RAISE EXCEPTION 'O colaborador nao possui quantidade suficiente do item. Disponivel: %.',
          COALESCE(available_quantity, 0);
      END IF;

      UPDATE public.person_inventories
      SET quantity = quantity - item.quantity,
          updated_at = now()
      WHERE person_id = target_return.source_person_id
        AND stock_item_id = item.stock_item_id;

      DELETE FROM public.person_inventories
      WHERE person_id = target_return.source_person_id
        AND stock_item_id = item.stock_item_id
        AND quantity <= 0;
    END LOOP;
  ELSE
    SELECT name INTO source_name FROM public.work_sites WHERE id = target_return.source_work_site_id;
  END IF;

  UPDATE public.stock_returns
  SET status = 'awaiting_triage',
      received_by = actor_id,
      received_at = now(),
      source_label_snapshot = source_name,
      updated_at = now()
  WHERE id = p_return_id
  RETURNING * INTO target_return;

  -- Registro do recebimento no ledger canonico. quantity_delta zero: o material
  -- esta sob custodia do almoxarifado, ainda fora do saldo.
  INSERT INTO public.stock_movement_events (
    operation_id, stock_item_id, event_kind, source, quantity_delta,
    actor_id, related_entity_type, related_entity_id, related_code,
    counterparty_type, counterparty_id, counterparty_name, description
  )
  SELECT
    target_return.id,
    returned_item.stock_item_id,
    'received',
    'return',
    0,
    actor_id,
    'stock_return',
    target_return.id,
    target_return.code,
    target_return.source_type,
    COALESCE(target_return.source_person_id, target_return.source_work_site_id),
    source_name,
    format('Devolucao %s recebida para conferencia.', target_return.code)
  FROM public.stock_return_items returned_item
  WHERE returned_item.stock_return_id = p_return_id;

  RETURN target_return;
END;
$$;

-- ---------------------------------------------------------------------------
-- Etapa 3: triagem. Grava como cada item se reparte entre os estados.
-- p_triage: [{ "stock_return_item_id": uuid,
--              "conditions": { "new": int, "used": int, "damaged": int } }]
-- Reexecutavel enquanto a devolucao nao for confirmada: substitui a
-- classificacao anterior por inteiro.
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.save_return_triage(
  p_return_id UUID,
  p_triage JSONB,
  p_triage_notes TEXT DEFAULT NULL
)
RETURNS public.stock_returns
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  actor_id UUID;
  target_return public.stock_returns%ROWTYPE;
  entry JSONB;
  target_item public.stock_return_items%ROWTYPE;
  condition_name TEXT;
  condition_quantity INTEGER;
  distributed_quantity INTEGER;
  unclassified_count INTEGER;
BEGIN
  actor_id := public.assert_return_supervisor();

  SELECT * INTO target_return
  FROM public.stock_returns
  WHERE id = p_return_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Devolucao nao encontrada.';
  END IF;

  IF target_return.status NOT IN ('awaiting_triage', 'triaged') THEN
    RAISE EXCEPTION 'Somente uma devolucao recebida pode ser triada.';
  END IF;

  IF p_triage IS NULL OR jsonb_typeof(p_triage) <> 'array' OR jsonb_array_length(p_triage) = 0 THEN
    RAISE EXCEPTION 'Informe a classificacao dos itens.';
  END IF;

  FOR entry IN SELECT * FROM jsonb_array_elements(p_triage)
  LOOP
    SELECT * INTO target_item
    FROM public.stock_return_items
    WHERE id = (entry->>'stock_return_item_id')::UUID
      AND stock_return_id = p_return_id
    FOR UPDATE;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'Item informado nao pertence a esta devolucao.';
    END IF;

    DELETE FROM public.stock_return_item_conditions
    WHERE stock_return_item_id = target_item.id;

    distributed_quantity := 0;

    FOREACH condition_name IN ARRAY ARRAY['new', 'used', 'damaged']
    LOOP
      condition_quantity := COALESCE((entry->'conditions'->>condition_name)::INTEGER, 0);

      IF condition_quantity < 0 THEN
        RAISE EXCEPTION 'As quantidades da triagem nao podem ser negativas.';
      END IF;

      IF condition_quantity > 0 THEN
        INSERT INTO public.stock_return_item_conditions (
          stock_return_item_id, condition, quantity
        )
        VALUES (target_item.id, condition_name, condition_quantity);

        distributed_quantity := distributed_quantity + condition_quantity;
      END IF;
    END LOOP;

    -- A soma tem que fechar com o recebido: material sob custodia nao pode
    -- desaparecer nem se multiplicar na conferencia.
    IF distributed_quantity <> target_item.quantity THEN
      RAISE EXCEPTION 'A classificacao precisa somar exatamente % unidade(s); foram distribuidas %.',
        target_item.quantity, distributed_quantity;
    END IF;
  END LOOP;

  SELECT count(*) INTO unclassified_count
  FROM public.stock_return_items returned_item
  WHERE returned_item.stock_return_id = p_return_id
    AND NOT EXISTS (
      SELECT 1 FROM public.stock_return_item_conditions condition_row
      WHERE condition_row.stock_return_item_id = returned_item.id
    );

  UPDATE public.stock_returns
  SET status = CASE WHEN unclassified_count = 0 THEN 'triaged' ELSE 'awaiting_triage' END,
      triage_notes = COALESCE(NULLIF(trim(p_triage_notes), ''), triage_notes),
      triaged_by = CASE WHEN unclassified_count = 0 THEN actor_id ELSE triaged_by END,
      triaged_at = CASE WHEN unclassified_count = 0 THEN now() ELSE triaged_at END,
      updated_at = now()
  WHERE id = p_return_id
  RETURNING * INTO target_return;

  RETURN target_return;
END;
$$;

-- ---------------------------------------------------------------------------
-- Etapa 4: confirmacao. Unico ponto em que o estoque e creditado.
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.complete_return(
  p_return_id UUID
)
RETURNS public.stock_returns
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  actor_id UUID;
  target_return public.stock_returns%ROWTYPE;
  classified RECORD;
BEGIN
  actor_id := public.assert_return_supervisor();

  SELECT * INTO target_return
  FROM public.stock_returns
  WHERE id = p_return_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Devolucao nao encontrada.';
  END IF;

  IF target_return.status <> 'triaged' THEN
    RAISE EXCEPTION 'Conclua a triagem de todos os itens antes de confirmar a devolucao.';
  END IF;

  FOR classified IN
    SELECT
      returned_item.stock_item_id,
      sum(condition_row.quantity) FILTER (WHERE condition_row.condition = 'new')::INTEGER AS quantity_new,
      sum(condition_row.quantity) FILTER (WHERE condition_row.condition = 'used')::INTEGER AS quantity_used,
      sum(condition_row.quantity) FILTER (WHERE condition_row.condition = 'damaged')::INTEGER AS quantity_damaged,
      sum(condition_row.quantity)::INTEGER AS quantity_total
    FROM public.stock_return_items returned_item
    JOIN public.stock_return_item_conditions condition_row
      ON condition_row.stock_return_item_id = returned_item.id
    WHERE returned_item.stock_return_id = p_return_id
    GROUP BY returned_item.stock_item_id
    ORDER BY returned_item.stock_item_id
  LOOP
    UPDATE public.stock_items
    SET current_quantity = current_quantity + classified.quantity_total,
        quantity_new = quantity_new + COALESCE(classified.quantity_new, 0),
        quantity_used = quantity_used + COALESCE(classified.quantity_used, 0),
        quantity_damaged = quantity_damaged + COALESCE(classified.quantity_damaged, 0),
        updated_at = now()
    WHERE id = classified.stock_item_id;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'Item de estoque nao encontrado para concluir a devolucao.';
    END IF;

    -- Enriquece o evento que o trigger de stock_items acabou de capturar nesta
    -- mesma transacao, para que a movimentacao apareca ligada a devolucao.
    UPDATE public.stock_movement_events event
    SET operation_id = target_return.id,
        event_kind = 'return',
        source = 'return',
        related_entity_type = 'stock_return',
        related_entity_id = target_return.id,
        related_code = target_return.code,
        counterparty_type = target_return.source_type,
        counterparty_id = COALESCE(target_return.source_person_id, target_return.source_work_site_id),
        counterparty_name = target_return.source_label_snapshot,
        description = format('Devolucao %s voltou ao estoque.', target_return.code)
    WHERE event.transaction_id = txid_current()
      AND event.stock_item_id = classified.stock_item_id
      AND event.quantity_delta = classified.quantity_total
      AND event.related_entity_id IS NULL;
  END LOOP;

  UPDATE public.stock_returns
  SET status = 'completed',
      completed_by = actor_id,
      completed_at = now(),
      updated_at = now()
  WHERE id = p_return_id
  RETURNING * INTO target_return;

  RETURN target_return;
END;
$$;

-- ---------------------------------------------------------------------------
-- Cancelamento. Antes da confirmacao nada foi creditado, entao basta devolver o
-- material a origem. Depois dela, a correcao e um ajuste de estoque proprio.
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.cancel_return(
  p_return_id UUID,
  p_reason TEXT DEFAULT NULL
)
RETURNS public.stock_returns
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  actor_id UUID;
  target_return public.stock_returns%ROWTYPE;
  item RECORD;
BEGIN
  actor_id := public.assert_return_supervisor();

  SELECT * INTO target_return
  FROM public.stock_returns
  WHERE id = p_return_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Devolucao nao encontrada.';
  END IF;

  IF target_return.status = 'completed' THEN
    RAISE EXCEPTION 'Esta devolucao ja foi concluida e o material entrou no estoque. Corrija por ajuste de estoque.';
  END IF;

  IF target_return.status = 'cancelled' THEN
    RAISE EXCEPTION 'Esta devolucao ja foi cancelada.';
  END IF;

  -- Se o material chegou a ser recebido, ele volta para o inventario de origem.
  IF target_return.status IN ('awaiting_triage', 'triaged')
     AND target_return.source_type = 'collaborator' THEN
    FOR item IN
      SELECT returned_item.stock_item_id, returned_item.quantity, origin.withdrawal_id
      FROM public.stock_return_items returned_item
      LEFT JOIN public.withdrawal_items origin
        ON origin.id = returned_item.origin_withdrawal_item_id
      WHERE returned_item.stock_return_id = p_return_id
    LOOP
      INSERT INTO public.person_inventories (person_id, stock_item_id, quantity, last_withdrawal_id)
      VALUES (target_return.source_person_id, item.stock_item_id, item.quantity, item.withdrawal_id)
      ON CONFLICT (person_id, stock_item_id) DO UPDATE
      SET quantity = public.person_inventories.quantity + EXCLUDED.quantity,
          last_withdrawal_id = COALESCE(EXCLUDED.last_withdrawal_id, public.person_inventories.last_withdrawal_id),
          updated_at = now();
    END LOOP;
  END IF;

  UPDATE public.stock_returns
  SET status = 'cancelled',
      cancelled_by = actor_id,
      cancelled_at = now(),
      cancellation_reason = NULLIF(trim(p_reason), ''),
      updated_at = now()
  WHERE id = p_return_id
  RETURNING * INTO target_return;

  RETURN target_return;
END;
$$;

-- ---------------------------------------------------------------------------
-- Rascunho descartado nao deixa rastro util: pode ser removido de fato.
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.delete_return_draft(
  p_return_id UUID
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  target_status TEXT;
BEGIN
  PERFORM public.assert_return_supervisor();

  SELECT status INTO target_status
  FROM public.stock_returns
  WHERE id = p_return_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Devolucao nao encontrada.';
  END IF;

  IF target_status <> 'draft' THEN
    RAISE EXCEPTION 'Somente rascunhos podem ser excluidos. Use o cancelamento para devolucoes ja recebidas.';
  END IF;

  DELETE FROM public.stock_returns WHERE id = p_return_id;
END;
$$;

REVOKE ALL ON FUNCTION public.assert_return_supervisor() FROM PUBLIC, anon, authenticated;

REVOKE EXECUTE ON FUNCTION public.create_return_draft(TEXT, UUID, UUID, JSONB, TEXT, TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.create_return_draft(TEXT, UUID, UUID, JSONB, TEXT, TEXT) TO authenticated, service_role;

REVOKE EXECUTE ON FUNCTION public.submit_return_for_triage(UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.submit_return_for_triage(UUID) TO authenticated, service_role;

REVOKE EXECUTE ON FUNCTION public.save_return_triage(UUID, JSONB, TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.save_return_triage(UUID, JSONB, TEXT) TO authenticated, service_role;

REVOKE EXECUTE ON FUNCTION public.complete_return(UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.complete_return(UUID) TO authenticated, service_role;

REVOKE EXECUTE ON FUNCTION public.cancel_return(UUID, TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.cancel_return(UUID, TEXT) TO authenticated, service_role;

REVOKE EXECUTE ON FUNCTION public.delete_return_draft(UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.delete_return_draft(UUID) TO authenticated, service_role;

COMMIT;
