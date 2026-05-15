BEGIN;

CREATE OR REPLACE FUNCTION public.consume_stock_item_quantity(
  p_stock_item_id UUID,
  p_quantity INTEGER
)
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  target_item public.stock_items%ROWTYPE;
  remaining_quantity INTEGER;
  take_new INTEGER;
  take_used INTEGER;
  take_damaged INTEGER;
  next_quantity INTEGER;
BEGIN
  IF p_stock_item_id IS NULL THEN
    RAISE EXCEPTION 'Item de estoque nao informado.';
  END IF;

  IF p_quantity IS NULL OR p_quantity <= 0 THEN
    RAISE EXCEPTION 'Quantidade de saida precisa ser maior que zero.';
  END IF;

  SELECT *
    INTO target_item
  FROM public.stock_items
  WHERE id = p_stock_item_id
  FOR UPDATE;

  IF target_item.id IS NULL THEN
    RAISE EXCEPTION 'Item de estoque nao encontrado.';
  END IF;

  IF target_item.current_quantity < p_quantity THEN
    RAISE EXCEPTION 'Estoque insuficiente para %. Disponivel: %, solicitado: %.',
      target_item.name,
      target_item.current_quantity,
      p_quantity;
  END IF;

  remaining_quantity := p_quantity;
  take_new := LEAST(target_item.quantity_new, remaining_quantity);
  remaining_quantity := remaining_quantity - take_new;
  take_used := LEAST(target_item.quantity_used, remaining_quantity);
  remaining_quantity := remaining_quantity - take_used;
  take_damaged := LEAST(target_item.quantity_damaged, remaining_quantity);
  remaining_quantity := remaining_quantity - take_damaged;

  IF remaining_quantity > 0 THEN
    RAISE EXCEPTION 'A classificacao do estoque esta inconsistente para %. Reclassifique o item antes de retirar.',
      target_item.name;
  END IF;

  UPDATE public.stock_items
     SET quantity_new = quantity_new - take_new,
         quantity_used = quantity_used - take_used,
         quantity_damaged = quantity_damaged - take_damaged,
         current_quantity = current_quantity - p_quantity,
         updated_at = now()
   WHERE id = p_stock_item_id
   RETURNING current_quantity INTO next_quantity;

  RETURN next_quantity;
END;
$$;

CREATE OR REPLACE FUNCTION public.restore_stock_item_quantity(
  p_stock_item_id UUID,
  p_quantity INTEGER,
  p_condition TEXT DEFAULT 'used'
)
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  next_quantity INTEGER;
  restore_condition TEXT;
BEGIN
  IF p_stock_item_id IS NULL THEN
    RAISE EXCEPTION 'Item de estoque nao informado.';
  END IF;

  IF p_quantity IS NULL OR p_quantity <= 0 THEN
    RAISE EXCEPTION 'Quantidade de retorno precisa ser maior que zero.';
  END IF;

  restore_condition := COALESCE(NULLIF(trim(coalesce(p_condition, '')), ''), 'used');

  IF restore_condition NOT IN ('new', 'used', 'damaged') THEN
    RAISE EXCEPTION 'Estado de retorno invalido. Use new, used ou damaged.';
  END IF;

  UPDATE public.stock_items
     SET quantity_new = quantity_new + CASE WHEN restore_condition = 'new' THEN p_quantity ELSE 0 END,
         quantity_used = quantity_used + CASE WHEN restore_condition = 'used' THEN p_quantity ELSE 0 END,
         quantity_damaged = quantity_damaged + CASE WHEN restore_condition = 'damaged' THEN p_quantity ELSE 0 END,
         current_quantity = current_quantity + p_quantity,
         updated_at = now()
   WHERE id = p_stock_item_id
   RETURNING current_quantity INTO next_quantity;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Item de estoque nao encontrado.';
  END IF;

  RETURN next_quantity;
END;
$$;

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
  current_qty INTEGER;
BEGIN
  IF p_delta = 0 THEN
    SELECT current_quantity
      INTO current_qty
      FROM public.stock_items
     WHERE id = p_stock_item_id;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'Item de estoque nao encontrado.';
    END IF;

    RETURN current_qty;
  END IF;

  IF p_delta > 0 THEN
    RETURN public.restore_stock_item_quantity(p_stock_item_id, p_delta, 'used');
  END IF;

  RETURN public.consume_stock_item_quantity(p_stock_item_id, abs(p_delta));
