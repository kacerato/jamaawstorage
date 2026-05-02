CREATE OR REPLACE FUNCTION public.generate_withdrawal_code()
RETURNS TRIGGER AS $$
DECLARE
  today_code TEXT;
  next_seq BIGINT;
BEGIN
  today_code := 'RET-' || to_char(now(), 'YYYYMMDD');
  next_seq := nextval('withdrawal_code_seq');
  NEW.code := today_code || '-' || LPAD(next_seq::TEXT, 6, '0');
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION public.adjust_stock_item_quantity(
  p_stock_item_id UUID,
  p_delta INTEGER
)
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  next_quantity INTEGER;
BEGIN
  IF p_delta = 0 THEN
    SELECT current_quantity
      INTO next_quantity
      FROM public.stock_items
     WHERE id = p_stock_item_id;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'Item de estoque não encontrado.';
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
    RAISE EXCEPTION 'Não foi possível ajustar o estoque para este item.';
  END IF;

  RETURN next_quantity;
END;
$$;

CREATE OR REPLACE FUNCTION public.create_completed_withdrawal(
  p_requested_by UUID,
  p_destination_type withdrawal_destination_type,
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
AS $$
DECLARE
  new_withdrawal_id UUID;
  item_record JSONB;
  item_quantity INTEGER;
  item_stock_id UUID;
  item_unit TEXT;
  item_lot_id UUID;
BEGIN
  IF jsonb_typeof(p_items) IS DISTINCT FROM 'array' OR jsonb_array_length(p_items) = 0 THEN
    RAISE EXCEPTION 'Adicione ao menos um item à retirada.';
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
      RAISE EXCEPTION 'Item de retirada inválido.';
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

GRANT EXECUTE ON FUNCTION public.adjust_stock_item_quantity(UUID, INTEGER) TO authenticated;
GRANT EXECUTE ON FUNCTION public.create_completed_withdrawal(UUID, withdrawal_destination_type, UUID, UUID, UUID, TEXT, TEXT, TEXT, TEXT, TEXT, JSONB) TO authenticated;
