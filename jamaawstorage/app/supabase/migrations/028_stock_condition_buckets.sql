BEGIN;

ALTER TABLE public.stock_items
  ADD COLUMN IF NOT EXISTS quantity_new INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS quantity_used INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS quantity_damaged INTEGER NOT NULL DEFAULT 0;

UPDATE public.stock_items
SET
  quantity_new = current_quantity,
  quantity_used = 0,
  quantity_damaged = 0
WHERE quantity_new = 0
  AND quantity_used = 0
  AND quantity_damaged = 0
  AND current_quantity > 0;

ALTER TABLE public.stock_items
  DROP CONSTRAINT IF EXISTS stock_items_condition_bucket_check;

ALTER TABLE public.stock_items
  ADD CONSTRAINT stock_items_condition_bucket_check
  CHECK (
    quantity_new >= 0
    AND quantity_used >= 0
    AND quantity_damaged >= 0
    AND quantity_new + quantity_used + quantity_damaged = current_quantity
  );

ALTER TABLE public.stock_return_requests
  ADD COLUMN IF NOT EXISTS item_condition TEXT NOT NULL DEFAULT 'used';

ALTER TABLE public.stock_return_requests
  DROP CONSTRAINT IF EXISTS stock_return_requests_item_condition_check;

ALTER TABLE public.stock_return_requests
  ADD CONSTRAINT stock_return_requests_item_condition_check
  CHECK (item_condition IN ('used', 'damaged'));

DROP FUNCTION IF EXISTS public.update_stock_item_details_and_quantity(
  UUID,
  TEXT,
  TEXT,
  TEXT,
  TEXT,
  TEXT,
  INTEGER,
  TEXT,
  INTEGER
);

CREATE OR REPLACE FUNCTION public.update_stock_item_details_and_quantity(
  p_stock_item_id UUID,
  p_name TEXT,
  p_description TEXT DEFAULT NULL,
  p_category TEXT DEFAULT NULL,
  p_unit TEXT DEFAULT 'un',
  p_ca_nr TEXT DEFAULT NULL,
  p_minimum_quantity INTEGER DEFAULT 0,
  p_svg_icon_key TEXT DEFAULT NULL,
  p_stock_adjustment INTEGER DEFAULT 0,
  p_quantity_new INTEGER DEFAULT NULL,
  p_quantity_used INTEGER DEFAULT NULL,
  p_quantity_damaged INTEGER DEFAULT NULL,
  p_adjustment_bucket TEXT DEFAULT 'new'
)
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  target_item public.stock_items%ROWTYPE;
  next_quantity_new INTEGER;
  next_quantity_used INTEGER;
  next_quantity_damaged INTEGER;
BEGIN
  IF NOT public.is_active_supervisor() THEN
    RAISE EXCEPTION 'Acesso negado: somente supervisores ativos podem atualizar itens.';
  END IF;

  IF p_name IS NULL OR btrim(p_name) = '' THEN
    RAISE EXCEPTION 'O nome do item e obrigatorio.';
  END IF;

  IF p_minimum_quantity < 0 THEN
    RAISE EXCEPTION 'A quantidade minima nao pode ser negativa.';
  END IF;

  IF p_adjustment_bucket NOT IN ('new', 'used', 'damaged') THEN
    RAISE EXCEPTION 'Bucket invalido. Use new, used ou damaged.';
  END IF;

  SELECT *
    INTO target_item
  FROM public.stock_items
  WHERE id = p_stock_item_id
  FOR UPDATE;

  IF target_item.id IS NULL THEN
    RAISE EXCEPTION 'Item de estoque nao encontrado.';
  END IF;

  next_quantity_new := COALESCE(p_quantity_new, target_item.quantity_new);
  next_quantity_used := COALESCE(p_quantity_used, target_item.quantity_used);
  next_quantity_damaged := COALESCE(p_quantity_damaged, target_item.quantity_damaged);

  IF p_stock_adjustment <> 0 THEN
    IF p_adjustment_bucket = 'new' THEN
      next_quantity_new := next_quantity_new + p_stock_adjustment;
    ELSIF p_adjustment_bucket = 'used' THEN
      next_quantity_used := next_quantity_used + p_stock_adjustment;
    ELSE
      next_quantity_damaged := next_quantity_damaged + p_stock_adjustment;
    END IF;
  END IF;

  IF next_quantity_new < 0 OR next_quantity_used < 0 OR next_quantity_damaged < 0 THEN
    RAISE EXCEPTION 'A classificacao do estoque nao pode ficar negativa.';
  END IF;

  UPDATE public.stock_items
     SET name = btrim(p_name),
         description = NULLIF(btrim(coalesce(p_description, '')), ''),
         category = NULLIF(btrim(coalesce(p_category, '')), ''),
         unit = btrim(coalesce(p_unit, 'un')),
         ca_nr = NULLIF(btrim(coalesce(p_ca_nr, '')), ''),
         minimum_quantity = p_minimum_quantity,
         svg_icon_key = p_svg_icon_key,
         quantity_new = next_quantity_new,
         quantity_used = next_quantity_used,
         quantity_damaged = next_quantity_damaged,
         current_quantity = next_quantity_new + next_quantity_used + next_quantity_damaged,
         updated_at = now()
   WHERE id = p_stock_item_id;

  RETURN next_quantity_new + next_quantity_used + next_quantity_damaged;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.update_stock_item_details_and_quantity(
  UUID,
  TEXT,
  TEXT,
  TEXT,
  TEXT,
  TEXT,
  INTEGER,
  TEXT,
  INTEGER,
  INTEGER,
  INTEGER,
  INTEGER,
  TEXT
) FROM PUBLIC, anon;

GRANT EXECUTE ON FUNCTION public.update_stock_item_details_and_quantity(
  UUID,
  TEXT,
  TEXT,
  TEXT,
  TEXT,
  TEXT,
  INTEGER,
  TEXT,
  INTEGER,
  INTEGER,
  INTEGER,
  INTEGER,
  TEXT
) TO authenticated, service_role;

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
      quantity_new = quantity_new + CASE WHEN target_request.item_condition = 'used' THEN 0 ELSE 0 END,
      quantity_used = quantity_used + CASE WHEN target_request.item_condition = 'used' THEN p_approve_quantity ELSE 0 END,
      quantity_damaged = quantity_damaged + CASE WHEN target_request.item_condition = 'damaged' THEN p_approve_quantity ELSE 0 END,
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
