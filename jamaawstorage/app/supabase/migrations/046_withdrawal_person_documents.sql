BEGIN;

CREATE TABLE IF NOT EXISTS public.withdrawal_document_requirements (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  withdrawal_id UUID NOT NULL REFERENCES public.withdrawals(id) ON DELETE CASCADE,
  person_id UUID NOT NULL REFERENCES public.people(id) ON DELETE RESTRICT,
  scope_key TEXT NOT NULL,
  destination_type public.withdrawal_destination_type NOT NULL,
  collaborator_id UUID NULL REFERENCES public.people(id) ON DELETE RESTRICT,
  work_site_id UUID NULL REFERENCES public.work_sites(id) ON DELETE RESTRICT,
  status TEXT NOT NULL DEFAULT 'pending',
  person_name_snapshot TEXT NOT NULL,
  person_role_snapshot TEXT NOT NULL,
  destination_label_snapshot TEXT NOT NULL,
  due_at TIMESTAMPTZ NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT withdrawal_document_requirements_scope_unique UNIQUE (withdrawal_id, scope_key),
  CONSTRAINT withdrawal_document_requirements_status_check
    CHECK (status IN ('pending', 'attached', 'rejected', 'replaced', 'not_required')),
  CONSTRAINT withdrawal_document_requirements_destination_check CHECK (
    (destination_type = 'collaborator' AND collaborator_id IS NOT NULL AND work_site_id IS NULL)
    OR
    (destination_type = 'work_site' AND collaborator_id IS NULL AND work_site_id IS NOT NULL)
  )
);

CREATE TABLE IF NOT EXISTS public.withdrawal_person_documents (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  requirement_id UUID NOT NULL REFERENCES public.withdrawal_document_requirements(id) ON DELETE RESTRICT,
  withdrawal_id UUID NOT NULL REFERENCES public.withdrawals(id) ON DELETE CASCADE,
  person_id UUID NOT NULL REFERENCES public.people(id) ON DELETE RESTRICT,
  version INTEGER NOT NULL,
  status TEXT NOT NULL DEFAULT 'active',
  storage_path TEXT NOT NULL,
  file_name TEXT NOT NULL,
  mime_type TEXT NOT NULL DEFAULT 'application/pdf',
  file_size BIGINT NOT NULL,
  sha256 TEXT NULL,
  uploaded_by UUID NOT NULL REFERENCES public.profiles(id) ON DELETE RESTRICT,
  uploaded_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  rejection_reason TEXT NULL,
  rejected_by UUID NULL REFERENCES public.profiles(id) ON DELETE RESTRICT,
  rejected_at TIMESTAMPTZ NULL,
  supersedes_document_id UUID NULL REFERENCES public.withdrawal_person_documents(id) ON DELETE RESTRICT,
  notes TEXT NULL,
  CONSTRAINT withdrawal_person_documents_version_unique UNIQUE (requirement_id, version),
  CONSTRAINT withdrawal_person_documents_status_check CHECK (status IN ('active', 'replaced', 'rejected')),
  CONSTRAINT withdrawal_person_documents_version_positive CHECK (version > 0),
  CONSTRAINT withdrawal_person_documents_file_size_positive CHECK (file_size > 0),
  CONSTRAINT withdrawal_person_documents_pdf_mime CHECK (mime_type = 'application/pdf')
);

CREATE UNIQUE INDEX IF NOT EXISTS withdrawal_person_documents_one_active_idx
  ON public.withdrawal_person_documents(requirement_id)
  WHERE status = 'active';

CREATE INDEX IF NOT EXISTS withdrawal_document_requirements_withdrawal_idx
  ON public.withdrawal_document_requirements(withdrawal_id);
CREATE INDEX IF NOT EXISTS withdrawal_document_requirements_person_idx
  ON public.withdrawal_document_requirements(person_id, created_at DESC);
CREATE INDEX IF NOT EXISTS withdrawal_document_requirements_status_idx
  ON public.withdrawal_document_requirements(status, due_at);
