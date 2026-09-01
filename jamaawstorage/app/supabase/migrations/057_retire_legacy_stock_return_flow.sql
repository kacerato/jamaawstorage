BEGIN;

-- ---------------------------------------------------------------------------
-- Aposenta o fluxo anterior de devolucao.
--
-- O modelo antigo creditava o estoque em pedacos (aprovacao parcial) e mantinha
-- dois estados de "nao resolvido" (pending e held) com dois RPCs quase iguais.
-- O ciclo da migration 056 substitui os dois por uma etapa de triagem explicita
-- e um unico credito ao final.
-- ---------------------------------------------------------------------------

DROP FUNCTION IF EXISTS public.process_stock_return_request(UUID, INTEGER, INTEGER, TEXT, TEXT, TEXT);
DROP FUNCTION IF EXISTS public.process_stock_return_request(UUID, INTEGER, INTEGER, TEXT);
DROP FUNCTION IF EXISTS public.process_held_stock_return_request(UUID, INTEGER, INTEGER, TEXT, TEXT, TEXT);
DROP FUNCTION IF EXISTS public.set_stock_return_request_status(UUID, TEXT);
DROP FUNCTION IF EXISTS public.approve_stock_return_request(UUID);
DROP FUNCTION IF EXISTS public.delete_stock_return_request(UUID);

-- Triggers e funcoes que existiam para vigiar a tabela antiga. As garantias que
-- eles davam agora estao dentro dos RPCs do ciclo, que sao o unico caminho de
-- escrita das novas tabelas.
DROP TRIGGER IF EXISTS trg_stock_return_events ON public.stock_return_requests_legacy;
DROP TRIGGER IF EXISTS trg_stock_return_requests_guard_integrity ON public.stock_return_requests_legacy;
DROP TRIGGER IF EXISTS trg_stock_return_requests_restore_inventory_on_delete ON public.stock_return_requests_legacy;
DROP TRIGGER IF EXISTS trg_prevent_unmanaged_return_cancellation ON public.stock_return_requests_legacy;
DROP TRIGGER IF EXISTS trg_stock_return_requests_updated_at ON public.stock_return_requests_legacy;

-- O espelhamento vivia em stock_return_events e lia stock_return_requests, que
-- deixou de existir com esse nome. O trigger sai antes da funcao que ele chama.
DROP TRIGGER IF EXISTS zz_mirror_stock_return_event_to_movement ON public.stock_return_events;

DROP FUNCTION IF EXISTS public.record_stock_return_event();
DROP FUNCTION IF EXISTS public.mirror_stock_return_event_to_movement();
DROP FUNCTION IF EXISTS public.guard_stock_return_request_integrity();
DROP FUNCTION IF EXISTS public.restore_stock_return_inventory_on_delete();
DROP FUNCTION IF EXISTS public.prevent_unmanaged_return_cancellation();

-- ---------------------------------------------------------------------------
-- Devolucao avulsa iniciada pela tela da retirada. Continua sendo um atalho de
-- uma etapa so, mas agora produz um cabecalho completo em vez de uma linha
-- solta: o historico fica igual ao das devolucoes que passam pelo termo.
-- ---------------------------------------------------------------------------

DROP FUNCTION IF EXISTS public.register_linked_stock_return(UUID, INTEGER, TEXT);

CREATE OR REPLACE FUNCTION public.register_linked_stock_return(
  p_withdrawal_item_id UUID,
  p_quantity INTEGER,
  p_item_condition TEXT DEFAULT 'used'
)
RETURNS public.stock_returns
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  origin_item RECORD;
  already_returned INTEGER;
  new_return public.stock_returns%ROWTYPE;
  new_item_id UUID;
