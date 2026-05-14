BEGIN;

ALTER TABLE public.stock_return_requests
  ADD COLUMN IF NOT EXISTS item_photo_url TEXT NULL,
  ADD COLUMN IF NOT EXISTS triage_notes TEXT NULL,
  ADD COLUMN IF NOT EXISTS approved_quantity INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS held_quantity INTEGER NOT NULL DEFAULT 0;

UPDATE public.stock_return_requests
SET
  approved_quantity = CASE
    WHEN status = 'approved' THEN quantity
    ELSE approved_quantity
  END,
  held_quantity = CASE
    WHEN status = 'held' THEN quantity
    ELSE held_quantity
  END
WHERE approved_quantity = 0
   OR held_quantity = 0;

ALTER TABLE public.stock_return_requests
  DROP CONSTRAINT IF EXISTS stock_return_requests_quantity_distribution_check;

ALTER TABLE public.stock_return_requests
  ADD CONSTRAINT stock_return_requests_quantity_distribution_check
  CHECK (
    approved_quantity >= 0
    AND held_quantity >= 0
    AND approved_quantity + held_quantity <= quantity
  );

DROP FUNCTION IF EXISTS public.set_stock_return_request_status(UUID, TEXT);
DROP FUNCTION IF EXISTS public.approve_stock_return_request(UUID);

CREATE OR REPLACE FUNCTION public.process_stock_return_request(
  p_request_id UUID,
  p_approve_quantity INTEGER,
  p_hold_quantity INTEGER,
  p_triage_notes TEXT DEFAULT NULL
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

  IF p_approve_quantity + p_hold_quantity <> remaining_quantity THEN
    RAISE EXCEPTION 'Distribua exatamente a quantidade restante da devolucao. Restante atual: %.', remaining_quantity;
  END IF;

  IF p_approve_quantity > 0 THEN
    UPDATE public.stock_items
    SET
      current_quantity = current_quantity + p_approve_quantity,
      updated_at = now()
    WHERE id = target_request.stock_item_id;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'Item de estoque nao encontrado para aprovar a devolucao.';
    END IF;
  END IF;

  next_status := CASE
    WHEN target_request.approved_quantity + p_approve_quantity = target_request.quantity THEN 'approved'
    WHEN target_request.held_quantity + p_hold_quantity > 0 THEN 'held'
    ELSE 'pending'
  END;

  UPDATE public.stock_return_requests
  SET
    approved_quantity = approved_quantity + p_approve_quantity,
    held_quantity = held_quantity + p_hold_quantity,
    triage_notes = COALESCE(NULLIF(trim(p_triage_notes), ''), triage_notes),
    status = next_status,
    approved_by = CASE
      WHEN p_approve_quantity > 0 THEN supervisor_profile_id
      ELSE approved_by
    END,
    approved_at = CASE
      WHEN p_approve_quantity > 0 THEN now()
      ELSE approved_at
    END,
    updated_at = now()
  WHERE id = p_request_id
  RETURNING * INTO target_request;

  RETURN target_request;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.process_stock_return_request(UUID, INTEGER, INTEGER, TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.process_stock_return_request(UUID, INTEGER, INTEGER, TEXT) TO authenticated, service_role;

COMMIT;
