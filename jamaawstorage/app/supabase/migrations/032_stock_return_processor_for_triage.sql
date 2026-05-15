BEGIN;

CREATE OR REPLACE FUNCTION public.process_stock_return_request(
  p_request_id UUID,
  p_approve_quantity INTEGER,
  p_hold_quantity INTEGER,
  p_triage_notes TEXT DEFAULT NULL,
  p_approved_condition TEXT DEFAULT NULL,
  p_hold_condition TEXT DEFAULT NULL
)
RETURNS public.stock_return_requests
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  target_request public.stock_return_requests%ROWTYPE;
  supervisor_profile_id UUID;
  remaining_quantity INTEGER;
  next_status TEXT;
  effective_approved_condition TEXT;
  effective_hold_condition TEXT;
BEGIN
  IF NOT public.is_active_supervisor() THEN
    RAISE EXCEPTION 'Acesso negado: somente supervisores ativos podem processar devolucoes.';
  END IF;

  IF p_request_id IS NULL THEN
    RAISE EXCEPTION 'Informe a devolucao que sera processada.';
  END IF;

  IF p_approve_quantity IS NULL OR p_approve_quantity < 0 THEN
    RAISE EXCEPTION 'A quantidade aprovada deve ser zero ou maior.';
  END IF;

  IF p_hold_quantity IS NULL OR p_hold_quantity < 0 THEN
    RAISE EXCEPTION 'A quantidade mantida deve ser zero ou maior.';
  END IF;

  SELECT id
    INTO supervisor_profile_id
  FROM public.profiles
  WHERE id = auth.uid();

  SELECT *
    INTO target_request
  FROM public.stock_return_requests
  WHERE id = p_request_id
  FOR UPDATE;

  IF target_request.id IS NULL THEN
    RAISE EXCEPTION 'Devolucao nao encontrada.';
  END IF;

  remaining_quantity := target_request.quantity - target_request.approved_quantity - target_request.held_quantity;

  IF remaining_quantity < 0 THEN
    RAISE EXCEPTION 'A devolucao esta com distribuicao invalida.';
  END IF;

  IF p_approve_quantity + p_hold_quantity <= 0 THEN
    RAISE EXCEPTION 'Informe pelo menos uma quantidade para processar.';
  END IF;

  IF p_approve_quantity + p_hold_quantity > remaining_quantity THEN
    RAISE EXCEPTION 'A quantidade processada nao pode passar do restante atual: %.', remaining_quantity;
  END IF;

  effective_approved_condition := COALESCE(NULLIF(trim(coalesce(p_approved_condition, '')), ''), target_request.approved_condition);
  effective_hold_condition := COALESCE(NULLIF(trim(coalesce(p_hold_condition, '')), ''), target_request.item_condition);

  IF p_approve_quantity > 0 THEN
    IF effective_approved_condition NOT IN ('new', 'used', 'damaged') THEN
      RAISE EXCEPTION 'Informe se a quantidade aprovada volta como new, used ou damaged.';
    END IF;

    IF target_request.approved_quantity > 0
       AND target_request.approved_condition IS NOT NULL
       AND target_request.approved_condition <> effective_approved_condition THEN
      RAISE EXCEPTION 'A devolucao ja possui quantidade aprovada em outro estado.';
    END IF;

    UPDATE public.stock_items
    SET
      current_quantity = current_quantity + p_approve_quantity,
      quantity_new = quantity_new + CASE WHEN effective_approved_condition = 'new' THEN p_approve_quantity ELSE 0 END,
      quantity_used = quantity_used + CASE WHEN effective_approved_condition = 'used' THEN p_approve_quantity ELSE 0 END,
      quantity_damaged = quantity_damaged + CASE WHEN effective_approved_condition = 'damaged' THEN p_approve_quantity ELSE 0 END,
      updated_at = now()
    WHERE id = target_request.stock_item_id;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'Item de estoque nao encontrado para aprovar a devolucao.';
    END IF;
  END IF;

  IF p_hold_quantity > 0 THEN
    IF effective_hold_condition NOT IN ('used', 'damaged') THEN
      RAISE EXCEPTION 'A triagem so pode permanecer como used ou damaged.';
    END IF;

    IF target_request.held_quantity > 0
       AND target_request.item_condition <> effective_hold_condition THEN
      RAISE EXCEPTION 'A devolucao ja possui quantidade em triagem em outro estado.';
    END IF;
  END IF;

  next_status := CASE
    WHEN target_request.approved_quantity + target_request.held_quantity + p_approve_quantity + p_hold_quantity < target_request.quantity THEN 'pending'
    WHEN target_request.approved_quantity + p_approve_quantity = target_request.quantity THEN 'approved'
    WHEN target_request.held_quantity + p_hold_quantity > 0 THEN 'held'
    ELSE 'pending'
  END;

  UPDATE public.stock_return_requests
  SET
    approved_quantity = approved_quantity + p_approve_quantity,
    held_quantity = held_quantity + p_hold_quantity,
    approved_condition = CASE
      WHEN p_approve_quantity > 0 THEN effective_approved_condition
      ELSE approved_condition
    END,
    item_condition = CASE
      WHEN p_hold_quantity > 0 THEN effective_hold_condition
      ELSE item_condition
    END,
    triage_notes = COALESCE(NULLIF(trim(p_triage_notes), ''), triage_notes),
    status = next_status,
    approved_by = CASE
      WHEN p_approve_quantity > 0 OR p_hold_quantity > 0 THEN supervisor_profile_id
      ELSE approved_by
    END,
    approved_at = CASE
      WHEN p_approve_quantity > 0 OR p_hold_quantity > 0 THEN now()
      ELSE approved_at
    END,
    updated_at = now()
  WHERE id = p_request_id
  RETURNING * INTO target_request;

  RETURN target_request;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.process_stock_return_request(UUID, INTEGER, INTEGER, TEXT, TEXT, TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.process_stock_return_request(UUID, INTEGER, INTEGER, TEXT, TEXT, TEXT) TO authenticated, service_role;

COMMIT;
