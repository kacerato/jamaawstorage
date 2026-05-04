BEGIN;

-- Remaining search_path hardening for utility/trigger functions flagged by the advisor.
ALTER FUNCTION public.handle_stock_restoration()
  SET search_path = public;

ALTER FUNCTION public.log_audit()
  SET search_path = public;

ALTER FUNCTION public.check_low_stock()
  SET search_path = public;

ALTER FUNCTION public.normalize_identifier_text(TEXT)
  SET search_path = public;

ALTER FUNCTION public.generate_stock_item_code(TEXT)
  SET search_path = public;

-- SECURITY DEFINER RPCs intentionally stay callable by authenticated users because
-- the app uses them, but they must enforce active-supervisor authorization inside
-- the function body instead of relying only on EXECUTE privilege.

CREATE OR REPLACE FUNCTION public.adjust_stock_item_quantity(
  p_stock_item_id UUID,
  p_delta INTEGER
)
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  next_quantity INTEGER;
BEGIN
  IF NOT public.is_active_supervisor() THEN
    RAISE EXCEPTION 'Acesso negado: somente supervisores ativos podem ajustar estoque.';
  END IF;

  IF p_delta = 0 THEN
    SELECT current_quantity
      INTO next_quantity
      FROM public.stock_items
     WHERE id = p_stock_item_id;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'Item de estoque nao encontrado.';
    END IF;

    RETURN next_quantity;
  END IF;

  UPDATE public.stock_items
     SET current_quantity = current_quantity + p_delta,
         updated_at = now()
   WHERE id = p_stock_item_id
     AND current_quantity + p_delta >= 0
  RETURNING current_quantity INTO next_quantity;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Nao foi possivel ajustar o estoque para este item.';
  END IF;

  RETURN next_quantity;
END;
$$;