CREATE INDEX IF NOT EXISTS withdrawal_person_documents_withdrawal_idx
  ON public.withdrawal_person_documents(withdrawal_id, uploaded_at DESC);
CREATE INDEX IF NOT EXISTS withdrawal_person_documents_person_idx
  ON public.withdrawal_person_documents(person_id, uploaded_at DESC);

ALTER TABLE public.withdrawal_document_requirements ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.withdrawal_person_documents ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "withdrawal_document_requirements_supervisor_all" ON public.withdrawal_document_requirements;
DROP POLICY IF EXISTS "withdrawal_document_requirements_supervisor_select" ON public.withdrawal_document_requirements;
CREATE POLICY "withdrawal_document_requirements_supervisor_select"
ON public.withdrawal_document_requirements
FOR SELECT
USING ((SELECT public.is_active_supervisor()));

DROP POLICY IF EXISTS "withdrawal_person_documents_supervisor_all" ON public.withdrawal_person_documents;
DROP POLICY IF EXISTS "withdrawal_person_documents_supervisor_select" ON public.withdrawal_person_documents;
CREATE POLICY "withdrawal_person_documents_supervisor_select"
ON public.withdrawal_person_documents
FOR SELECT
USING ((SELECT public.is_active_supervisor()));

DROP TRIGGER IF EXISTS trg_withdrawal_document_requirements_updated_at ON public.withdrawal_document_requirements;
CREATE TRIGGER trg_withdrawal_document_requirements_updated_at
  BEFORE UPDATE ON public.withdrawal_document_requirements
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

DROP TRIGGER IF EXISTS trg_withdrawal_document_requirements_audit ON public.withdrawal_document_requirements;
CREATE TRIGGER trg_withdrawal_document_requirements_audit
  AFTER INSERT OR UPDATE OR DELETE ON public.withdrawal_document_requirements
  FOR EACH ROW EXECUTE FUNCTION public.log_audit();

DROP TRIGGER IF EXISTS trg_withdrawal_person_documents_audit ON public.withdrawal_person_documents;
CREATE TRIGGER trg_withdrawal_person_documents_audit
  AFTER INSERT OR UPDATE OR DELETE ON public.withdrawal_person_documents
  FOR EACH ROW EXECUTE FUNCTION public.log_audit();

