BEGIN;

CREATE OR REPLACE FUNCTION public.handle_stock_deduction()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  w_dest_type public.withdrawal_destination_type;
  w_collab_id UUID;
  w_status public.withdrawal_status;
  effective_dest_type public.withdrawal_destination_type;
  effective_collab_id UUID;
BEGIN
  SELECT destination_type, collaborator_id, status
    INTO w_dest_type, w_collab_id, w_status
  FROM public.withdrawals
  WHERE id = NEW.withdrawal_id;

  IF w_status = 'rejected' THEN
    RETURN NEW;
  END IF;

  effective_dest_type := COALESCE(NEW.destination_type, w_dest_type);
  effective_collab_id := CASE
    WHEN effective_dest_type = 'collaborator' THEN COALESCE(NEW.collaborator_id, w_collab_id)
    ELSE NULL
  END;

  PERFORM public.consume_stock_item_quantity(NEW.stock_item_id, NEW.quantity);

  IF NEW.lot_id IS NOT NULL THEN
    UPDATE public.stock_item_lots
       SET quantity = quantity - NEW.quantity,
           updated_at = now()
     WHERE id = NEW.lot_id
       AND quantity >= NEW.quantity;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'Lote sem quantidade suficiente para a retirada.';
    END IF;
  END IF;

  IF effective_dest_type = 'collaborator' AND effective_collab_id IS NOT NULL THEN
    INSERT INTO public.person_inventories (person_id, stock_item_id, quantity, last_withdrawal_id)
    VALUES (effective_collab_id, NEW.stock_item_id, NEW.quantity, NEW.withdrawal_id)
    ON CONFLICT (person_id, stock_item_id) DO NOTHING;
  END IF;

  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.handle_stock_restoration()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  item_to_restore RECORD;
  effective_dest_type public.withdrawal_destination_type;
  effective_collab_id UUID;
BEGIN
  IF OLD.status = NEW.status THEN
    RETURN NEW;
  END IF;

  IF NEW.status = 'rejected' AND OLD.status <> 'rejected' THEN
    FOR item_to_restore IN
      SELECT *
      FROM public.withdrawal_items
      WHERE withdrawal_id = NEW.id
    LOOP
      effective_dest_type := COALESCE(item_to_restore.destination_type, OLD.destination_type);
      effective_collab_id := CASE
        WHEN effective_dest_type = 'collaborator' THEN COALESCE(item_to_restore.collaborator_id, OLD.collaborator_id)
        ELSE NULL
      END;

      PERFORM public.restore_stock_item_quantity(item_to_restore.stock_item_id, item_to_restore.quantity, 'used');

      IF item_to_restore.lot_id IS NOT NULL THEN
        UPDATE public.stock_item_lots
           SET quantity = quantity + item_to_restore.quantity,
               updated_at = now()
         WHERE id = item_to_restore.lot_id;
      END IF;

      IF effective_dest_type = 'collaborator' AND effective_collab_id IS NOT NULL THEN
        UPDATE public.person_inventories
           SET quantity = GREATEST(quantity - item_to_restore.quantity, 0),
               updated_at = now()
         WHERE person_id = effective_collab_id
           AND stock_item_id = item_to_restore.stock_item_id
           AND last_withdrawal_id = NEW.id;

        DELETE FROM public.person_inventories
         WHERE quantity = 0
           AND person_id = effective_collab_id
           AND stock_item_id = item_to_restore.stock_item_id
           AND last_withdrawal_id = NEW.id;
      END IF;
    END LOOP;
  END IF;

  RETURN NEW;
