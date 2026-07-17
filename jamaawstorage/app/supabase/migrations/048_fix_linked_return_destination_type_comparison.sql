BEGIN;

-- stock_return_requests.source_type e TEXT; withdrawal_items.destination_type
-- usa o enum withdrawal_destination_type. Compare os dois como texto.
CREATE OR REPLACE FUNCTION public.guard_stock_return_request_integrity()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  origin_item RECORD;
  already_returned_quantity INTEGER;
  inventory_quantity INTEGER;
BEGIN
  IF TG_OP = 'UPDATE' THEN
    IF NEW.stock_item_id IS DISTINCT FROM OLD.stock_item_id
       OR NEW.quantity IS DISTINCT FROM OLD.quantity
       OR NEW.source_type IS DISTINCT FROM OLD.source_type
       OR NEW.source_person_id IS DISTINCT FROM OLD.source_person_id
       OR NEW.source_work_site_id IS DISTINCT FROM OLD.source_work_site_id
       OR NEW.origin_withdrawal_item_id IS DISTINCT FROM OLD.origin_withdrawal_item_id THEN
      RAISE EXCEPTION 'Depois de registrada, a devolucao nao pode ter item, quantidade, origem ou retirada de origem alterados.';
    END IF;

    RETURN NEW;
  END IF;

  IF NEW.origin_withdrawal_item_id IS NOT NULL THEN
    SELECT
      wi.id,
      wi.stock_item_id,
      wi.quantity,
      COALESCE(wi.destination_type, w.destination_type) AS destination_type,
      CASE
        WHEN COALESCE(wi.destination_type, w.destination_type) = 'collaborator'
          THEN COALESCE(wi.collaborator_id, w.collaborator_id)
        ELSE NULL
      END AS collaborator_id,
      CASE
        WHEN COALESCE(wi.destination_type, w.destination_type) = 'work_site'
          THEN COALESCE(wi.work_site_id, w.work_site_id)
        ELSE NULL
      END AS work_site_id,
      w.status
    INTO origin_item
    FROM public.withdrawal_items wi
    JOIN public.withdrawals w ON w.id = wi.withdrawal_id
    WHERE wi.id = NEW.origin_withdrawal_item_id
    FOR UPDATE OF wi;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'A retirada de origem nao foi encontrada.';
    END IF;

    IF origin_item.status = 'rejected' THEN
      RAISE EXCEPTION 'Nao e possivel devolver um item de uma retirada rejeitada.';
    END IF;

    IF NEW.stock_item_id <> origin_item.stock_item_id THEN
      RAISE EXCEPTION 'O item devolvido precisa ser o mesmo item da retirada de origem.';
    END IF;

    IF NEW.source_type <> origin_item.destination_type::TEXT
       OR (NEW.source_type = 'collaborator' AND NEW.source_person_id IS DISTINCT FROM origin_item.collaborator_id)
       OR (NEW.source_type = 'work_site' AND NEW.source_work_site_id IS DISTINCT FROM origin_item.work_site_id) THEN
      RAISE EXCEPTION 'A origem da devolucao precisa ser o mesmo destino da retirada vinculada.';
    END IF;

    SELECT COALESCE(SUM(quantity), 0)
      INTO already_returned_quantity
    FROM public.stock_return_requests
    WHERE origin_withdrawal_item_id = NEW.origin_withdrawal_item_id;

    IF already_returned_quantity + NEW.quantity > origin_item.quantity THEN
      RAISE EXCEPTION 'A devolucao ultrapassa a quantidade retirada. Ainda pode devolver % unidade(s).',
        origin_item.quantity - already_returned_quantity;
    END IF;
  END IF;

  IF NEW.source_type = 'collaborator' THEN
    SELECT quantity
      INTO inventory_quantity
    FROM public.person_inventories
    WHERE person_id = NEW.source_person_id
      AND stock_item_id = NEW.stock_item_id
    FOR UPDATE;

    IF inventory_quantity IS NULL OR inventory_quantity < NEW.quantity THEN
      RAISE EXCEPTION 'O colaborador nao possui quantidade suficiente desse item para registrar a devolucao. Disponivel no inventario: %.',
        COALESCE(inventory_quantity, 0);
    END IF;

    UPDATE public.person_inventories
    SET quantity = quantity - NEW.quantity,
        updated_at = now()
    WHERE person_id = NEW.source_person_id
      AND stock_item_id = NEW.stock_item_id;

    DELETE FROM public.person_inventories
    WHERE person_id = NEW.source_person_id
      AND stock_item_id = NEW.stock_item_id
      AND quantity <= 0;
  END IF;

  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.guard_stock_return_request_integrity() FROM PUBLIC, anon, authenticated;

COMMIT;