CREATE OR REPLACE FUNCTION public.create_completed_withdrawal(
  p_requested_by UUID,
  p_destination_type public.withdrawal_destination_type,
  p_collaborator_id UUID DEFAULT NULL,
  p_work_site_id UUID DEFAULT NULL,
  p_authorized_by UUID DEFAULT NULL,
  p_notes TEXT DEFAULT NULL,
  p_photo_url TEXT DEFAULT NULL,
  p_supervisor_signature TEXT DEFAULT NULL,
  p_requester_signature TEXT DEFAULT NULL,
  p_witness_signature TEXT DEFAULT NULL,
  p_items JSONB DEFAULT '[]'::jsonb
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  new_withdrawal_id UUID;
  item_record JSONB;
  item_quantity INTEGER;
  item_stock_id UUID;
  item_unit TEXT;
  item_lot_id UUID;
BEGIN
  IF NOT public.is_active_supervisor() THEN
    RAISE EXCEPTION 'Acesso negado: somente supervisores ativos podem criar retiradas.';
  END IF;

  IF jsonb_typeof(p_items) IS DISTINCT FROM 'array' OR jsonb_array_length(p_items) = 0 THEN
    RAISE EXCEPTION 'Adicione ao menos um item a retirada.';
  END IF;

  INSERT INTO public.withdrawals (
    requested_by,
    destination_type,
    collaborator_id,
    work_site_id,
    authorized_by,
    status,
    notes,
    photo_url,
    supervisor_signature,
    requester_signature,
    witness_signature
  )
  VALUES (
    p_requested_by,
    p_destination_type,
    p_collaborator_id,
    p_work_site_id,
    p_authorized_by,
    'completed',
    p_notes,
    p_photo_url,
    p_supervisor_signature,
    p_requester_signature,
    p_witness_signature
  )
  RETURNING id INTO new_withdrawal_id;

  FOR item_record IN SELECT * FROM jsonb_array_elements(p_items)
  LOOP
    item_stock_id := (item_record->>'stock_item_id')::UUID;
    item_lot_id := CASE
      WHEN coalesce(item_record->>'lot_id', '') = '' THEN NULL
      ELSE (item_record->>'lot_id')::UUID
    END;
    item_unit := item_record->>'unit';
    item_quantity := (item_record->>'quantity')::INTEGER;

    IF item_stock_id IS NULL OR item_quantity IS NULL OR item_quantity <= 0 THEN
      RAISE EXCEPTION 'Item de retirada invalido.';
    END IF;

    INSERT INTO public.withdrawal_items (
      withdrawal_id,
      stock_item_id,
      lot_id,
      quantity,
      unit
    )
    VALUES (
      new_withdrawal_id,
      item_stock_id,
      item_lot_id,
      item_quantity,
      item_unit
    );
  END LOOP;

  RETURN new_withdrawal_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.update_stock_item_details_and_quantity(
  p_stock_item_id UUID,
  p_name TEXT,
  p_description TEXT DEFAULT NULL,
  p_category TEXT DEFAULT NULL,
  p_unit TEXT DEFAULT 'un',
  p_ca_nr TEXT DEFAULT NULL,
  p_minimum_quantity INTEGER DEFAULT 0,
  p_svg_icon_key TEXT DEFAULT NULL,
  p_stock_adjustment INTEGER DEFAULT 0
)
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  next_quantity INTEGER;
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

  UPDATE public.stock_items
     SET name = btrim(p_name),
         description = NULLIF(btrim(coalesce(p_description, '')), ''),
         category = NULLIF(btrim(coalesce(p_category, '')), ''),
         unit = btrim(coalesce(p_unit, 'un')),
         ca_nr = NULLIF(btrim(coalesce(p_ca_nr, '')), ''),
         minimum_quantity = p_minimum_quantity,
         svg_icon_key = p_svg_icon_key,
         current_quantity = current_quantity + p_stock_adjustment,
         updated_at = now()
   WHERE id = p_stock_item_id
     AND current_quantity + p_stock_adjustment >= 0
  RETURNING current_quantity INTO next_quantity;

  IF FOUND THEN
    RETURN next_quantity;
  END IF;

  IF EXISTS (SELECT 1 FROM public.stock_items WHERE id = p_stock_item_id) THEN
    RAISE EXCEPTION 'Nao foi possivel aplicar o ajuste porque o estoque ficaria negativo.';
  END IF;

  RAISE EXCEPTION 'Item de estoque nao encontrado.';
END;
$$;

CREATE OR REPLACE FUNCTION public.assign_inventory_item_to_person(
  p_person_id UUID,
  p_stock_item_id UUID,
  p_quantity INTEGER
)
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  new_withdrawal_id UUID;
  next_quantity INTEGER;
  current_user_id UUID;
  placeholder_signature TEXT := 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8Xw8AAoMBgN2VNivAAAAASUVORK5CYII=';
BEGIN
  IF NOT public.is_active_supervisor() THEN
    RAISE EXCEPTION 'Acesso negado: somente supervisores ativos podem movimentar inventario.';
  END IF;

  IF p_person_id IS NULL OR p_stock_item_id IS NULL THEN
    RAISE EXCEPTION 'Pessoa e item de estoque sao obrigatorios.';
  END IF;

  IF p_quantity IS NULL OR p_quantity <= 0 THEN
    RAISE EXCEPTION 'A quantidade precisa ser maior que zero.';
  END IF;

  current_user_id := auth.uid();

  IF current_user_id IS NULL THEN
    RAISE EXCEPTION 'Usuario autenticado nao encontrado.';
  END IF;

  IF NOT EXISTS (SELECT 1 FROM public.stock_items WHERE id = p_stock_item_id) THEN
    RAISE EXCEPTION 'Item de estoque nao encontrado.';
  END IF;

  INSERT INTO public.withdrawals (
    requested_by,
    destination_type,
    collaborator_id,
    authorized_by,
    status,
    notes,
    supervisor_signature,
    requester_signature,
    witness_signature
  )
  VALUES (
    p_person_id,
    'collaborator',
    p_person_id,
    current_user_id,
    'completed',
    'Movimentacao manual para inventario individual',
    placeholder_signature,
    placeholder_signature,
    NULL
  )
  RETURNING id INTO new_withdrawal_id;

  INSERT INTO public.withdrawal_items (
    withdrawal_id,
    stock_item_id,
    quantity,
    unit
  )
  SELECT
    new_withdrawal_id,
    si.id,
    p_quantity,
    si.unit
  FROM public.stock_items si
  WHERE si.id = p_stock_item_id;

  SELECT current_quantity
    INTO next_quantity
    FROM public.stock_items
   WHERE id = p_stock_item_id;

  RETURN next_quantity;
END;
$$;

-- Audit policy performance hardening.
DROP POLICY IF EXISTS "audit_logs_insert_own" ON public.audit_logs;
CREATE POLICY "audit_logs_insert_own" ON public.audit_logs
  FOR INSERT TO authenticated
  WITH CHECK (user_id = (SELECT auth.uid()));

COMMIT;