CREATE OR REPLACE FUNCTION public.sync_withdrawal_document_requirements_internal(
  p_withdrawal_id UUID
)
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  requirement_count INTEGER;
BEGIN
  IF p_withdrawal_id IS NULL OR NOT EXISTS (
    SELECT 1 FROM public.withdrawals WHERE id = p_withdrawal_id
  ) THEN
    RETURN 0;
  END IF;

  WITH expected AS (
    SELECT DISTINCT
      wi.withdrawal_id,
      COALESCE(wi.collaborator_id, w.collaborator_id) AS person_id,
      concat('collaborator:', COALESCE(wi.collaborator_id, w.collaborator_id)::TEXT, ':none') AS scope_key,
      'collaborator'::public.withdrawal_destination_type AS destination_type,
      COALESCE(wi.collaborator_id, w.collaborator_id) AS collaborator_id,
      NULL::UUID AS work_site_id,
      p.full_name AS person_name_snapshot,
      p.role::TEXT AS person_role_snapshot,
      p.full_name AS destination_label_snapshot
    FROM public.withdrawal_items wi
    JOIN public.withdrawals w ON w.id = wi.withdrawal_id
    JOIN public.people p ON p.id = COALESCE(wi.collaborator_id, w.collaborator_id)
    WHERE wi.withdrawal_id = p_withdrawal_id
      AND COALESCE(wi.destination_type, w.destination_type) = 'collaborator'
      AND COALESCE(wi.collaborator_id, w.collaborator_id) IS NOT NULL

    UNION ALL

    SELECT DISTINCT
      wi.withdrawal_id,
      w.requested_by AS person_id,
      concat('work_site:none:', COALESCE(wi.work_site_id, w.work_site_id)::TEXT) AS scope_key,
      'work_site'::public.withdrawal_destination_type AS destination_type,
      NULL::UUID AS collaborator_id,
      COALESCE(wi.work_site_id, w.work_site_id) AS work_site_id,
      p.full_name AS person_name_snapshot,
      p.role::TEXT AS person_role_snapshot,
      ws.name AS destination_label_snapshot
    FROM public.withdrawal_items wi
    JOIN public.withdrawals w ON w.id = wi.withdrawal_id
    JOIN public.people p ON p.id = w.requested_by
    JOIN public.work_sites ws ON ws.id = COALESCE(wi.work_site_id, w.work_site_id)
    WHERE wi.withdrawal_id = p_withdrawal_id
      AND COALESCE(wi.destination_type, w.destination_type) = 'work_site'
      AND COALESCE(wi.work_site_id, w.work_site_id) IS NOT NULL
  )
  INSERT INTO public.withdrawal_document_requirements (
    withdrawal_id,
    person_id,
    scope_key,
    destination_type,
    collaborator_id,
    work_site_id,
    status,
    person_name_snapshot,
    person_role_snapshot,
    destination_label_snapshot
  )
  SELECT
    withdrawal_id,
    person_id,
    scope_key,
    destination_type,
    collaborator_id,
    work_site_id,
    'pending',
    person_name_snapshot,
    person_role_snapshot,
    destination_label_snapshot
  FROM expected
  ON CONFLICT (withdrawal_id, scope_key) DO UPDATE
  SET
    person_id = EXCLUDED.person_id,
    destination_type = EXCLUDED.destination_type,
    collaborator_id = EXCLUDED.collaborator_id,
    work_site_id = EXCLUDED.work_site_id,
    person_name_snapshot = EXCLUDED.person_name_snapshot,
    person_role_snapshot = EXCLUDED.person_role_snapshot,
    destination_label_snapshot = EXCLUDED.destination_label_snapshot,
    status = CASE
      WHEN EXISTS (
        SELECT 1
        FROM public.withdrawal_person_documents wpd
        WHERE wpd.requirement_id = withdrawal_document_requirements.id
          AND wpd.status = 'active'
      ) THEN 'attached'
      WHEN withdrawal_document_requirements.status = 'rejected' THEN 'rejected'
      ELSE 'pending'
    END,
    updated_at = now();

  UPDATE public.withdrawal_document_requirements requirement
  SET status = 'not_required', updated_at = now()
  WHERE requirement.withdrawal_id = p_withdrawal_id
    AND requirement.status <> 'not_required'
    AND NOT EXISTS (
      SELECT 1
      FROM public.withdrawal_items wi
      JOIN public.withdrawals w ON w.id = wi.withdrawal_id
      WHERE wi.withdrawal_id = p_withdrawal_id
        AND (
          (
            COALESCE(wi.destination_type, w.destination_type) = 'collaborator'
            AND concat('collaborator:', COALESCE(wi.collaborator_id, w.collaborator_id)::TEXT, ':none') = requirement.scope_key
          )
          OR
          (
            COALESCE(wi.destination_type, w.destination_type) = 'work_site'
            AND concat('work_site:none:', COALESCE(wi.work_site_id, w.work_site_id)::TEXT) = requirement.scope_key
            AND w.requested_by = requirement.person_id
          )
        )
    );

  SELECT count(*)::INTEGER
    INTO requirement_count
  FROM public.withdrawal_document_requirements
  WHERE withdrawal_id = p_withdrawal_id
    AND status <> 'not_required';

  RETURN requirement_count;
END;
$$;

REVOKE ALL ON FUNCTION public.sync_withdrawal_document_requirements_internal(UUID) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.sync_withdrawal_requirements_after_insert()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE row_item RECORD;
BEGIN
  FOR row_item IN SELECT DISTINCT withdrawal_id FROM new_rows LOOP
    PERFORM public.sync_withdrawal_document_requirements_internal(row_item.withdrawal_id);
  END LOOP;
  RETURN NULL;
END;
$$;

