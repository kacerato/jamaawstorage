BEGIN;

CREATE TABLE IF NOT EXISTS public.stock_return_requests (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  stock_item_id UUID NOT NULL REFERENCES public.stock_items(id),
  quantity INTEGER NOT NULL CHECK (quantity > 0),
  source_type TEXT NOT NULL CHECK (source_type IN ('collaborator', 'work_site')),
  source_person_id UUID NULL REFERENCES public.people(id),
  source_work_site_id UUID NULL REFERENCES public.work_sites(id),
  source_details TEXT NULL,
  notes TEXT NULL,
  photo_url TEXT NULL,
  document_url TEXT NULL,
  document_name TEXT NULL,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'held', 'approved')),
  created_by UUID NULL REFERENCES public.profiles(id),
  approved_by UUID NULL REFERENCES public.profiles(id),
  approved_at TIMESTAMPTZ NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT stock_return_requests_source_check CHECK (
    (source_type = 'collaborator' AND source_person_id IS NOT NULL AND source_work_site_id IS NULL)
    OR (source_type = 'work_site' AND source_work_site_id IS NOT NULL AND source_person_id IS NULL)
  )
);

CREATE INDEX IF NOT EXISTS idx_stock_return_requests_status
  ON public.stock_return_requests(status, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_stock_return_requests_stock_item
  ON public.stock_return_requests(stock_item_id);

CREATE INDEX IF NOT EXISTS idx_stock_return_requests_source_person
  ON public.stock_return_requests(source_person_id)
  WHERE source_person_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_stock_return_requests_source_work_site
  ON public.stock_return_requests(source_work_site_id)
  WHERE source_work_site_id IS NOT NULL;

ALTER TABLE public.stock_return_requests ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "stock_return_requests_select_supervisor" ON public.stock_return_requests;
CREATE POLICY "stock_return_requests_select_supervisor" ON public.stock_return_requests
FOR SELECT
USING ((SELECT public.is_active_supervisor()));

DROP POLICY IF EXISTS "stock_return_requests_insert_supervisor" ON public.stock_return_requests;
CREATE POLICY "stock_return_requests_insert_supervisor" ON public.stock_return_requests
FOR INSERT
WITH CHECK ((SELECT public.is_active_supervisor()));

DROP POLICY IF EXISTS "stock_return_requests_update_supervisor" ON public.stock_return_requests;
CREATE POLICY "stock_return_requests_update_supervisor" ON public.stock_return_requests
FOR UPDATE
USING ((SELECT public.is_active_supervisor()))
WITH CHECK ((SELECT public.is_active_supervisor()));

DROP POLICY IF EXISTS "stock_return_requests_delete_supervisor" ON public.stock_return_requests;
CREATE POLICY "stock_return_requests_delete_supervisor" ON public.stock_return_requests
FOR DELETE
USING ((SELECT public.is_active_supervisor()));

DROP TRIGGER IF EXISTS trg_stock_return_requests_updated_at ON public.stock_return_requests;
CREATE TRIGGER trg_stock_return_requests_updated_at
  BEFORE UPDATE ON public.stock_return_requests
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();

CREATE OR REPLACE FUNCTION public.set_stock_return_request_status(
  p_request_id UUID,
  p_status TEXT
)
RETURNS public.stock_return_requests
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  target_request public.stock_return_requests%ROWTYPE;
BEGIN
  IF NOT public.is_active_supervisor() THEN
    RAISE EXCEPTION 'Acesso negado: somente supervisores ativos podem gerenciar devolucoes.';
  END IF;

  IF p_request_id IS NULL THEN
    RAISE EXCEPTION 'Informe a devolucao que sera atualizada.';
  END IF;

  IF p_status NOT IN ('pending', 'held') THEN
    RAISE EXCEPTION 'Status invalido. Use pending ou held.';
  END IF;

  SELECT *
    INTO target_request
  FROM public.stock_return_requests
  WHERE id = p_request_id
  FOR UPDATE;

  IF target_request.id IS NULL THEN
    RAISE EXCEPTION 'Devolucao nao encontrada.';
  END IF;

  IF target_request.status = 'approved' THEN
    RAISE EXCEPTION 'Esta devolucao ja foi aprovada e nao pode voltar para triagem.';
  END IF;

  UPDATE public.stock_return_requests
  SET
    status = p_status,
    approved_by = NULL,
    approved_at = NULL,
    updated_at = now()
  WHERE id = p_request_id
  RETURNING * INTO target_request;

  RETURN target_request;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.set_stock_return_request_status(UUID, TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.set_stock_return_request_status(UUID, TEXT) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.approve_stock_return_request(
  p_request_id UUID
)
RETURNS public.stock_return_requests
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  target_request public.stock_return_requests%ROWTYPE;
  supervisor_profile_id UUID;
BEGIN
  IF NOT public.is_active_supervisor() THEN
    RAISE EXCEPTION 'Acesso negado: somente supervisores ativos podem aprovar devolucoes.';
  END IF;

  IF p_request_id IS NULL THEN
    RAISE EXCEPTION 'Informe a devolucao que sera aprovada.';
  END IF;

  SELECT id
    INTO supervisor_profile_id
  FROM public.profiles
  WHERE id = auth.uid();

  SELECT *
    INTO target_request
  FROM public.stock_return_requests
  WHERE id = p_request_id
  FOR UPDATE;

  IF target_request.id IS NULL THEN
    RAISE EXCEPTION 'Devolucao nao encontrada.';
  END IF;

  IF target_request.status = 'approved' THEN
    RAISE EXCEPTION 'Esta devolucao ja foi aprovada.';
  END IF;

  UPDATE public.stock_items
  SET
    current_quantity = current_quantity + target_request.quantity,
    updated_at = now()
  WHERE id = target_request.stock_item_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Item de estoque nao encontrado para aprovar a devolucao.';
  END IF;

  UPDATE public.stock_return_requests
  SET
    status = 'approved',
    approved_by = supervisor_profile_id,
    approved_at = now(),
    updated_at = now()
  WHERE id = p_request_id
  RETURNING * INTO target_request;

  RETURN target_request;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.approve_stock_return_request(UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.approve_stock_return_request(UUID) TO authenticated, service_role;

COMMIT;
