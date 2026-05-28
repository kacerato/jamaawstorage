BEGIN;

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
  requester_person_id UUID;
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

  SELECT id
    INTO requester_person_id
    FROM public.people
   WHERE profile_id = current_user_id
     AND role = 'supervisor'
     AND is_active = true
   LIMIT 1;

  IF requester_person_id IS NULL THEN
    RAISE EXCEPTION 'Supervisor solicitante nao encontrado para o usuario autenticado.';
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
    requester_person_id,
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
    unit,
    destination_type,
    collaborator_id,
    work_site_id
  )
  SELECT
    new_withdrawal_id,
    si.id,
    p_quantity,
    si.unit,
    'collaborator'::public.withdrawal_destination_type,
    p_person_id,
    NULL::UUID
  FROM public.stock_items si
  WHERE si.id = p_stock_item_id;

  SELECT current_quantity
    INTO next_quantity
    FROM public.stock_items
   WHERE id = p_stock_item_id;

  RETURN next_quantity;
END;
$$;

CREATE OR REPLACE FUNCTION public.assign_inventory_items_to_person(
  p_person_id UUID,
  p_items JSONB
)
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  current_user_id UUID;
  requester_person_id UUID;
  new_withdrawal_id UUID;
  placeholder_signature TEXT := 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8Xw8AAoMBgN2VNivAAAAASUVORK5CYII=';
  total_quantity INTEGER;
  invalid_item_name TEXT;
BEGIN
  IF NOT public.is_active_supervisor() THEN
    RAISE EXCEPTION 'Acesso negado: somente supervisores ativos podem movimentar inventario.';
  END IF;

  IF p_person_id IS NULL THEN
    RAISE EXCEPTION 'Pessoa obrigatoria.';
  END IF;

  IF p_items IS NULL OR jsonb_typeof(p_items) <> 'array' OR jsonb_array_length(p_items) = 0 THEN
    RAISE EXCEPTION 'Informe ao menos um item para o inventario.';
  END IF;

  current_user_id := auth.uid();

  IF current_user_id IS NULL THEN
    RAISE EXCEPTION 'Usuario autenticado nao encontrado.';
  END IF;

  SELECT id
    INTO requester_person_id
    FROM public.people
   WHERE profile_id = current_user_id
     AND role = 'supervisor'
     AND is_active = true
   LIMIT 1;

  IF requester_person_id IS NULL THEN
    RAISE EXCEPTION 'Supervisor solicitante nao encontrado para o usuario autenticado.';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM public.people
    WHERE id = p_person_id
      AND role = 'collaborator'
  ) THEN
    RAISE EXCEPTION 'Colaborador nao encontrado.';
  END IF;

  WITH normalized_items AS (
    SELECT
      (entry->>'stock_item_id')::UUID AS stock_item_id,
      SUM((entry->>'quantity')::INTEGER) AS quantity
    FROM jsonb_array_elements(p_items) entry
    GROUP BY (entry->>'stock_item_id')::UUID
  )
  SELECT SUM(quantity)
    INTO total_quantity
  FROM normalized_items;

  IF total_quantity IS NULL OR total_quantity <= 0 THEN
    RAISE EXCEPTION 'A quantidade total precisa ser maior que zero.';
  END IF;

  WITH normalized_items AS (
    SELECT
      (entry->>'stock_item_id')::UUID AS stock_item_id,
      SUM((entry->>'quantity')::INTEGER) AS quantity
    FROM jsonb_array_elements(p_items) entry
    GROUP BY (entry->>'stock_item_id')::UUID
  )
  SELECT si.name
    INTO invalid_item_name
  FROM normalized_items ni
  JOIN public.stock_items si ON si.id = ni.stock_item_id
  WHERE ni.quantity <= 0
     OR si.current_quantity < ni.quantity
  LIMIT 1;

  IF invalid_item_name IS NOT NULL THEN
    RAISE EXCEPTION 'Estoque insuficiente para o item: %.', invalid_item_name;
  END IF;

  IF EXISTS (
    WITH normalized_items AS (
      SELECT
        (entry->>'stock_item_id')::UUID AS stock_item_id,
        SUM((entry->>'quantity')::INTEGER) AS quantity
      FROM jsonb_array_elements(p_items) entry
      GROUP BY (entry->>'stock_item_id')::UUID
    )
    SELECT 1
    FROM normalized_items ni
    LEFT JOIN public.stock_items si ON si.id = ni.stock_item_id
    WHERE si.id IS NULL
  ) THEN
    RAISE EXCEPTION 'Um ou mais itens de estoque nao foram encontrados.';
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
    requester_person_id,
    'collaborator',
    p_person_id,
    current_user_id,
    'completed',
    'Movimentacao manual em lote para inventario individual',
    placeholder_signature,
    placeholder_signature,
    NULL
  )
  RETURNING id INTO new_withdrawal_id;

  WITH normalized_items AS (
    SELECT
      (entry->>'stock_item_id')::UUID AS stock_item_id,
      SUM((entry->>'quantity')::INTEGER) AS quantity
    FROM jsonb_array_elements(p_items) entry
    GROUP BY (entry->>'stock_item_id')::UUID
  )
  INSERT INTO public.withdrawal_items (
    withdrawal_id,
    stock_item_id,
    quantity,
    unit,
    destination_type,
    collaborator_id,
    work_site_id
  )
  SELECT
    new_withdrawal_id,
    si.id,
    ni.quantity,
    si.unit,
    'collaborator'::public.withdrawal_destination_type,
    p_person_id,
    NULL::UUID
  FROM normalized_items ni
  JOIN public.stock_items si ON si.id = ni.stock_item_id;

  RETURN total_quantity;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.assign_inventory_item_to_person(UUID, UUID, INTEGER) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.assign_inventory_items_to_person(UUID, JSONB) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.assign_inventory_item_to_person(UUID, UUID, INTEGER) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.assign_inventory_items_to_person(UUID, JSONB) TO authenticated, service_role;

COMMIT;
