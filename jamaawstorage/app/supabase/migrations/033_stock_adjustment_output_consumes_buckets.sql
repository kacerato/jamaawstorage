BEGIN;

CREATE OR REPLACE FUNCTION public.update_stock_item_details_and_quantity(
  p_stock_item_id UUID,
  p_name TEXT,
  p_description TEXT DEFAULT NULL,
  p_category TEXT DEFAULT NULL,
  p_unit TEXT DEFAULT 'un',
  p_ca_nr TEXT DEFAULT NULL,
  p_minimum_quantity INTEGER DEFAULT 0,
  p_svg_icon_key TEXT DEFAULT NULL,
  p_stock_adjustment INTEGER DEFAULT 0,
  p_quantity_new INTEGER DEFAULT NULL,
  p_quantity_used INTEGER DEFAULT NULL,
  p_quantity_damaged INTEGER DEFAULT NULL,
  p_adjustment_bucket TEXT DEFAULT 'new'
)
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  target_item public.stock_items%ROWTYPE;
  next_quantity_new INTEGER;
  next_quantity_used INTEGER;
  next_quantity_damaged INTEGER;
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

  IF p_adjustment_bucket NOT IN ('new', 'used', 'damaged') THEN
    RAISE EXCEPTION 'Bucket invalido. Use new, used ou damaged.';
  END IF;

  SELECT *
    INTO target_item
  FROM public.stock_items
  WHERE id = p_stock_item_id
  FOR UPDATE;

  IF target_item.id IS NULL THEN
    RAISE EXCEPTION 'Item de estoque nao encontrado.';
  END IF;

  next_quantity_new := COALESCE(p_quantity_new, target_item.quantity_new);
  next_quantity_used := COALESCE(p_quantity_used, target_item.quantity_used);
  next_quantity_damaged := COALESCE(p_quantity_damaged, target_item.quantity_damaged);

  IF next_quantity_new < 0 OR next_quantity_used < 0 OR next_quantity_damaged < 0 THEN
    RAISE EXCEPTION 'A classificacao do estoque nao pode ficar negativa.';
  END IF;

  UPDATE public.stock_items
     SET name = btrim(p_name),
         description = NULLIF(btrim(coalesce(p_description, '')), ''),
         category = NULLIF(btrim(coalesce(p_category, '')), ''),
         unit = btrim(coalesce(p_unit, 'un')),
         ca_nr = NULLIF(btrim(coalesce(p_ca_nr, '')), ''),
         minimum_quantity = p_minimum_quantity,
         svg_icon_key = p_svg_icon_key,
         quantity_new = next_quantity_new,
         quantity_used = next_quantity_used,
         quantity_damaged = next_quantity_damaged,
         current_quantity = next_quantity_new + next_quantity_used + next_quantity_damaged,
         updated_at = now()
   WHERE id = p_stock_item_id;

  IF p_stock_adjustment > 0 THEN
    PERFORM public.restore_stock_item_quantity(p_stock_item_id, p_stock_adjustment, p_adjustment_bucket);
  ELSIF p_stock_adjustment < 0 THEN
    PERFORM public.consume_stock_item_quantity(p_stock_item_id, abs(p_stock_adjustment));
  END IF;

  SELECT current_quantity
    INTO next_quantity_new
  FROM public.stock_items
  WHERE id = p_stock_item_id;

  RETURN next_quantity_new;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.update_stock_item_details_and_quantity(
  UUID,
  TEXT,
  TEXT,
  TEXT,
  TEXT,
  TEXT,
  INTEGER,
  TEXT,
  INTEGER,
  INTEGER,
  INTEGER,
  INTEGER,
  TEXT
) FROM PUBLIC, anon;

GRANT EXECUTE ON FUNCTION public.update_stock_item_details_and_quantity(
  UUID,
  TEXT,
  TEXT,
  TEXT,
  TEXT,
  TEXT,
  INTEGER,
  TEXT,
  INTEGER,
  INTEGER,
  INTEGER,
  INTEGER,
  TEXT
) TO authenticated, service_role;

COMMIT;
