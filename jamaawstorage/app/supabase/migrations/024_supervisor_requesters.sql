ALTER TABLE public.people
  ADD COLUMN IF NOT EXISTS profile_id UUID;

ALTER TABLE public.people
  DROP CONSTRAINT IF EXISTS people_profile_id_fkey;

ALTER TABLE public.people
  ADD CONSTRAINT people_profile_id_fkey
  FOREIGN KEY (profile_id)
  REFERENCES public.profiles(id)
  ON DELETE SET NULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'people_profile_id_unique'
      AND conrelid = 'public.people'::regclass
  ) THEN
    ALTER TABLE public.people
      ADD CONSTRAINT people_profile_id_unique UNIQUE (profile_id);
  END IF;
END
$$;

ALTER TABLE public.people
  DROP CONSTRAINT IF EXISTS people_role_check;

ALTER TABLE public.people
  ADD CONSTRAINT people_role_check
  CHECK (role IN ('leader', 'collaborator', 'supervisor'));

CREATE OR REPLACE FUNCTION public.sync_supervisor_person_from_profile_row(profile_row public.profiles)
RETURNS UUID
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  normalized_employee_id TEXT;
  conflicting_person_id UUID;
  synced_person_id UUID;
BEGIN
  IF profile_row.role <> 'supervisor' THEN
    UPDATE public.people
    SET
      is_active = false,
      updated_at = now()
    WHERE profile_id = profile_row.id
      AND role = 'supervisor';

    RETURN NULL;
  END IF;

  normalized_employee_id := NULLIF(trim(profile_row.employee_id), '');

  IF normalized_employee_id IS NOT NULL THEN
    SELECT people.id
    INTO conflicting_person_id
    FROM public.people
    WHERE people.employee_id = normalized_employee_id
      AND people.profile_id IS DISTINCT FROM profile_row.id
    LIMIT 1;

    IF conflicting_person_id IS NOT NULL THEN
      normalized_employee_id := NULL;
    END IF;
  END IF;

  INSERT INTO public.people (
    full_name,
    employee_id,
    role,
    sector,
    photo_url,
    is_active,
    created_by,
    profile_id
  )
  VALUES (
    COALESCE(NULLIF(trim(profile_row.full_name), ''), 'Supervisor'),
    normalized_employee_id,
    'supervisor',
    profile_row.sector,
    profile_row.photo_url,
    profile_row.is_active,
    profile_row.id,
    profile_row.id
  )
  ON CONFLICT (profile_id) DO UPDATE
  SET
    full_name = EXCLUDED.full_name,
    employee_id = COALESCE(EXCLUDED.employee_id, public.people.employee_id),
    role = 'supervisor',
    sector = EXCLUDED.sector,
    photo_url = EXCLUDED.photo_url,
    is_active = EXCLUDED.is_active,
    updated_at = now()
  RETURNING id INTO synced_person_id;

  RETURN synced_person_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.sync_supervisor_person_from_profile()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  PERFORM public.sync_supervisor_person_from_profile_row(NEW);
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS profiles_sync_supervisor_person_after_write ON public.profiles;

CREATE TRIGGER profiles_sync_supervisor_person_after_write
AFTER INSERT OR UPDATE OF full_name, employee_id, role, sector, photo_url, is_active
ON public.profiles
FOR EACH ROW
EXECUTE FUNCTION public.sync_supervisor_person_from_profile();

SELECT public.sync_supervisor_person_from_profile_row(p)
FROM public.profiles AS p
WHERE role = 'supervisor';
