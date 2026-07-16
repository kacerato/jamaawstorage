BEGIN;

-- A devolucao aponta para a linha exata da retirada, nao apenas para o item.
-- Isso preserva quem recebeu o material, a quantidade original e o codigo da retirada.
ALTER TABLE public.stock_return_requests
  ADD COLUMN IF NOT EXISTS origin_withdrawal_item_id UUID
  REFERENCES public.withdrawal_items(id) ON DELETE RESTRICT;

CREATE INDEX IF NOT EXISTS idx_stock_return_requests_origin_withdrawal_item
  ON public.stock_return_requests(origin_withdrawal_item_id)
  WHERE origin_withdrawal_item_id IS NOT NULL;

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
    -- O bloqueio na linha de retirada serializa devolucoes concorrentes da mesma retirada.
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

  -- Quando o material chega ao almoxarifado para triagem, ele deixa o inventario
  -- do colaborador; so volta ao estoque geral quando for aprovado pelo fluxo atual.
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

CREATE OR REPLACE FUNCTION public.restore_stock_return_inventory_on_delete()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  origin_withdrawal_id UUID;
BEGIN
  IF OLD.status = 'approved' OR OLD.approved_quantity > 0 THEN
    RAISE EXCEPTION 'Nao e possivel excluir uma devolucao que ja teve quantidade devolvida ao estoque.';
  END IF;

  IF OLD.source_type = 'collaborator' THEN
    SELECT withdrawal_id
      INTO origin_withdrawal_id
    FROM public.withdrawal_items
    WHERE id = OLD.origin_withdrawal_item_id;

    INSERT INTO public.person_inventories (person_id, stock_item_id, quantity, last_withdrawal_id)
    VALUES (OLD.source_person_id, OLD.stock_item_id, OLD.quantity, origin_withdrawal_id)
    ON CONFLICT (person_id, stock_item_id) DO UPDATE
    SET quantity = public.person_inventories.quantity + EXCLUDED.quantity,
        last_withdrawal_id = COALESCE(EXCLUDED.last_withdrawal_id, public.person_inventories.last_withdrawal_id),
        updated_at = now();
  END IF;

  RETURN OLD;
END;
$$;

DROP TRIGGER IF EXISTS trg_stock_return_requests_guard_integrity ON public.stock_return_requests;
CREATE TRIGGER trg_stock_return_requests_guard_integrity
  BEFORE INSERT OR UPDATE ON public.stock_return_requests
  FOR EACH ROW EXECUTE FUNCTION public.guard_stock_return_request_integrity();

DROP TRIGGER IF EXISTS trg_stock_return_requests_restore_inventory_on_delete ON public.stock_return_requests;
CREATE TRIGGER trg_stock_return_requests_restore_inventory_on_delete
  BEFORE DELETE ON public.stock_return_requests
  FOR EACH ROW EXECUTE FUNCTION public.restore_stock_return_inventory_on_delete();

CREATE OR REPLACE FUNCTION public.prevent_linked_withdrawal_item_mutation()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM public.stock_return_requests
    WHERE origin_withdrawal_item_id = OLD.id
  ) THEN
    RAISE EXCEPTION 'Esta retirada possui devolucao vinculada e nao pode ser alterada ou removida. Registre a correcao pela devolucao para preservar o historico.';
  END IF;

  IF TG_OP = 'DELETE' THEN
    RETURN OLD;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_withdrawal_items_prevent_linked_return_mutation ON public.withdrawal_items;
CREATE TRIGGER trg_withdrawal_items_prevent_linked_return_mutation
  BEFORE DELETE OR UPDATE OF withdrawal_id, stock_item_id, quantity, destination_type, collaborator_id, work_site_id
  ON public.withdrawal_items
  FOR EACH ROW EXECUTE FUNCTION public.prevent_linked_withdrawal_item_mutation();

CREATE OR REPLACE FUNCTION public.prevent_rejecting_withdrawal_with_linked_returns()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF NEW.status = 'rejected'
     AND OLD.status IS DISTINCT FROM 'rejected'
     AND EXISTS (
       SELECT 1
       FROM public.withdrawal_items wi
       JOIN public.stock_return_requests sr ON sr.origin_withdrawal_item_id = wi.id
       WHERE wi.withdrawal_id = OLD.id
     ) THEN
    RAISE EXCEPTION 'Nao e possivel rejeitar uma retirada que ja possui devolucao vinculada. Corrija a devolucao primeiro para preservar as quantidades.';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_withdrawals_prevent_reject_with_linked_returns ON public.withdrawals;
CREATE TRIGGER trg_withdrawals_prevent_reject_with_linked_returns
  BEFORE UPDATE OF status ON public.withdrawals
  FOR EACH ROW EXECUTE FUNCTION public.prevent_rejecting_withdrawal_with_linked_returns();

REVOKE ALL ON FUNCTION public.guard_stock_return_request_integrity() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.restore_stock_return_inventory_on_delete() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.prevent_linked_withdrawal_item_mutation() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.prevent_rejecting_withdrawal_with_linked_returns() FROM PUBLIC, anon, authenticated;

COMMIT;