END;
$$;

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
        'INVENTORY_ADJUST',
        'person_inventories',
        p_person_id,
        jsonb_build_object('person_id', p_person_id, 'stock_item_id', p_stock_item_id, 'quantity', 0),
        jsonb_build_object('person_id', p_person_id, 'stock_item_id', p_stock_item_id, 'quantity', 0, 'reason', sanitized_reason, 'noop', true)
      );

      RETURN 0;
    END IF;

    INSERT INTO public.person_inventories (person_id, stock_item_id, quantity, last_withdrawal_id)
    VALUES (p_person_id, p_stock_item_id, p_next_quantity, NULL)
    RETURNING * INTO current_inventory;

    INSERT INTO public.audit_logs (user_id, action, table_name, record_id, old_data, new_data)
    VALUES (
      current_user_id,
      'INVENTORY_ADJUST',
      'person_inventories',
      current_inventory.id,
      jsonb_build_object('person_id', p_person_id, 'stock_item_id', p_stock_item_id, 'quantity', 0),
      jsonb_build_object('person_id', p_person_id, 'stock_item_id', p_stock_item_id, 'quantity', p_next_quantity, 'reason', sanitized_reason)
    );

    RETURN p_next_quantity;
  END IF;

  IF current_inventory.quantity = p_next_quantity THEN
    INSERT INTO public.audit_logs (user_id, action, table_name, record_id, old_data, new_data)
    VALUES (
      current_user_id,
      'INVENTORY_ADJUST',
      'person_inventories',
      current_inventory.id,
      jsonb_build_object('quantity', current_inventory.quantity),
      jsonb_build_object('quantity', p_next_quantity, 'reason', sanitized_reason, 'noop', true)
    );

    RETURN p_next_quantity;
  END IF;

  IF p_next_quantity = 0 THEN
    DELETE FROM public.person_inventories
    WHERE id = current_inventory.id;
  ELSE
    UPDATE public.person_inventories
       SET quantity = p_next_quantity,
           updated_at = now()
     WHERE id = current_inventory.id;
  END IF;

  INSERT INTO public.audit_logs (user_id, action, table_name, record_id, old_data, new_data)
  VALUES (
    current_user_id,
    'INVENTORY_ADJUST',
    'person_inventories',
    current_inventory.id,
    jsonb_build_object('quantity', current_inventory.quantity),
    jsonb_build_object('quantity', p_next_quantity, 'reason', sanitized_reason)
  );

  RETURN p_next_quantity;
END;
$$;

