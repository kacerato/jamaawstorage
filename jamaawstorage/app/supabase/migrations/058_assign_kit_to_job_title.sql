BEGIN;

-- ---------------------------------------------------------------------------
-- Entrega de kit por funcao, completando o que falta.
--
-- O problema que isso resolve: entregar um kit para quem ja tem parte dele
-- acumula. Se o kit pede 2 alicates e o colaborador ja tem 1, a entrega precisa
-- ser de 1, nao de 2. A lacuna e calculada por item, no banco, comparando o kit
-- com person_inventories.
--
-- Quem ja tem tudo nao recebe nada e nao gera retirada.
-- ---------------------------------------------------------------------------

-- Previa da entrega: mostra o que cada pessoa receberia, sem movimentar nada.
-- A tela usa isso para o supervisor conferir antes de confirmar.
CREATE OR REPLACE FUNCTION public.preview_kit_assignment_by_job_title(
  p_kit_id UUID,
  p_job_title TEXT
)
RETURNS TABLE (
  person_id UUID,
  person_name TEXT,
  employee_id TEXT,
  stock_item_id UUID,
  stock_item_name TEXT,
  stock_item_code TEXT,
  unit TEXT,
  kit_quantity INTEGER,
  owned_quantity INTEGER,
  missing_quantity INTEGER,
  available_in_stock INTEGER
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    person.id,
    person.full_name,
    person.employee_id,
    stock_item.id,
    stock_item.name,
    stock_item.code,
    stock_item.unit,
    kit_item.quantity,
    COALESCE(inventory.quantity, 0),
    GREATEST(kit_item.quantity - COALESCE(inventory.quantity, 0), 0),
    stock_item.current_quantity
  FROM public.people person
  CROSS JOIN public.kit_items kit_item
  JOIN public.stock_items stock_item ON stock_item.id = kit_item.stock_item_id
  LEFT JOIN public.person_inventories inventory
    ON inventory.person_id = person.id
   AND inventory.stock_item_id = kit_item.stock_item_id
  WHERE kit_item.kit_id = p_kit_id
    AND person.job_title = p_job_title
    AND person.is_active = true
    AND person.role = 'collaborator'
    AND public.is_active_supervisor()
  ORDER BY person.full_name, stock_item.name;
$$;

REVOKE EXECUTE ON FUNCTION public.preview_kit_assignment_by_job_title(UUID, TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.preview_kit_assignment_by_job_title(UUID, TEXT) TO authenticated, service_role;

-- ---------------------------------------------------------------------------
-- Aplica o kit a todos os colaboradores ativos de uma funcao.
--
-- Reaproveita assign_inventory_items_to_person: ela ja cria a retirada
-- 'completed' que os triggers existentes usam para baixar o estoque e creditar
-- o inventario. Duplicar essa logica aqui abriria espaco para divergencia.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.assign_kit_to_job_title(
  p_kit_id UUID,
  p_job_title TEXT
)
RETURNS TABLE (
  person_id UUID,
  person_name TEXT,
  assigned_quantity INTEGER,
  skipped_reason TEXT
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  target_person RECORD;
  missing_items JSONB;
  shortage_name TEXT;
  moved_quantity INTEGER;
BEGIN
  IF NOT public.is_active_supervisor() THEN
    RAISE EXCEPTION 'Acesso negado: somente supervisores ativos podem entregar kits.';
  END IF;

  IF p_kit_id IS NULL THEN
    RAISE EXCEPTION 'Informe o kit que sera entregue.';
  END IF;

  IF NOT EXISTS (SELECT 1 FROM public.kits WHERE id = p_kit_id AND is_active = true) THEN
    RAISE EXCEPTION 'Kit nao encontrado ou inativo.';
  END IF;

  IF NOT EXISTS (SELECT 1 FROM public.kit_items WHERE kit_id = p_kit_id) THEN
    RAISE EXCEPTION 'Este kit nao possui itens.';
  END IF;

  FOR target_person IN
    SELECT id, full_name
    FROM public.people
    WHERE job_title = p_job_title
      AND is_active = true
      AND role = 'collaborator'
    ORDER BY full_name
  LOOP
    -- Lacuna deste colaborador: so o que falta para chegar na quantidade do kit.
    SELECT jsonb_agg(
      jsonb_build_object(
        'stock_item_id', kit_item.stock_item_id,
        'quantity', kit_item.quantity - COALESCE(inventory.quantity, 0)
      )
    )
    INTO missing_items
    FROM public.kit_items kit_item
    LEFT JOIN public.person_inventories inventory
      ON inventory.person_id = target_person.id
     AND inventory.stock_item_id = kit_item.stock_item_id
    WHERE kit_item.kit_id = p_kit_id
      AND kit_item.quantity - COALESCE(inventory.quantity, 0) > 0;

    IF missing_items IS NULL THEN
      person_id := target_person.id;
      person_name := target_person.full_name;
      assigned_quantity := 0;
      skipped_reason := 'Ja possui o kit completo.';
      RETURN NEXT;
      CONTINUE;
    END IF;

    -- Estoque insuficiente nao aborta o lote inteiro: os demais colaboradores
    -- ainda recebem, e este aparece no retorno com o motivo.
    SELECT stock_item.name
      INTO shortage_name
    FROM jsonb_array_elements(missing_items) entry
    JOIN public.stock_items stock_item
      ON stock_item.id = (entry->>'stock_item_id')::UUID
    WHERE stock_item.current_quantity < (entry->>'quantity')::INTEGER
    LIMIT 1;

    IF shortage_name IS NOT NULL THEN
      person_id := target_person.id;
      person_name := target_person.full_name;
      assigned_quantity := 0;
      skipped_reason := format('Estoque insuficiente para: %s.', shortage_name);
      RETURN NEXT;
      CONTINUE;
    END IF;

    moved_quantity := public.assign_inventory_items_to_person(target_person.id, missing_items);

    person_id := target_person.id;
    person_name := target_person.full_name;
    assigned_quantity := moved_quantity;
    skipped_reason := NULL;
    RETURN NEXT;
  END LOOP;

  RETURN;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.assign_kit_to_job_title(UUID, TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.assign_kit_to_job_title(UUID, TEXT) TO authenticated, service_role;

COMMENT ON FUNCTION public.assign_kit_to_job_title(UUID, TEXT) IS
  'Entrega um kit a todos os colaboradores ativos de uma funcao, completando apenas a diferenca entre o kit e o que cada um ja possui.';

COMMIT;
