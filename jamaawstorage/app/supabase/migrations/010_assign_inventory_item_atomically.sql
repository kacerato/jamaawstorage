CREATE OR REPLACE FUNCTION public.assign_inventory_item_to_person(
  p_person_id UUID,
  p_stock_item_id UUID,
  p_quantity INTEGER
)
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  new_withdrawal_id UUID;
  next_quantity INTEGER;
  current_user_id UUID;
BEGIN
  IF p_person_id IS NULL OR p_stock_item_id IS NULL THEN
    RAISE EXCEPTION 'Pessoa e item de estoque sao obrigatorios.';
  END IF;

  IF p_quantity IS NULL OR p_quantity <= 0 THEN
    RAISE EXCEPTION 'A quantidade precisa ser maior que zero.';
  END IF;

  current_user_id := auth.uid();

  IF NOT EXISTS (SELECT 1 FROM public.stock_items WHERE id = p_stock_item_id) THEN
    RAISE EXCEPTION 'Item de estoque nao encontrado.';
  END IF;

  INSERT INTO public.withdrawals (
    requested_by,
    destination_type,
    collaborator_id,
    authorized_by,
    status,
    notes
  )
  VALUES (
    p_person_id,
    'collaborator',
    p_person_id,
    current_user_id,
    'completed',
    'Movimentacao manual para inventario individual'
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

GRANT EXECUTE ON FUNCTION public.assign_inventory_item_to_person(UUID, UUID, INTEGER) TO authenticated;
