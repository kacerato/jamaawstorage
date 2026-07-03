BEGIN;

CREATE OR REPLACE FUNCTION public.reopen_rejected_withdrawal(
  p_withdrawal_id UUID
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  target_withdrawal public.withdrawals%ROWTYPE;
  item_to_reopen public.withdrawal_items%ROWTYPE;
  effective_dest_type public.withdrawal_destination_type;
  effective_collab_id UUID;
  item_count INTEGER;
BEGIN
  IF NOT public.is_active_supervisor() THEN
    RAISE EXCEPTION 'Acesso negado: somente supervisores ativos podem reabrir retiradas.';
  END IF;

  IF p_withdrawal_id IS NULL THEN
    RAISE EXCEPTION 'Retirada nao informada.';
  END IF;

  SELECT *
    INTO target_withdrawal
    FROM public.withdrawals
   WHERE id = p_withdrawal_id
   FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Retirada nao encontrada.';
  END IF;

  IF target_withdrawal.status <> 'rejected' THEN
    RAISE EXCEPTION 'Somente retiradas rejeitadas podem ser reabertas.';
  END IF;

  SELECT count(*)
    INTO item_count
    FROM public.withdrawal_items
   WHERE withdrawal_id = target_withdrawal.id;

  IF item_count = 0 THEN
    RAISE EXCEPTION 'Nao e possivel reabrir uma retirada sem itens.';
  END IF;

  FOR item_to_reopen IN
    SELECT *
      FROM public.withdrawal_items
     WHERE withdrawal_id = target_withdrawal.id
     FOR UPDATE
  LOOP
    effective_dest_type := COALESCE(item_to_reopen.destination_type, target_withdrawal.destination_type);
    effective_collab_id := CASE
      WHEN effective_dest_type = 'collaborator' THEN COALESCE(item_to_reopen.collaborator_id, target_withdrawal.collaborator_id)
      ELSE NULL
    END;

    IF item_to_reopen.stock_item_id IS NULL OR item_to_reopen.quantity IS NULL OR item_to_reopen.quantity <= 0 THEN
      RAISE EXCEPTION 'Item de retirada invalido.';
    END IF;

    IF effective_dest_type = 'collaborator' AND effective_collab_id IS NULL THEN
      RAISE EXCEPTION 'Selecione o colaborador do item antes de reabrir.';
    END IF;

    IF effective_dest_type = 'work_site' AND COALESCE(item_to_reopen.work_site_id, target_withdrawal.work_site_id) IS NULL THEN
      RAISE EXCEPTION 'Selecione a obra do item antes de reabrir.';
    END IF;

    PERFORM public.consume_stock_item_quantity(item_to_reopen.stock_item_id, item_to_reopen.quantity);

    IF item_to_reopen.lot_id IS NOT NULL THEN
      UPDATE public.stock_item_lots
         SET quantity = quantity - item_to_reopen.quantity,
             updated_at = now()
       WHERE id = item_to_reopen.lot_id
         AND quantity >= item_to_reopen.quantity;

      IF NOT FOUND THEN
        RAISE EXCEPTION 'Lote sem quantidade suficiente para reabrir a retirada.';
      END IF;
    END IF;

    IF effective_dest_type = 'collaborator' AND effective_collab_id IS NOT NULL THEN
      INSERT INTO public.person_inventories (person_id, stock_item_id, quantity, last_withdrawal_id)
      VALUES (effective_collab_id, item_to_reopen.stock_item_id, item_to_reopen.quantity, target_withdrawal.id)
      ON CONFLICT (person_id, stock_item_id) DO UPDATE
      SET quantity = person_inventories.quantity + EXCLUDED.quantity,
          last_withdrawal_id = EXCLUDED.last_withdrawal_id,
          updated_at = now();
    END IF;
  END LOOP;

  UPDATE public.withdrawals
     SET status = 'completed',
         updated_at = now()
   WHERE id = target_withdrawal.id;

  RETURN target_withdrawal.id;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.reopen_rejected_withdrawal(UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.reopen_rejected_withdrawal(UUID) TO authenticated, service_role;

COMMIT;
