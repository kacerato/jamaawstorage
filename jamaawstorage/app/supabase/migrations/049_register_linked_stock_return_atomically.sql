BEGIN;

-- A devolucao iniciada pela retirada nao passa por uma etapa manual adicional.
-- Insercao, baixa do inventario pessoal e entrada no estoque acontecem na mesma transacao.
CREATE OR REPLACE FUNCTION public.register_linked_stock_return(
  p_withdrawal_item_id UUID,
  p_quantity INTEGER,
  p_item_condition TEXT DEFAULT 'used'
)
RETURNS public.stock_return_requests
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  origin_item RECORD;
  new_return_id UUID;
  processed_return public.stock_return_requests%ROWTYPE;
BEGIN
  IF NOT public.is_active_supervisor() THEN
    RAISE EXCEPTION 'Acesso negado: somente supervisores ativos podem registrar devolucoes.';
  END IF;

  IF p_withdrawal_item_id IS NULL THEN
    RAISE EXCEPTION 'Informe o item da retirada que esta sendo devolvido.';
  END IF;

  IF p_quantity IS NULL OR p_quantity <= 0 THEN
    RAISE EXCEPTION 'Informe uma quantidade de devolucao maior que zero.';
  END IF;

  IF p_item_condition NOT IN ('used', 'damaged') THEN
    RAISE EXCEPTION 'Informe o estado do item como used ou damaged.';
  END IF;

  SELECT
    wi.id,
    wi.stock_item_id,
    COALESCE(wi.destination_type, w.destination_type) AS destination_type,
    CASE
      WHEN COALESCE(wi.destination_type, w.destination_type) = 'collaborator'
        THEN COALESCE(wi.collaborator_id, w.collaborator_id)
      ELSE NULL
    END AS collaborator_id,
    CASE
      WHEN COALESCE(wi.destination_type, w.destination_type) = 'work_site'
        THEN COALESCE(wi.work_site_id, w.work_site_id)
      ELSE NULL
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

  IF origin_item.destination_type = 'collaborator' AND origin_item.collaborator_id IS NULL THEN
    RAISE EXCEPTION 'A retirada vinculada nao possui colaborador valido.';
  END IF;

  IF origin_item.destination_type = 'work_site' AND origin_item.work_site_id IS NULL THEN
    RAISE EXCEPTION 'A retirada vinculada nao possui obra valida.';
  END IF;

  INSERT INTO public.stock_return_requests (
    origin_withdrawal_item_id,
    stock_item_id,
    quantity,
    item_condition,
    source_type,
    source_person_id,
    source_work_site_id,
    source_details,
    created_by
  )
  VALUES (
    origin_item.id,
    origin_item.stock_item_id,
    p_quantity,
    p_item_condition,
    origin_item.destination_type::TEXT,
    origin_item.collaborator_id,
    origin_item.work_site_id,
    format('Devolucao vinculada a retirada %s.', COALESCE(origin_item.code, 'sem codigo')),
    auth.uid()
  )
  RETURNING id INTO new_return_id;

  SELECT *
    INTO processed_return
  FROM public.process_stock_return_request(
    new_return_id,
    p_quantity,
    0,
    NULL,
    p_item_condition,
    NULL
  );

  RETURN processed_return;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.register_linked_stock_return(UUID, INTEGER, TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.register_linked_stock_return(UUID, INTEGER, TEXT) TO authenticated, service_role;

COMMIT;
