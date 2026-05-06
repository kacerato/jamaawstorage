BEGIN;

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'app-files',
  'app-files',
  true,
  12582912,
  ARRAY[
    'image/jpeg',
    'image/png',
    'image/webp',
    'application/pdf',
    'application/msword',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
  ]
)
ON CONFLICT (id) DO UPDATE
SET
  public = EXCLUDED.public,
  file_size_limit = EXCLUDED.file_size_limit,
  allowed_mime_types = EXCLUDED.allowed_mime_types;

DROP POLICY IF EXISTS "app_files_supervisor_read" ON storage.objects;
CREATE POLICY "app_files_supervisor_read" ON storage.objects
FOR SELECT
USING (
  bucket_id = 'app-files'
  AND (SELECT public.is_active_supervisor())
);

DROP POLICY IF EXISTS "app_files_supervisor_insert" ON storage.objects;
CREATE POLICY "app_files_supervisor_insert" ON storage.objects
FOR INSERT
WITH CHECK (
  bucket_id = 'app-files'
  AND (SELECT public.is_active_supervisor())
);

DROP POLICY IF EXISTS "app_files_supervisor_update" ON storage.objects;
CREATE POLICY "app_files_supervisor_update" ON storage.objects
FOR UPDATE
USING (
  bucket_id = 'app-files'
  AND (SELECT public.is_active_supervisor())
)
WITH CHECK (
  bucket_id = 'app-files'
  AND (SELECT public.is_active_supervisor())
);

DROP POLICY IF EXISTS "app_files_supervisor_delete" ON storage.objects;
CREATE POLICY "app_files_supervisor_delete" ON storage.objects
FOR DELETE
USING (
  bucket_id = 'app-files'
  AND (SELECT public.is_active_supervisor())
);

CREATE OR REPLACE FUNCTION public.remove_inventory_item_from_person(
  p_person_id UUID,
  p_stock_item_id UUID,
  p_quantity INTEGER,
  p_destination TEXT
)
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  current_inventory_qty INTEGER;
  current_stock_qty INTEGER;
BEGIN
  IF NOT public.is_active_supervisor() THEN
    RAISE EXCEPTION 'Acesso negado: somente supervisores ativos podem movimentar inventario.';
  END IF;

  IF p_person_id IS NULL OR p_stock_item_id IS NULL THEN
    RAISE EXCEPTION 'Colaborador e item sao obrigatorios.';
  END IF;

  IF p_quantity IS NULL OR p_quantity <= 0 THEN
    RAISE EXCEPTION 'Informe uma quantidade maior que zero.';
  END IF;

  IF p_destination NOT IN ('delete', 'return_to_stock') THEN
    RAISE EXCEPTION 'Destino invalido. Use delete ou return_to_stock.';
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
    SELECT current_quantity
      INTO current_stock_qty
    FROM public.stock_items
    WHERE id = p_stock_item_id
    FOR UPDATE;

    IF current_stock_qty IS NULL THEN
      RAISE EXCEPTION 'Item de estoque nao encontrado.';
    END IF;

    UPDATE public.stock_items
    SET
      current_quantity = current_quantity + p_quantity,
      updated_at = now()
    WHERE id = p_stock_item_id;
  END IF;

  UPDATE public.person_inventories
  SET
    quantity = quantity - p_quantity,
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

REVOKE EXECUTE ON FUNCTION public.remove_inventory_item_from_person(UUID, UUID, INTEGER, TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.remove_inventory_item_from_person(UUID, UUID, INTEGER, TEXT) TO authenticated, service_role;

COMMIT;