BEGIN
  PERFORM public.assert_return_supervisor();

  IF p_withdrawal_item_id IS NULL THEN
    RAISE EXCEPTION 'Informe o item da retirada que esta sendo devolvido.';
  END IF;

  IF p_quantity IS NULL OR p_quantity <= 0 THEN
    RAISE EXCEPTION 'Informe uma quantidade de devolucao maior que zero.';
  END IF;

  IF p_item_condition NOT IN ('new', 'used', 'damaged') THEN
    RAISE EXCEPTION 'Informe o estado do item como new, used ou damaged.';
  END IF;

  -- O bloqueio na linha da retirada serializa devolucoes concorrentes da mesma
  -- retirada, impedindo que duas somem mais do que foi retirado.
  SELECT
    wi.id,
    wi.stock_item_id,
    wi.quantity,
    COALESCE(wi.destination_type, w.destination_type) AS destination_type,
    CASE
      WHEN COALESCE(wi.destination_type, w.destination_type) = 'collaborator'
        THEN COALESCE(wi.collaborator_id, w.collaborator_id)
    END AS collaborator_id,
    CASE
      WHEN COALESCE(wi.destination_type, w.destination_type) = 'work_site'
        THEN COALESCE(wi.work_site_id, w.work_site_id)
    END AS work_site_id,
    w.code,
    w.status
  INTO origin_item
  FROM public.withdrawal_items wi
  JOIN public.withdrawals w ON w.id = wi.withdrawal_id
  WHERE wi.id = p_withdrawal_item_id
  FOR UPDATE OF wi;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Item da retirada nao encontrado.';
  END IF;

  IF origin_item.status = 'rejected' THEN
    RAISE EXCEPTION 'Nao e possivel devolver item de uma retirada rejeitada.';
  END IF;

  SELECT COALESCE(sum(returned_item.quantity), 0)
    INTO already_returned
  FROM public.stock_return_items returned_item
  JOIN public.stock_returns parent_return
    ON parent_return.id = returned_item.stock_return_id
  WHERE returned_item.origin_withdrawal_item_id = p_withdrawal_item_id
    AND parent_return.status <> 'cancelled';

  IF already_returned + p_quantity > origin_item.quantity THEN
    RAISE EXCEPTION 'A devolucao ultrapassa a quantidade retirada. Ainda pode devolver % unidade(s).',
      origin_item.quantity - already_returned;
  END IF;

  INSERT INTO public.stock_returns (
    source_type, source_person_id, source_work_site_id,
    status, reason, notes, created_by
  )
  VALUES (
    origin_item.destination_type::TEXT,
    origin_item.collaborator_id,
    origin_item.work_site_id,
    'draft',
    'exchange',
    format('Devolucao vinculada a retirada %s.', COALESCE(origin_item.code, 'sem codigo')),
    auth.uid()
  )
  RETURNING * INTO new_return;

  INSERT INTO public.stock_return_items (
    stock_return_id, stock_item_id, quantity, reported_condition, origin_withdrawal_item_id
  )
  VALUES (
    new_return.id, origin_item.stock_item_id, p_quantity, p_item_condition, origin_item.id
  )
  RETURNING id INTO new_item_id;

  -- Atalho: as quatro etapas acontecem na mesma transacao. O material foi
  -- conferido no balcao, entao a triagem apenas confirma o estado declarado.
  new_return := public.submit_return_for_triage(new_return.id);

  new_return := public.save_return_triage(
    new_return.id,
    jsonb_build_array(
      jsonb_build_object(
        'stock_return_item_id', new_item_id,
        'conditions', jsonb_build_object(p_item_condition, p_quantity)
      )
    ),
    'Devolucao conferida no ato do registro.'
  );

  RETURN public.complete_return(new_return.id);
END;
$$;

REVOKE EXECUTE ON FUNCTION public.register_linked_stock_return(UUID, INTEGER, TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.register_linked_stock_return(UUID, INTEGER, TEXT) TO authenticated, service_role;

-- ---------------------------------------------------------------------------
-- A retirada com devolucao vinculada deixa de ficar totalmente congelada. O que
-- precisa de protecao e a quantidade e o destino, porque a devolucao se apoia
-- neles; os demais campos podem ser corrigidos.
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.prevent_linked_withdrawal_item_mutation()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM public.stock_return_items returned_item
    JOIN public.stock_returns parent_return
      ON parent_return.id = returned_item.stock_return_id
    WHERE returned_item.origin_withdrawal_item_id = OLD.id
      AND parent_return.status <> 'cancelled'
  ) THEN
    RAISE EXCEPTION 'Esta retirada possui devolucao vinculada e nao pode ter item, quantidade ou destino alterados. Cancele a devolucao primeiro.';
  END IF;

  IF TG_OP = 'DELETE' THEN
    RETURN OLD;
  END IF;

  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.prevent_rejecting_withdrawal_with_linked_returns()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF NEW.status = 'rejected'
     AND OLD.status IS DISTINCT FROM 'rejected'
     AND EXISTS (
       SELECT 1
       FROM public.withdrawal_items wi
       JOIN public.stock_return_items returned_item
         ON returned_item.origin_withdrawal_item_id = wi.id
       JOIN public.stock_returns parent_return
         ON parent_return.id = returned_item.stock_return_id
       WHERE wi.withdrawal_id = OLD.id
         AND parent_return.status <> 'cancelled'
     ) THEN
    RAISE EXCEPTION 'Nao e possivel rejeitar uma retirada que ja possui devolucao vinculada. Cancele a devolucao primeiro.';
  END IF;

  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.prevent_linked_withdrawal_item_mutation() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.prevent_rejecting_withdrawal_with_linked_returns() FROM PUBLIC, anon, authenticated;

-- ---------------------------------------------------------------------------
-- O ledger de eventos da devolucao antiga fica congelado junto com a tabela que
-- ele descrevia. Os fatos novos vao para stock_movement_events, que e o ledger
-- canonico desde a migration 051.
-- ---------------------------------------------------------------------------

COMMENT ON TABLE public.stock_return_events IS
  'Ledger do modelo anterior de devolucao. Congelado na migration 057; eventos novos vao para stock_movement_events.';

COMMIT;
