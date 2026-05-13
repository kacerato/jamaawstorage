BEGIN;

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

  UPDATE public.stock_items si
     SET current_quantity = si.current_quantity + wi.quantity,
         updated_at = now()
    FROM public.withdrawal_items wi
   WHERE wi.withdrawal_id = target_withdrawal.id
     AND si.id = wi.stock_item_id;

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

GRANT EXECUTE ON FUNCTION public.update_completed_withdrawal(
  UUID,
  UUID,
  public.withdrawal_destination_type,
  UUID,
  UUID,
  TEXT,
  JSONB
) TO authenticated;

COMMIT;