END;
$$;

CREATE OR REPLACE FUNCTION public.handle_stock_deduction()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  w_dest_type public.withdrawal_destination_type;
  w_collab_id UUID;
  w_status public.withdrawal_status;
BEGIN
  SELECT destination_type, collaborator_id, status
    INTO w_dest_type, w_collab_id, w_status
  FROM public.withdrawals
  WHERE id = NEW.withdrawal_id;

  IF w_status = 'rejected' THEN
    RETURN NEW;
  END IF;

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

  IF w_dest_type = 'collaborator' AND w_collab_id IS NOT NULL THEN
    INSERT INTO public.person_inventories (person_id, stock_item_id, quantity, last_withdrawal_id)
    VALUES (w_collab_id, NEW.stock_item_id, NEW.quantity, NEW.withdrawal_id)
    ON CONFLICT (person_id, stock_item_id) DO UPDATE
    SET quantity = person_inventories.quantity + EXCLUDED.quantity,
        last_withdrawal_id = EXCLUDED.last_withdrawal_id,
        updated_at = now();
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
BEGIN
  IF OLD.status = NEW.status THEN
    RETURN NEW;
  END IF;

  IF NEW.status = 'rejected' AND OLD.status <> 'rejected' THEN
    FOR item_to_restore IN
      SELECT stock_item_id, quantity
      FROM public.withdrawal_items
      WHERE withdrawal_id = NEW.id
    LOOP
      PERFORM public.restore_stock_item_quantity(item_to_restore.stock_item_id, item_to_restore.quantity, 'used');
    END LOOP;

    UPDATE public.stock_item_lots sil
       SET quantity = sil.quantity + wi.quantity,
           updated_at = now()
      FROM public.withdrawal_items wi
     WHERE wi.withdrawal_id = NEW.id
       AND sil.id = wi.lot_id;

    UPDATE public.person_inventories pi
       SET quantity = GREATEST(pi.quantity - wi.quantity, 0),
           updated_at = now()
      FROM public.withdrawal_items wi
      JOIN public.withdrawals w ON w.id = wi.withdrawal_id
     WHERE wi.withdrawal_id = NEW.id
       AND pi.person_id = w.collaborator_id
       AND pi.stock_item_id = wi.stock_item_id;

    DELETE FROM public.person_inventories pi
     WHERE pi.quantity = 0
       AND EXISTS (
         SELECT 1
         FROM public.withdrawal_items wi
         JOIN public.withdrawals w ON w.id = wi.withdrawal_id
         WHERE wi.withdrawal_id = NEW.id
           AND pi.person_id = w.collaborator_id
           AND pi.stock_item_id = wi.stock_item_id
       );
  END IF;

  RETURN NEW;
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
  item_record JSONB;
  item_stock_id UUID;
  item_lot_id UUID;
  item_quantity INTEGER;
  item_unit TEXT;
  existing_item RECORD;
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

  IF p_destination_type = 'collaborator' AND p_collaborator_id IS NULL THEN
    RAISE EXCEPTION 'Selecione o colaborador da retirada.';
  END IF;

  IF p_destination_type = 'work_site' AND p_work_site_id IS NULL THEN
    RAISE EXCEPTION 'Selecione a obra da retirada.';
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

  FOR existing_item IN
    SELECT stock_item_id, quantity
    FROM public.withdrawal_items
    WHERE withdrawal_id = target_withdrawal.id
  LOOP
    PERFORM public.restore_stock_item_quantity(existing_item.stock_item_id, existing_item.quantity, 'used');
  END LOOP;

  UPDATE public.stock_item_lots sil
     SET quantity = sil.quantity + wi.quantity,
         updated_at = now()
    FROM public.withdrawal_items wi
   WHERE wi.withdrawal_id = target_withdrawal.id
     AND sil.id = wi.lot_id;

  IF target_withdrawal.destination_type = 'collaborator' AND target_withdrawal.collaborator_id IS NOT NULL THEN
    UPDATE public.person_inventories pi
       SET quantity = GREATEST(pi.quantity - wi.quantity, 0),
           updated_at = now()
      FROM public.withdrawal_items wi
     WHERE wi.withdrawal_id = target_withdrawal.id
       AND pi.person_id = target_withdrawal.collaborator_id
       AND pi.stock_item_id = wi.stock_item_id;

    DELETE FROM public.person_inventories pi
     WHERE pi.quantity = 0
       AND pi.person_id = target_withdrawal.collaborator_id
       AND EXISTS (
         SELECT 1
           FROM public.withdrawal_items wi
          WHERE wi.withdrawal_id = target_withdrawal.id
            AND wi.stock_item_id = pi.stock_item_id
       );
  END IF;

  DELETE FROM public.withdrawal_items
   WHERE withdrawal_id = target_withdrawal.id;

  UPDATE public.withdrawals
     SET requested_by = p_requested_by,
         destination_type = p_destination_type,
         collaborator_id = CASE
           WHEN p_destination_type = 'collaborator' THEN p_collaborator_id
           ELSE NULL
         END,
         work_site_id = CASE
           WHEN p_destination_type = 'work_site' THEN p_work_site_id
           ELSE NULL
         END,
         notes = NULLIF(btrim(coalesce(p_notes, '')), ''),
         updated_at = now()
   WHERE id = target_withdrawal.id;

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
      target_withdrawal.id,
      item_stock_id,
      item_lot_id,
      item_quantity,
      item_unit
    );
  END LOOP;

  RETURN target_withdrawal.id;