CREATE OR REPLACE FUNCTION public.update_completed_withdrawal(
  p_withdrawal_id UUID,
  p_requested_by UUID,
  p_destination_type public.withdrawal_destination_type,
  p_collaborator_id UUID DEFAULT NULL,
  p_work_site_id UUID DEFAULT NULL,
  p_notes TEXT DEFAULT NULL,
  p_items JSONB DEFAULT '[]'::jsonb
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  target_withdrawal public.withdrawals%ROWTYPE;
  existing_item public.withdrawal_items%ROWTYPE;
  remaining_item public.withdrawal_items%ROWTYPE;
  item_record JSONB;
  item_withdrawal_item_id UUID;
  item_stock_id UUID;
  item_lot_id UUID;
  item_quantity INTEGER;
  item_unit TEXT;
  item_destination_type public.withdrawal_destination_type;
  item_collaborator_id UUID;
  item_work_site_id UUID;
  old_destination_type public.withdrawal_destination_type;
  old_collaborator_id UUID;
  quantity_delta INTEGER;
  processed_ids UUID[] := ARRAY[]::UUID[];
BEGIN
  IF NOT public.is_active_supervisor() THEN
    RAISE EXCEPTION 'Acesso negado: somente supervisores ativos podem editar retiradas.';
  END IF;

  IF p_withdrawal_id IS NULL THEN
    RAISE EXCEPTION 'Retirada nao informada.';
  END IF;

  IF p_requested_by IS NULL THEN
    RAISE EXCEPTION 'Solicitante nao informado.';
  END IF;

  IF jsonb_typeof(p_items) IS DISTINCT FROM 'array' OR jsonb_array_length(p_items) = 0 THEN
    RAISE EXCEPTION 'Adicione ao menos um item a retirada.';
  END IF;

  SELECT *
    INTO target_withdrawal
    FROM public.withdrawals
   WHERE id = p_withdrawal_id
   FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Retirada nao encontrada.';
  END IF;

  IF target_withdrawal.status = 'rejected' THEN
    RAISE EXCEPTION 'Retiradas rejeitadas nao podem ser editadas.';
  END IF;

  UPDATE public.withdrawals
     SET requested_by = p_requested_by,
         destination_type = p_destination_type,
         collaborator_id = CASE WHEN p_destination_type = 'collaborator' THEN p_collaborator_id ELSE NULL END,
         work_site_id = CASE WHEN p_destination_type = 'work_site' THEN p_work_site_id ELSE NULL END,
         notes = NULLIF(btrim(coalesce(p_notes, '')), ''),
         updated_at = now()
   WHERE id = target_withdrawal.id;

  FOR item_record IN SELECT * FROM jsonb_array_elements(p_items)
  LOOP
    item_withdrawal_item_id := CASE
      WHEN coalesce(item_record->>'withdrawal_item_id', item_record->>'id', '') = '' THEN NULL
      ELSE coalesce(item_record->>'withdrawal_item_id', item_record->>'id')::UUID
    END;
    item_stock_id := (item_record->>'stock_item_id')::UUID;
    item_lot_id := CASE
      WHEN coalesce(item_record->>'lot_id', '') = '' THEN NULL
      ELSE (item_record->>'lot_id')::UUID
    END;
    item_unit := item_record->>'unit';
    item_quantity := (item_record->>'quantity')::INTEGER;
    item_destination_type := COALESCE(NULLIF(item_record->>'destination_type', '')::public.withdrawal_destination_type, p_destination_type);
    item_collaborator_id := CASE
      WHEN item_destination_type = 'collaborator' THEN COALESCE(NULLIF(item_record->>'collaborator_id', '')::UUID, p_collaborator_id)
      ELSE NULL
    END;
    item_work_site_id := CASE
      WHEN item_destination_type = 'work_site' THEN COALESCE(NULLIF(item_record->>'work_site_id', '')::UUID, p_work_site_id)
      ELSE NULL
    END;

    IF item_stock_id IS NULL OR item_quantity IS NULL OR item_quantity <= 0 THEN
      RAISE EXCEPTION 'Item de retirada invalido.';
    END IF;

    IF item_destination_type = 'collaborator' AND item_collaborator_id IS NULL THEN
      RAISE EXCEPTION 'Selecione o colaborador do item.';
    END IF;

    IF item_destination_type = 'work_site' AND item_work_site_id IS NULL THEN
      RAISE EXCEPTION 'Selecione a obra do item.';
    END IF;

    existing_item := NULL;

    IF item_withdrawal_item_id IS NOT NULL THEN
      SELECT *
        INTO existing_item
        FROM public.withdrawal_items
       WHERE id = item_withdrawal_item_id
         AND withdrawal_id = target_withdrawal.id
       FOR UPDATE;

      IF NOT FOUND THEN
        existing_item := NULL;
      END IF;
    ELSE
      existing_item := NULL;
    END IF;

    IF existing_item.id IS NULL THEN
      INSERT INTO public.withdrawal_items (
        withdrawal_id,
        stock_item_id,
        lot_id,
        quantity,
        unit,
        destination_type,
        collaborator_id,
        work_site_id
      )
      VALUES (
        target_withdrawal.id,
        item_stock_id,
        item_lot_id,
        item_quantity,
        item_unit,
        item_destination_type,
        item_collaborator_id,
        item_work_site_id
      )
      RETURNING id INTO item_withdrawal_item_id;

      processed_ids := array_append(processed_ids, item_withdrawal_item_id);
      CONTINUE;
    END IF;

    old_destination_type := COALESCE(existing_item.destination_type, target_withdrawal.destination_type);
    old_collaborator_id := CASE
      WHEN old_destination_type = 'collaborator' THEN COALESCE(existing_item.collaborator_id, target_withdrawal.collaborator_id)
      ELSE NULL
    END;

    IF existing_item.stock_item_id <> item_stock_id THEN
      PERFORM public.restore_stock_item_quantity(existing_item.stock_item_id, existing_item.quantity, 'used');
      PERFORM public.consume_stock_item_quantity(item_stock_id, item_quantity);
    ELSE
      quantity_delta := item_quantity - existing_item.quantity;
      IF quantity_delta > 0 THEN
        PERFORM public.consume_stock_item_quantity(item_stock_id, quantity_delta);
      ELSIF quantity_delta < 0 THEN
        PERFORM public.restore_stock_item_quantity(item_stock_id, abs(quantity_delta), 'used');
      END IF;
    END IF;

    IF existing_item.lot_id IS DISTINCT FROM item_lot_id THEN
      IF existing_item.lot_id IS NOT NULL THEN
        UPDATE public.stock_item_lots
           SET quantity = quantity + existing_item.quantity,
               updated_at = now()
         WHERE id = existing_item.lot_id;
      END IF;

      IF item_lot_id IS NOT NULL THEN
        UPDATE public.stock_item_lots
           SET quantity = quantity - item_quantity,
               updated_at = now()
         WHERE id = item_lot_id
           AND quantity >= item_quantity;

        IF NOT FOUND THEN
          RAISE EXCEPTION 'Lote sem quantidade suficiente para a retirada.';
        END IF;
      END IF;
    ELSIF item_lot_id IS NOT NULL AND item_quantity <> existing_item.quantity THEN
      quantity_delta := item_quantity - existing_item.quantity;
      UPDATE public.stock_item_lots
         SET quantity = quantity - quantity_delta,
             updated_at = now()
       WHERE id = item_lot_id
         AND quantity - quantity_delta >= 0;

      IF NOT FOUND THEN
        RAISE EXCEPTION 'Lote sem quantidade suficiente para a retirada.';
      END IF;
    END IF;

    IF old_destination_type = 'collaborator' AND old_collaborator_id IS NOT NULL THEN
      UPDATE public.person_inventories
         SET quantity = GREATEST(quantity - existing_item.quantity, 0),
             updated_at = now()
       WHERE person_id = old_collaborator_id
         AND stock_item_id = existing_item.stock_item_id
         AND last_withdrawal_id = target_withdrawal.id;

      DELETE FROM public.person_inventories
       WHERE quantity = 0
         AND person_id = old_collaborator_id
         AND stock_item_id = existing_item.stock_item_id
         AND last_withdrawal_id = target_withdrawal.id;
    END IF;

    IF item_destination_type = 'collaborator' AND item_collaborator_id IS NOT NULL THEN
      INSERT INTO public.person_inventories (person_id, stock_item_id, quantity, last_withdrawal_id)
      VALUES (item_collaborator_id, item_stock_id, item_quantity, target_withdrawal.id)
      ON CONFLICT (person_id, stock_item_id) DO NOTHING;
    END IF;

    UPDATE public.withdrawal_items
       SET stock_item_id = item_stock_id,
           lot_id = item_lot_id,
           quantity = item_quantity,
           unit = item_unit,
           destination_type = item_destination_type,
           collaborator_id = item_collaborator_id,
           work_site_id = item_work_site_id
     WHERE id = existing_item.id;

    processed_ids := array_append(processed_ids, existing_item.id);
  END LOOP;

  FOR remaining_item IN
    SELECT *
      FROM public.withdrawal_items
     WHERE withdrawal_id = target_withdrawal.id
       AND NOT (id = ANY(processed_ids))
     FOR UPDATE
  LOOP
    old_destination_type := COALESCE(remaining_item.destination_type, target_withdrawal.destination_type);
    old_collaborator_id := CASE
      WHEN old_destination_type = 'collaborator' THEN COALESCE(remaining_item.collaborator_id, target_withdrawal.collaborator_id)
      ELSE NULL
    END;

    PERFORM public.restore_stock_item_quantity(remaining_item.stock_item_id, remaining_item.quantity, 'used');

    IF remaining_item.lot_id IS NOT NULL THEN
      UPDATE public.stock_item_lots
         SET quantity = quantity + remaining_item.quantity,
             updated_at = now()
       WHERE id = remaining_item.lot_id;
    END IF;

    IF old_destination_type = 'collaborator' AND old_collaborator_id IS NOT NULL THEN
      UPDATE public.person_inventories
         SET quantity = GREATEST(quantity - remaining_item.quantity, 0),
             updated_at = now()
       WHERE person_id = old_collaborator_id
         AND stock_item_id = remaining_item.stock_item_id
         AND last_withdrawal_id = target_withdrawal.id;

      DELETE FROM public.person_inventories
       WHERE quantity = 0
         AND person_id = old_collaborator_id
         AND stock_item_id = remaining_item.stock_item_id
         AND last_withdrawal_id = target_withdrawal.id;
    END IF;

    DELETE FROM public.withdrawal_items
     WHERE id = remaining_item.id;
  END LOOP;

  RETURN target_withdrawal.id;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.adjust_inventory_item_quantity(UUID, UUID, INTEGER, TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.adjust_inventory_item_quantity(UUID, UUID, INTEGER, TEXT) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.update_completed_withdrawal(UUID, UUID, public.withdrawal_destination_type, UUID, UUID, TEXT, JSONB) TO authenticated, service_role;

COMMIT;
