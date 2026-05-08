BEGIN;

ALTER TABLE public.people
  ADD COLUMN IF NOT EXISTS cpf TEXT,
  ADD COLUMN IF NOT EXISTS document_attachments JSONB NOT NULL DEFAULT '[]'::jsonb;

ALTER TABLE public.people
  DROP CONSTRAINT IF EXISTS people_cpf_unique;

ALTER TABLE public.people
  ADD CONSTRAINT people_cpf_unique UNIQUE (cpf);

ALTER TABLE public.people
  DROP CONSTRAINT IF EXISTS people_cpf_digits_check;

ALTER TABLE public.people
  ADD CONSTRAINT people_cpf_digits_check
  CHECK (cpf IS NULL OR regexp_replace(cpf, '\D', '', 'g') ~ '^\d{11}$');

ALTER TABLE public.people
  DROP CONSTRAINT IF EXISTS people_document_attachments_array_check;

ALTER TABLE public.people
  ADD CONSTRAINT people_document_attachments_array_check
  CHECK (jsonb_typeof(document_attachments) = 'array');

ALTER TABLE public.people
  DROP CONSTRAINT IF EXISTS people_created_by_fkey;

ALTER TABLE public.people
  ADD CONSTRAINT people_created_by_fkey
  FOREIGN KEY (created_by)
  REFERENCES public.profiles(id)
  ON DELETE SET NULL;

ALTER TABLE public.work_sites
  DROP CONSTRAINT IF EXISTS work_sites_created_by_fkey;

ALTER TABLE public.work_sites
  ADD CONSTRAINT work_sites_created_by_fkey
  FOREIGN KEY (created_by)
  REFERENCES public.profiles(id)
  ON DELETE SET NULL;

ALTER TABLE public.stock_items
  DROP CONSTRAINT IF EXISTS stock_items_created_by_fkey;

ALTER TABLE public.stock_items
  ADD CONSTRAINT stock_items_created_by_fkey
  FOREIGN KEY (created_by)
  REFERENCES public.profiles(id)
  ON DELETE SET NULL;

ALTER TABLE public.kits
  DROP CONSTRAINT IF EXISTS kits_created_by_fkey;

ALTER TABLE public.kits
  ADD CONSTRAINT kits_created_by_fkey
  FOREIGN KEY (created_by)
  REFERENCES public.profiles(id)
  ON DELETE SET NULL;

ALTER TABLE public.audit_logs
  DROP CONSTRAINT IF EXISTS audit_logs_user_id_fkey;

ALTER TABLE public.audit_logs
  ADD CONSTRAINT audit_logs_user_id_fkey
  FOREIGN KEY (user_id)
  REFERENCES public.profiles(id)
  ON DELETE SET NULL;

COMMIT;
