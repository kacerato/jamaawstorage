BEGIN;

-- ---------------------------------------------------------------------------
-- Registro de kit por funcao no inventario individual, completando o que falta.
--
-- O problema que isso resolve: registrar um kit para quem ja tem parte dele
-- acumula. Se o kit pede 2 alicates e o colaborador ja tem 1, registra-se 1,
-- nao 2. A lacuna e calculada por item, no banco, comparando o kit com
-- person_inventories.
--
-- Quem ja tem tudo nao recebe nada.
-- ---------------------------------------------------------------------------

-- Previa: mostra o que seria registrado para cada pessoa, sem gravar nada.
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
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- A permissao e verificada aqui, nao no WHERE: como filtro ela apenas zeraria
  -- o resultado, e a tela mostraria "nenhum colaborador" em vez do acesso negado.
  IF NOT public.is_active_supervisor() THEN
    RAISE EXCEPTION 'Acesso negado: somente supervisores ativos podem consultar entregas de kit.';
  END IF;

  RETURN QUERY
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
  ORDER BY person.full_name, stock_item.name;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.preview_kit_assignment_by_job_title(UUID, TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.preview_kit_assignment_by_job_title(UUID, TEXT) TO authenticated, service_role;

-- ---------------------------------------------------------------------------
-- Registra o kit no inventario individual de cada colaborador da funcao.
--
-- NAO movimenta estoque: o material ja esta em posse dos colaboradores ha tempos
-- e nunca foi registrado. Isto e acerto de cadastro, nao saida de almoxarifado.
--
-- O corpo evita lacos e aliases porque os parametros OUT (person_id, ...)
-- colidem com colunas das tabelas envolvidas; uma instrucao unica com CTEs
-- calcula a lacuna e grava sem ambiguidade.
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
#variable_conflict use_column
DECLARE
  affected JSONB;
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

  WITH gaps AS (
    SELECT
      p.id AS pid,
      ki.stock_item_id AS sid,
      (ki.quantity - COALESCE(pi.quantity, 0))::INTEGER AS missing
    FROM public.people p
    CROSS JOIN public.kit_items ki
    LEFT JOIN public.person_inventories pi
      ON pi.person_id = p.id
     AND pi.stock_item_id = ki.stock_item_id
    WHERE ki.kit_id = p_kit_id
      AND p.job_title = p_job_title
      AND p.is_active = true
      AND p.role = 'collaborator'
      AND ki.quantity - COALESCE(pi.quantity, 0) > 0
  ),
  written AS (
    INSERT INTO public.person_inventories (person_id, stock_item_id, quantity)
    SELECT g.pid, g.sid, g.missing FROM gaps g
    ON CONFLICT (person_id, stock_item_id) DO UPDATE
    SET quantity = public.person_inventories.quantity + EXCLUDED.quantity,
        updated_at = now()
    RETURNING 1
  )
  SELECT jsonb_object_agg(pid::TEXT, total)
    INTO affected
  FROM (
    SELECT pid, sum(missing)::INTEGER AS total
    FROM gaps
    GROUP BY pid
  ) s
  WHERE (SELECT count(*) FROM written) >= 0;

  affected := COALESCE(affected, '{}'::jsonb);

  RETURN QUERY
  SELECT
    p.id,
    p.full_name,
    COALESCE((affected->>p.id::TEXT)::INTEGER, 0),
    CASE WHEN affected->>p.id::TEXT IS NULL THEN 'Ja possui o kit completo.' END
  FROM public.people p
  WHERE p.job_title = p_job_title
    AND p.is_active = true
    AND p.role = 'collaborator'
  ORDER BY p.full_name;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.assign_kit_to_job_title(UUID, TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.assign_kit_to_job_title(UUID, TEXT) TO authenticated, service_role;

COMMENT ON FUNCTION public.assign_kit_to_job_title(UUID, TEXT) IS
  'Registra no inventario individual os itens do kit que faltam a cada colaborador da funcao. Acerto de cadastro: nao movimenta estoque.';

COMMIT;
