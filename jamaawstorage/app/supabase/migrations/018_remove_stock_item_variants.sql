BEGIN;

DROP INDEX IF EXISTS public.idx_stock_items_variant_group;
DROP INDEX IF EXISTS public.idx_stock_items_variant_label;

ALTER TABLE public.stock_items
  DROP COLUMN IF EXISTS variant_group,
  DROP COLUMN IF EXISTS variant_label;

DROP FUNCTION IF EXISTS public.update_stock_item_details_and_quantity(
  UUID,
  TEXT,
  TEXT,
  TEXT,
  TEXT,
  TEXT,
  INTEGER,
  TEXT,
  INTEGER,
  TEXT,
  TEXT
);

CREATE OR REPLACE FUNCTION public.update_stock_item_details_and_quantity(
  p_stock_item_id UUID,
  p_name TEXT,
  p_description TEXT DEFAULT NULL,
  p_category TEXT DEFAULT NULL,
  p_unit TEXT DEFAULT 'un',
  p_ca_nr TEXT DEFAULT NULL,
  p_minimum_quantity INTEGER DEFAULT 0,
  p_svg_icon_key TEXT DEFAULT NULL,
  p_stock_adjustment INTEGER DEFAULT 0
)
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  next_quantity INTEGER;
BEGIN
  IF NOT public.is_active_supervisor() THEN
    RAISE EXCEPTION 'Acesso negado: somente supervisores ativos podem atualizar itens.';
  END IF;

  IF p_name IS NULL OR btrim(p_name) = '' THEN
    RAISE EXCEPTION 'O nome do item e obrigatorio.';
  END IF;

  IF p_minimum_quantity < 0 THEN
    RAISE EXCEPTION 'A quantidade minima nao pode ser negativa.';
  END IF;

  UPDATE public.stock_items
     SET name = btrim(p_name),
         description = NULLIF(btrim(coalesce(p_description, '')), ''),
         category = NULLIF(btrim(coalesce(p_category, '')), ''),
         unit = btrim(coalesce(p_unit, 'un')),
         ca_nr = NULLIF(btrim(coalesce(p_ca_nr, '')), ''),
         minimum_quantity = p_minimum_quantity,
         svg_icon_key = p_svg_icon_key,
         current_quantity = current_quantity + p_stock_adjustment,
         updated_at = now()
   WHERE id = p_stock_item_id
     AND current_quantity + p_stock_adjustment >= 0
  RETURNING current_quantity INTO next_quantity;

  IF FOUND THEN
    RETURN next_quantity;
  END IF;

  IF EXISTS (SELECT 1 FROM public.stock_items WHERE id = p_stock_item_id) THEN
    RAISE EXCEPTION 'Nao foi possivel aplicar o ajuste porque o estoque ficaria negativo.';
  END IF;

  RAISE EXCEPTION 'Item de estoque nao encontrado.';
END;
$$;

GRANT EXECUTE ON FUNCTION public.update_stock_item_details_and_quantity(
  UUID,
  TEXT,
  TEXT,
  TEXT,
  TEXT,
  TEXT,
  INTEGER,
  TEXT,
  INTEGER
) TO authenticated, service_role;

COMMIT;