END;
$$;

CREATE OR REPLACE FUNCTION public.remove_inventory_item_from_person(
  p_person_id UUID,
  p_stock_item_id UUID,
  p_quantity INTEGER,
  p_destination TEXT DEFAULT 'return_to_stock'
)
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  current_inventory_qty INTEGER;
BEGIN
  IF NOT public.is_active_supervisor() THEN
    RAISE EXCEPTION 'Acesso negado: somente supervisores ativos podem movimentar inventario.';
  END IF;

  IF p_person_id IS NULL OR p_stock_item_id IS NULL THEN
    RAISE EXCEPTION 'Pessoa e item sao obrigatorios.';
  END IF;

  IF p_quantity IS NULL OR p_quantity <= 0 THEN
    RAISE EXCEPTION 'Quantidade precisa ser maior que zero.';
  END IF;

  SELECT quantity
    INTO current_inventory_qty
  FROM public.person_inventories
  WHERE person_id = p_person_id
    AND stock_item_id = p_stock_item_id
  FOR UPDATE;

  IF current_inventory_qty IS NULL THEN
    RAISE EXCEPTION 'Item nao encontrado no inventario deste colaborador.';
  END IF;

  IF current_inventory_qty < p_quantity THEN
    RAISE EXCEPTION 'Quantidade indisponivel no inventario. Atual: %.', current_inventory_qty;
  END IF;

  IF p_destination = 'return_to_stock' THEN
    PERFORM public.restore_stock_item_quantity(p_stock_item_id, p_quantity, 'used');
  ELSIF p_destination <> 'delete' THEN
    RAISE EXCEPTION 'Destino invalido para remocao do inventario.';
  END IF;

  UPDATE public.person_inventories
     SET quantity = quantity - p_quantity,
         updated_at = now()
   WHERE person_id = p_person_id
     AND stock_item_id = p_stock_item_id;

  DELETE FROM public.person_inventories
   WHERE person_id = p_person_id
     AND stock_item_id = p_stock_item_id
     AND quantity <= 0;

  RETURN p_quantity;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.consume_stock_item_quantity(UUID, INTEGER) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.restore_stock_item_quantity(UUID, INTEGER, TEXT) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.adjust_stock_item_quantity(UUID, INTEGER) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.update_completed_withdrawal(UUID, UUID, public.withdrawal_destination_type, UUID, UUID, TEXT, JSONB) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.remove_inventory_item_from_person(UUID, UUID, INTEGER, TEXT) FROM PUBLIC, anon;

GRANT EXECUTE ON FUNCTION public.consume_stock_item_quantity(UUID, INTEGER) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.restore_stock_item_quantity(UUID, INTEGER, TEXT) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.adjust_stock_item_quantity(UUID, INTEGER) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.update_completed_withdrawal(UUID, UUID, public.withdrawal_destination_type, UUID, UUID, TEXT, JSONB) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.remove_inventory_item_from_person(UUID, UUID, INTEGER, TEXT) TO authenticated, service_role;

COMMIT;
