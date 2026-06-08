BEGIN;

CREATE OR REPLACE FUNCTION public.adjust_inventory_item_quantity(
  p_person_id UUID,
  p_stock_item_id UUID,
  p_next_quantity INTEGER,
  p_reason TEXT
)
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  current_user_id UUID;
  current_inventory public.person_inventories%ROWTYPE;
  sanitized_reason TEXT;
BEGIN
  IF NOT public.is_active_supervisor() THEN
    RAISE EXCEPTION 'Acesso negado: somente supervisores ativos podem ajustar inventario.';
  END IF;

  IF p_person_id IS NULL OR p_stock_item_id IS NULL THEN
    RAISE EXCEPTION 'Colaborador e item sao obrigatorios.';
  END IF;

  IF p_next_quantity IS NULL OR p_next_quantity < 0 THEN
    RAISE EXCEPTION 'A quantidade final nao pode ser negativa.';
  END IF;

  sanitized_reason := NULLIF(btrim(coalesce(p_reason, '')), '');

  IF sanitized_reason IS NULL THEN
    RAISE EXCEPTION 'Informe o motivo do ajuste.';
  END IF;

  current_user_id := auth.uid();

  IF current_user_id IS NULL THEN
    RAISE EXCEPTION 'Usuario autenticado nao encontrado.';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM public.people
    WHERE id = p_person_id
      AND role = 'collaborator'
  ) THEN
    RAISE EXCEPTION 'Colaborador nao encontrado.';
  END IF;

  IF NOT EXISTS (SELECT 1 FROM public.stock_items WHERE id = p_stock_item_id) THEN
    RAISE EXCEPTION 'Item de estoque nao encontrado.';
  END IF;

  SELECT *
    INTO current_inventory
  FROM public.person_inventories
  WHERE person_id = p_person_id
    AND stock_item_id = p_stock_item_id
  FOR UPDATE;

  IF current_inventory.id IS NULL THEN
    IF p_next_quantity = 0 THEN
      INSERT INTO public.audit_logs (user_id, action, table_name, record_id, old_data, new_data)
      VALUES (
        current_user_id,
        'UPDATE',
        'person_inventories',
        p_person_id,
        jsonb_build_object('person_id', p_person_id, 'stock_item_id', p_stock_item_id, 'quantity', 0),
        jsonb_build_object('person_id', p_person_id, 'stock_item_id', p_stock_item_id, 'quantity', 0, 'reason', sanitized_reason, 'event', 'inventory_adjust', 'noop', true)
      );

      RETURN 0;
    END IF;

    INSERT INTO public.person_inventories (person_id, stock_item_id, quantity, last_withdrawal_id)
    VALUES (p_person_id, p_stock_item_id, p_next_quantity, NULL)
    RETURNING * INTO current_inventory;

    INSERT INTO public.audit_logs (user_id, action, table_name, record_id, old_data, new_data)
    VALUES (
      current_user_id,
      'INSERT',
      'person_inventories',
      current_inventory.id,
      jsonb_build_object('person_id', p_person_id, 'stock_item_id', p_stock_item_id, 'quantity', 0),
      jsonb_build_object('person_id', p_person_id, 'stock_item_id', p_stock_item_id, 'quantity', p_next_quantity, 'reason', sanitized_reason, 'event', 'inventory_adjust')
    );

    RETURN p_next_quantity;
  END IF;

  IF current_inventory.quantity = p_next_quantity THEN
    IF current_inventory.last_withdrawal_id IS NOT NULL THEN
      UPDATE public.person_inventories
         SET last_withdrawal_id = NULL,
             updated_at = now()
       WHERE id = current_inventory.id;
    END IF;

    INSERT INTO public.audit_logs (user_id, action, table_name, record_id, old_data, new_data)
    VALUES (
      current_user_id,
      'UPDATE',
      'person_inventories',
      current_inventory.id,
      jsonb_build_object('quantity', current_inventory.quantity, 'last_withdrawal_id', current_inventory.last_withdrawal_id),
      jsonb_build_object('quantity', p_next_quantity, 'last_withdrawal_id', NULL, 'reason', sanitized_reason, 'event', 'inventory_adjust', 'quantity_unchanged', true)
    );

    RETURN p_next_quantity;
  END IF;

  IF p_next_quantity = 0 THEN
    DELETE FROM public.person_inventories
    WHERE id = current_inventory.id;
  ELSE
    UPDATE public.person_inventories
       SET quantity = p_next_quantity,
           last_withdrawal_id = NULL,
           updated_at = now()
     WHERE id = current_inventory.id;
  END IF;

  INSERT INTO public.audit_logs (user_id, action, table_name, record_id, old_data, new_data)
  VALUES (
    current_user_id,
    CASE WHEN p_next_quantity = 0 THEN 'DELETE' ELSE 'UPDATE' END,
    'person_inventories',
    current_inventory.id,
    jsonb_build_object('quantity', current_inventory.quantity, 'last_withdrawal_id', current_inventory.last_withdrawal_id, 'event', 'inventory_adjust'),
    jsonb_build_object('quantity', p_next_quantity, 'last_withdrawal_id', NULL, 'reason', sanitized_reason, 'event', 'inventory_adjust')
  );

  RETURN p_next_quantity;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.adjust_inventory_item_quantity(UUID, UUID, INTEGER, TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.adjust_inventory_item_quantity(UUID, UUID, INTEGER, TEXT) TO authenticated, service_role;

COMMIT;