CREATE OR REPLACE FUNCTION public.sync_withdrawal_requirements_after_update()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE row_item RECORD;
BEGIN
  FOR row_item IN
    SELECT withdrawal_id FROM new_rows
    UNION
    SELECT withdrawal_id FROM old_rows
  LOOP
    PERFORM public.sync_withdrawal_document_requirements_internal(row_item.withdrawal_id);
  END LOOP;
  RETURN NULL;
END;
$$;

CREATE OR REPLACE FUNCTION public.sync_withdrawal_requirements_after_delete()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE row_item RECORD;
BEGIN
  FOR row_item IN SELECT DISTINCT withdrawal_id FROM old_rows LOOP
    PERFORM public.sync_withdrawal_document_requirements_internal(row_item.withdrawal_id);
  END LOOP;
  RETURN NULL;
END;
$$;

REVOKE ALL ON FUNCTION public.sync_withdrawal_requirements_after_insert() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.sync_withdrawal_requirements_after_update() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.sync_withdrawal_requirements_after_delete() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_withdrawal_items_document_requirements_insert ON public.withdrawal_items;
CREATE TRIGGER trg_withdrawal_items_document_requirements_insert
  AFTER INSERT ON public.withdrawal_items
  REFERENCING NEW TABLE AS new_rows
  FOR EACH STATEMENT EXECUTE FUNCTION public.sync_withdrawal_requirements_after_insert();

DROP TRIGGER IF EXISTS trg_withdrawal_items_document_requirements_update ON public.withdrawal_items;
CREATE TRIGGER trg_withdrawal_items_document_requirements_update
  AFTER UPDATE ON public.withdrawal_items
  REFERENCING OLD TABLE AS old_rows NEW TABLE AS new_rows
  FOR EACH STATEMENT EXECUTE FUNCTION public.sync_withdrawal_requirements_after_update();

DROP TRIGGER IF EXISTS trg_withdrawal_items_document_requirements_delete ON public.withdrawal_items;
CREATE TRIGGER trg_withdrawal_items_document_requirements_delete
  AFTER DELETE ON public.withdrawal_items
  REFERENCING OLD TABLE AS old_rows
  FOR EACH STATEMENT EXECUTE FUNCTION public.sync_withdrawal_requirements_after_delete();

