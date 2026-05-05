BEGIN;

CREATE OR REPLACE FUNCTION public.restore_own_profile_if_missing()
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
  current_user_id UUID := auth.uid();
  current_email TEXT;
  raw_meta JSONB;
  normalized_full_name TEXT;
  normalized_employee_id TEXT;
  normalized_sector TEXT;
  should_activate BOOLEAN;
BEGIN
  IF current_user_id IS NULL THEN
    RAISE EXCEPTION 'Sessao de autenticacao invalida.';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.profiles
    WHERE id = current_user_id
  ) THEN
    RETURN current_user_id;
  END IF;

  SELECT email, raw_user_meta_data
  INTO current_email, raw_meta
  FROM auth.users
  WHERE id = current_user_id;

  IF current_email IS NULL AND raw_meta IS NULL THEN
    RAISE EXCEPTION 'Usuario autenticado nao encontrado.';
  END IF;

  normalized_full_name := NULLIF(
    trim(COALESCE(raw_meta->>'full_name', current_email, 'Sem nome')),
    ''
  );
  normalized_employee_id := NULLIF(trim(COALESCE(raw_meta->>'employee_id', '')), '');
  normalized_sector := NULLIF(trim(COALESCE(raw_meta->>'sector', '')), '');

  should_activate := EXISTS (
    SELECT 1
    FROM public.audit_logs logs
    WHERE logs.table_name = 'profiles'
      AND logs.record_id = current_user_id
      AND (
        COALESCE(logs.new_data->>'created_by_rpc', 'false') = 'true'
        OR COALESCE(logs.new_data->>'activated_by_rpc', 'false') = 'true'
        OR COALESCE(logs.new_data->>'is_active', 'false') = 'true'
      )
  );

  INSERT INTO public.profiles (id, full_name, employee_id, role, sector, is_active)
  VALUES (
    current_user_id,
    COALESCE(normalized_full_name, 'Sem nome'),
    normalized_employee_id,
    'supervisor',
    normalized_sector,
    should_activate
  );

  RETURN current_user_id;
END;
$$;

COMMENT ON FUNCTION public.restore_own_profile_if_missing()
IS 'RPC: restores the authenticated user profile if public.profiles is missing. Reactivates only when prior audit evidence exists.';

REVOKE EXECUTE ON FUNCTION public.restore_own_profile_if_missing() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.restore_own_profile_if_missing() TO authenticated, service_role;

INSERT INTO public.profiles (id, full_name, employee_id, role, sector, is_active)
SELECT
  auth_user.id,
  COALESCE(
    NULLIF(trim(COALESCE(auth_user.raw_user_meta_data->>'full_name', auth_user.email, 'Sem nome')), ''),
    'Sem nome'
  ),
  NULLIF(trim(COALESCE(auth_user.raw_user_meta_data->>'employee_id', '')), ''),
  'supervisor'::public.app_role,
  NULLIF(trim(COALESCE(auth_user.raw_user_meta_data->>'sector', '')), ''),
  EXISTS (
    SELECT 1
    FROM public.audit_logs logs
    WHERE logs.table_name = 'profiles'
      AND logs.record_id = auth_user.id
      AND (
        COALESCE(logs.new_data->>'created_by_rpc', 'false') = 'true'
        OR COALESCE(logs.new_data->>'activated_by_rpc', 'false') = 'true'
        OR COALESCE(logs.new_data->>'is_active', 'false') = 'true'
      )
  )
FROM auth.users auth_user
LEFT JOIN public.profiles profile ON profile.id = auth_user.id
WHERE profile.id IS NULL;

COMMIT;
