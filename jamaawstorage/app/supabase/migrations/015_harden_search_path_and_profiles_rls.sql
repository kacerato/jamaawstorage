BEGIN;

-- Fix role-mutable search_path warnings on utility and trigger functions.
ALTER FUNCTION public.update_updated_at_column()
  SET search_path = public;

ALTER FUNCTION public.handle_stock_deduction()
  SET search_path = public;

ALTER FUNCTION public.generate_prefixed_sequence(TEXT, TEXT, TEXT)
  SET search_path = public;

ALTER FUNCTION public.set_stock_item_code()
  SET search_path = public;

ALTER FUNCTION public.set_profile_employee_id()
  SET search_path = public;

ALTER FUNCTION public.set_people_employee_id()
  SET search_path = public;

ALTER FUNCTION public.generate_withdrawal_code()
  SET search_path = public;

-- Fix per-row auth/function re-evaluation on profiles RLS policies.
DROP POLICY IF EXISTS "profiles_select_own_or_supervisor" ON public.profiles;
CREATE POLICY "profiles_select_own_or_supervisor" ON public.profiles
  FOR SELECT TO authenticated
  USING (
    id = (SELECT auth.uid())
    OR (SELECT public.is_active_supervisor())
  );

DROP POLICY IF EXISTS "profiles_insert_supervisor_own" ON public.profiles;
CREATE POLICY "profiles_insert_supervisor_own" ON public.profiles
  FOR INSERT TO authenticated
  WITH CHECK (
    id = (SELECT auth.uid())
    AND (SELECT public.is_active_supervisor())
  );

DROP POLICY IF EXISTS "profiles_update_supervisor_own" ON public.profiles;
CREATE POLICY "profiles_update_supervisor_own" ON public.profiles
  FOR UPDATE TO authenticated
  USING (
    id = (SELECT auth.uid())
    AND (SELECT public.is_active_supervisor())
  )
  WITH CHECK (
    id = (SELECT auth.uid())
    AND (SELECT public.is_active_supervisor())
  );

COMMIT;