CREATE OR REPLACE FUNCTION public.register_withdrawal_person_document(
  p_requirement_id UUID,
  p_storage_path TEXT,
  p_file_name TEXT,
  p_mime_type TEXT,
  p_file_size BIGINT,
  p_sha256 TEXT DEFAULT NULL,
  p_notes TEXT DEFAULT NULL
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  target_requirement public.withdrawal_document_requirements%ROWTYPE;
  previous_document_id UUID;
  next_version INTEGER;
  new_document_id UUID;
BEGIN
  IF NOT public.is_active_supervisor() THEN
    RAISE EXCEPTION 'Acesso negado: somente supervisores ativos podem anexar documentos.';
  END IF;

  IF p_storage_path IS NULL OR trim(p_storage_path) = ''
     OR p_file_name IS NULL OR trim(p_file_name) = '' THEN
    RAISE EXCEPTION 'Arquivo e nome sao obrigatorios.';
  END IF;

  IF p_mime_type <> 'application/pdf' OR p_file_size IS NULL OR p_file_size <= 0 THEN
    RAISE EXCEPTION 'Envie um PDF valido.';
  END IF;

  SELECT * INTO target_requirement
  FROM public.withdrawal_document_requirements
  WHERE id = p_requirement_id
  FOR UPDATE;

  IF target_requirement.id IS NULL OR target_requirement.status = 'not_required' THEN
    RAISE EXCEPTION 'Pendencia documental nao encontrada ou nao esta mais ativa.';
  END IF;

  SELECT id INTO previous_document_id
  FROM public.withdrawal_person_documents
  WHERE requirement_id = p_requirement_id
    AND status = 'active'
  FOR UPDATE;

  SELECT COALESCE(MAX(version), 0) + 1
    INTO next_version
  FROM public.withdrawal_person_documents
  WHERE requirement_id = p_requirement_id;

  UPDATE public.withdrawal_person_documents
  SET status = 'replaced'
  WHERE requirement_id = p_requirement_id
    AND status = 'active';

  INSERT INTO public.withdrawal_person_documents (
    requirement_id,
    withdrawal_id,
    person_id,
    version,
    status,
    storage_path,
    file_name,
    mime_type,
    file_size,
    sha256,
    uploaded_by,
    supersedes_document_id,
    notes
  ) VALUES (
    target_requirement.id,
    target_requirement.withdrawal_id,
    target_requirement.person_id,
    next_version,
    'active',
    trim(p_storage_path),
    trim(p_file_name),
    p_mime_type,
    p_file_size,
    NULLIF(trim(p_sha256), ''),
    auth.uid(),
    previous_document_id,
    NULLIF(trim(p_notes), '')
  )
  RETURNING id INTO new_document_id;

  UPDATE public.withdrawal_document_requirements
  SET status = 'attached', updated_at = now()
  WHERE id = p_requirement_id;

  RETURN new_document_id;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.register_withdrawal_person_document(UUID, TEXT, TEXT, TEXT, BIGINT, TEXT, TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.register_withdrawal_person_document(UUID, TEXT, TEXT, TEXT, BIGINT, TEXT, TEXT) TO authenticated, service_role;

CREATE OR REPLACE VIEW public.withdrawal_document_summary
WITH (security_invoker = true)
AS
SELECT
  withdrawal_id,
  count(*) FILTER (WHERE status <> 'not_required')::INTEGER AS expected_count,
  count(*) FILTER (WHERE status = 'attached')::INTEGER AS attached_count,
  count(*) FILTER (WHERE status = 'pending')::INTEGER AS pending_count,
  count(*) FILTER (WHERE status = 'rejected')::INTEGER AS rejected_count,
  CASE
    WHEN count(*) FILTER (WHERE status <> 'not_required') = 0 THEN 'not_required'
    WHEN count(*) FILTER (WHERE status = 'rejected') > 0 THEN 'rejected'
    WHEN count(*) FILTER (WHERE status = 'attached') = count(*) FILTER (WHERE status <> 'not_required') THEN 'complete'
    WHEN count(*) FILTER (WHERE status = 'attached') > 0 THEN 'partial'
    ELSE 'pending'
  END AS document_status
FROM public.withdrawal_document_requirements
GROUP BY withdrawal_id;

GRANT SELECT ON public.withdrawal_document_summary TO authenticated, service_role;

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'withdrawal-signed-documents',
  'withdrawal-signed-documents',
  false,
  12582912,
  ARRAY['application/pdf']
)
ON CONFLICT (id) DO UPDATE
SET
  public = false,
  file_size_limit = EXCLUDED.file_size_limit,
  allowed_mime_types = EXCLUDED.allowed_mime_types;

DROP POLICY IF EXISTS "withdrawal_signed_documents_supervisor_read" ON storage.objects;
CREATE POLICY "withdrawal_signed_documents_supervisor_read" ON storage.objects
FOR SELECT USING (
  bucket_id = 'withdrawal-signed-documents'
  AND (SELECT public.is_active_supervisor())
);

DROP POLICY IF EXISTS "withdrawal_signed_documents_supervisor_insert" ON storage.objects;
CREATE POLICY "withdrawal_signed_documents_supervisor_insert" ON storage.objects
FOR INSERT WITH CHECK (
  bucket_id = 'withdrawal-signed-documents'
  AND (SELECT public.is_active_supervisor())
);

DROP POLICY IF EXISTS "withdrawal_signed_documents_supervisor_delete" ON storage.objects;
CREATE POLICY "withdrawal_signed_documents_supervisor_delete" ON storage.objects
FOR DELETE USING (
  bucket_id = 'withdrawal-signed-documents'
  AND (SELECT public.is_active_supervisor())
);

DO $$
DECLARE withdrawal_row RECORD;
BEGIN
  FOR withdrawal_row IN SELECT id FROM public.withdrawals LOOP
    PERFORM public.sync_withdrawal_document_requirements_internal(withdrawal_row.id);
  END LOOP;
END;
$$;

COMMIT;
