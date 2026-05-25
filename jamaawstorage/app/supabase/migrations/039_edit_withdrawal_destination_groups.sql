BEGIN;

DROP FUNCTION IF EXISTS public.update_completed_withdrawal(
  UUID,
  UUID,
  public.withdrawal_destination_type,
  UUID,
  UUID,
  TEXT,
  JSONB
);

CREATE OR REPLACE FUNCTION public.update_completed_withdrawal(
  p_withdrawal_id UUID,
  p_requested_by UUID,
  p_destination_type public.withdrawal_destination_type,
  p_collaborator_id UUID DEFAULT NULL,
  p_work_site_id UUID DEFAULT NULL,
  p_notes TEXT DEFAULT NULL,
  p_items JSONB DEFAULT '[]'::jsonb,
  p_groups JSONB DEFAULT NULL
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  target_withdrawal public.withdrawals%ROWTYPE;
  existing_item RECORD;
  group_record JSONB;
  item_record JSONB;
  effective_groups JSONB;
  group_index INTEGER := 0;
  group_withdrawal_id UUID;
  group_destination_type public.withdrawal_destination_type;
  group_collaborator_id UUID;
  group_work_site_id UUID;
  group_items JSONB;
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

  effective_groups := p_groups;

  IF effective_groups IS NULL THEN
    effective_groups := jsonb_build_array(jsonb_build_object(
      'destination_type', p_destination_type,
      'collaborator_id', p_collaborator_id,
      'work_site_id', p_work_site_id,
      'items', p_items
    ));
  END IF;

  IF jsonb_typeof(effective_groups) IS DISTINCT FROM 'array' OR jsonb_array_length(effective_groups) = 0 THEN
    RAISE EXCEPTION 'Adicione ao menos um destino a retirada.';
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
    SELECT stock_item_id, lot_id, quantity
      FROM public.withdrawal_items
     WHERE withdrawal_id = target_withdrawal.id
  LOOP
    PERFORM public.restore_stock_item_quantity(existing_item.stock_item_id, existing_item.quantity, 'used');

    IF existing_item.lot_id IS NOT NULL THEN
      UPDATE public.stock_item_lots
         SET quantity = quantity + existing_item.quantity,
             updated_at = now()
       WHERE id = existing_item.lot_id;
    END IF;
  END LOOP;

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

  FOR group_record IN SELECT * FROM jsonb_array_elements(effective_groups)
  LOOP
    group_index := group_index + 1;
    group_destination_type := (group_record->>'destination_type')::public.withdrawal_destination_type;
    group_collaborator_id := CASE
      WHEN coalesce(group_record->>'collaborator_id', '') = '' THEN NULL
      ELSE (group_record->>'collaborator_id')::UUID
    END;
    group_work_site_id := CASE
      WHEN coalesce(group_record->>'work_site_id', '') = '' THEN NULL
      ELSE (group_record->>'work_site_id')::UUID
    END;
    group_items := group_record->'items';

    IF group_destination_type = 'collaborator' AND group_collaborator_id IS NULL THEN
      RAISE EXCEPTION 'Selecione o colaborador da retirada.';
    END IF;

    IF group_destination_type = 'work_site' AND group_work_site_id IS NULL THEN
      RAISE EXCEPTION 'Selecione a obra da retirada.';
    END IF;

    IF jsonb_typeof(group_items) IS DISTINCT FROM 'array' OR jsonb_array_length(group_items) = 0 THEN
      RAISE EXCEPTION 'Adicione ao menos um item a cada destino.';
    END IF;

    IF group_index = 1 THEN
      group_withdrawal_id := target_withdrawal.id;

      UPDATE public.withdrawals
         SET requested_by = p_requested_by,
             destination_type = group_destination_type,
             collaborator_id = CASE WHEN group_destination_type = 'collaborator' THEN group_collaborator_id ELSE NULL END,
             work_site_id = CASE WHEN group_destination_type = 'work_site' THEN group_work_site_id ELSE NULL END,
             notes = NULLIF(btrim(coalesce(p_notes, '')), ''),
             updated_at = now()
       WHERE id = group_withdrawal_id;
    ELSE
      INSERT INTO public.withdrawals (
        requested_by,
        destination_type,
        collaborator_id,
        work_site_id,
        authorized_by,
        status,
        notes,
        photo_url,
        photo_urls,
        supervisor_signature,
        supervisor_signature_attachment_url,
        supervisor_signature_attachment_name,
        requester_signature,
        requester_signature_attachment_url,
        requester_signature_attachment_name,
        witness_signature,
        withdrawn_at
      )
      VALUES (
        p_requested_by,
        group_destination_type,
        CASE WHEN group_destination_type = 'collaborator' THEN group_collaborator_id ELSE NULL END,
        CASE WHEN group_destination_type = 'work_site' THEN group_work_site_id ELSE NULL END,
        target_withdrawal.authorized_by,
        target_withdrawal.status,
        NULLIF(btrim(coalesce(p_notes, '')), ''),
        target_withdrawal.photo_url,
        target_withdrawal.photo_urls,
        target_withdrawal.supervisor_signature,
        target_withdrawal.supervisor_signature_attachment_url,
        target_withdrawal.supervisor_signature_attachment_name,
        target_withdrawal.requester_signature,
        target_withdrawal.requester_signature_attachment_url,
        target_withdrawal.requester_signature_attachment_name,
        target_withdrawal.witness_signature,
        target_withdrawal.withdrawn_at
      )
      RETURNING id INTO group_withdrawal_id;
    END IF;

    FOR item_record IN SELECT * FROM jsonb_array_elements(group_items)
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
        group_withdrawal_id,
        item_stock_id,
        item_lot_id,
        item_quantity,
        item_unit
      );
    END LOOP;
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
  JSONB,
  JSONB
) TO authenticated;

COMMIT;
