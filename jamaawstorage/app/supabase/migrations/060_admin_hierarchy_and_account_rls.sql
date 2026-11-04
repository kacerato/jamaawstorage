-- Hierarquia de acesso do almoxarifado: admin acima de supervisor.
--
-- Decisoes tomadas com o usuario:
--   * jamaaw@dev.com (MAT-002) e o admin principal.
--   * O admin e o unico que gerencia contas: criar, ativar, desativar,
--     promover e rebaixar. Supervisor segue operando o almoxarifado inteiro
--     (estoque, retiradas, devolucoes, pessoas, veiculos) sem mudanca.
--   * O admin ve a atividade de cada conta.
--
-- Falha corrigida aqui: a policy profiles_update_supervisor_own permitia
-- UPDATE no proprio registro sem travar as colunas role e is_active, logo
-- qualquer supervisor podia se promover usando apenas a chave anon. Agora a
-- escrita em profiles passa por RPCs de admin e o UPDATE direto so alcanca
-- campos de perfil (nome, setor, foto).

BEGIN;

-- ---------------------------------------------------------------------------
-- 1. Predicados de autorizacao
-- ---------------------------------------------------------------------------

-- Admin ativo: o topo da hierarquia.
CREATE OR REPLACE FUNCTION public.is_active_admin()
  RETURNS BOOLEAN
  LANGUAGE sql
  SECURITY DEFINER
  STABLE
  SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.profiles
    WHERE id = auth.uid()
      AND role = 'admin'
      AND is_active = true
  );
$$;

COMMENT ON FUNCTION public.is_active_admin() IS
  'Verdadeiro quando o usuario autenticado e o administrador do almoxarifado (profiles.role = admin e ativo).';

-- Operador do almoxarifado: admin ou supervisor, ambos ativos.
--
-- is_active_supervisor() e redefinida para incluir admin, porque todas as
-- policies de operacao (estoque, retiradas, pessoas, veiculos) dependem dela.
-- Sem isso o admin perderia acesso ao proprio sistema que administra.
CREATE OR REPLACE FUNCTION public.is_active_supervisor()
  RETURNS BOOLEAN
  LANGUAGE sql
  SECURITY DEFINER
  STABLE
  SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.profiles
    WHERE id = auth.uid()
      AND role IN ('admin', 'supervisor')
      AND is_active = true
  );
$$;

COMMENT ON FUNCTION public.is_active_supervisor() IS
  'Verdadeiro quando o usuario autenticado opera o almoxarifado: admin ou supervisor, ativo. Admin esta incluido de proposito, para nao perder acesso as operacoes.';

-- ---------------------------------------------------------------------------
-- 2. Eleicao do admin principal
-- ---------------------------------------------------------------------------

-- Promove jamaaw@dev.com. Se o e-mail nao existir neste ambiente, promove a
-- conta de login mais antiga, para que nenhum ambiente fique sem administrador.
DO $$
DECLARE
  target_id UUID;
BEGIN
  IF EXISTS (SELECT 1 FROM public.profiles WHERE role = 'admin') THEN
    RAISE NOTICE 'Ja existe administrador; eleicao ignorada.';
    RETURN;
  END IF;

  SELECT p.id
  INTO target_id
  FROM public.profiles p
  JOIN auth.users u ON u.id = p.id
  WHERE lower(u.email) = 'jamaaw@dev.com'
  LIMIT 1;

  IF target_id IS NULL THEN
    SELECT id INTO target_id
    FROM public.profiles
    ORDER BY created_at
    LIMIT 1;
  END IF;

  IF target_id IS NULL THEN
    RAISE NOTICE 'Nenhuma conta de login encontrada; eleicao ignorada.';
    RETURN;
  END IF;

  PERFORM set_config('jamaaw.privilege_change', 'on', true);

  UPDATE public.profiles
  SET role = 'admin',
      is_active = true,
      updated_at = now()
  WHERE id = target_id;

  PERFORM set_config('jamaaw.privilege_change', 'off', true);

  INSERT INTO public.audit_logs (user_id, action, table_name, record_id, old_data, new_data)
  VALUES (
    target_id, 'UPDATE', 'profiles', target_id,
    jsonb_build_object('role', 'supervisor'),
    jsonb_build_object('role', 'admin', 'reason', 'eleicao do administrador principal via migracao 060')
  );
END;
$$;

-- Garante que sobre sempre um administrador ativo.
CREATE OR REPLACE FUNCTION public.guard_last_admin()
  RETURNS TRIGGER
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path = public
AS $$
DECLARE
  remaining INTEGER;
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF OLD.role <> 'admin' OR OLD.is_active = false THEN
      RETURN OLD;
    END IF;
  ELSE
    -- Interessa apenas quem deixa de ser admin ativo.
    IF OLD.role <> 'admin' OR OLD.is_active = false THEN
      RETURN NEW;
    END IF;
    IF NEW.role = 'admin' AND NEW.is_active = true THEN
      RETURN NEW;
    END IF;
  END IF;

  SELECT count(*)
  INTO remaining
  FROM public.profiles
  WHERE role = 'admin'
    AND is_active = true
    AND id <> OLD.id;

  IF remaining = 0 THEN
    RAISE EXCEPTION 'O almoxarifado precisa de pelo menos um administrador ativo. Promova outra conta a administrador antes de alterar esta.';
  END IF;

  IF TG_OP = 'DELETE' THEN
    RETURN OLD;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS guard_last_admin_update ON public.profiles;
CREATE TRIGGER guard_last_admin_update
  BEFORE UPDATE ON public.profiles
  FOR EACH ROW
  EXECUTE FUNCTION public.guard_last_admin();

DROP TRIGGER IF EXISTS guard_last_admin_delete ON public.profiles;
CREATE TRIGGER guard_last_admin_delete
  BEFORE DELETE ON public.profiles
  FOR EACH ROW
  EXECUTE FUNCTION public.guard_last_admin();

-- ---------------------------------------------------------------------------
-- 3. RLS de profiles
-- ---------------------------------------------------------------------------

-- Leitura: o admin ve todas as contas; o supervisor ve apenas a propria.
DROP POLICY IF EXISTS "profiles_select_own_or_supervisor" ON public.profiles;
DROP POLICY IF EXISTS "profiles_select_own_or_admin" ON public.profiles;
CREATE POLICY "profiles_select_own_or_admin" ON public.profiles
  FOR SELECT TO authenticated
  USING (
    id = (SELECT auth.uid())
    OR (SELECT public.is_active_admin())
  );

-- Escrita direta: so o proprio registro, e so campos de perfil.
DROP POLICY IF EXISTS "profiles_update_supervisor_own" ON public.profiles;
DROP POLICY IF EXISTS "profiles_update_own_profile_fields" ON public.profiles;
CREATE POLICY "profiles_update_own_profile_fields" ON public.profiles
  FOR UPDATE TO authenticated
  USING (
    id = (SELECT auth.uid())
    AND (SELECT public.is_active_supervisor())
  )
  WITH CHECK (
    id = (SELECT auth.uid())
    AND (SELECT public.is_active_supervisor())
  );

-- role e is_active sao congelados por trigger, nao por WITH CHECK: dentro do
-- WITH CHECK uma subconsulta em profiles ja enxerga a linha nova, entao a
-- comparacao passaria sempre. O trigger compara OLD com NEW, que e o unico
-- lugar onde o valor anterior existe de verdade.
--
-- Esta e a correcao do furo: sem ela, qualquer supervisor com a chave anon
-- faz UPDATE profiles SET role='admin' no proprio registro.
CREATE OR REPLACE FUNCTION public.freeze_profile_privilege_columns()
  RETURNS TRIGGER
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path = public
AS $$
BEGIN
  -- As RPCs de admin rodam como SECURITY DEFINER e sinalizam a passagem
  -- legitima; qualquer outro caminho tem papel e status congelados.
  IF current_setting('jamaaw.privilege_change', true) = 'on' THEN
    RETURN NEW;
  END IF;

  IF NEW.role IS DISTINCT FROM OLD.role THEN
    RAISE EXCEPTION 'Alteracao de papel permitida apenas ao administrador, pela tela de supervisores.';
  END IF;

  IF NEW.is_active IS DISTINCT FROM OLD.is_active THEN
    RAISE EXCEPTION 'Alteracao de status de conta permitida apenas ao administrador, pela tela de supervisores.';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS freeze_profile_privilege_columns_trigger ON public.profiles;
CREATE TRIGGER freeze_profile_privilege_columns_trigger
  BEFORE UPDATE ON public.profiles
  FOR EACH ROW
  EXECUTE FUNCTION public.freeze_profile_privilege_columns();

-- INSERT direto continua restrito ao proprio id: e o caminho do
-- restore_own_profile_if_missing. Papel elevado nao pode entrar por aqui.
DROP POLICY IF EXISTS "profiles_insert_supervisor_own" ON public.profiles;
DROP POLICY IF EXISTS "profiles_insert_own_non_admin" ON public.profiles;
CREATE POLICY "profiles_insert_own_non_admin" ON public.profiles
  FOR INSERT TO authenticated
  WITH CHECK (
    id = (SELECT auth.uid())
    AND (SELECT public.is_active_supervisor())
    AND role <> 'admin'
  );

-- Remocao de conta: exclusiva do admin, e nunca a propria.
DROP POLICY IF EXISTS "profiles_delete_admin" ON public.profiles;
CREATE POLICY "profiles_delete_admin" ON public.profiles
  FOR DELETE TO authenticated
  USING (
    (SELECT public.is_active_admin())
    AND id <> (SELECT auth.uid())
  );

-- ---------------------------------------------------------------------------
-- 4. Auditoria: admin ve tudo, supervisor ve as proprias acoes
-- ---------------------------------------------------------------------------

DROP POLICY IF EXISTS "audit_logs_select_supervisor" ON public.audit_logs;
DROP POLICY IF EXISTS "audit_logs_select_own_or_admin" ON public.audit_logs;
CREATE POLICY "audit_logs_select_own_or_admin" ON public.audit_logs
  FOR SELECT TO authenticated
  USING (
    user_id = (SELECT auth.uid())
    OR (SELECT public.is_active_admin())
  );

-- ---------------------------------------------------------------------------
-- 5. Gestao de contas pelo admin
-- ---------------------------------------------------------------------------

-- Criar conta de supervisor passa a ser exclusivo do admin.
CREATE OR REPLACE FUNCTION public.create_supervisor_account(
  p_email TEXT,
  p_password TEXT,
  p_full_name TEXT,
  p_employee_id TEXT DEFAULT NULL,
  p_sector TEXT DEFAULT NULL
)
  RETURNS UUID
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path = public
AS $$
DECLARE
  new_user_id UUID;
BEGIN
  IF NOT public.is_active_admin() THEN
    RAISE EXCEPTION 'Acesso negado: somente o administrador do almoxarifado pode criar contas.';
  END IF;

  IF p_email IS NULL OR trim(p_email) = '' THEN
    RAISE EXCEPTION 'E-mail e obrigatorio.';
  END IF;

  IF p_password IS NULL OR length(p_password) < 6 THEN
    RAISE EXCEPTION 'Senha deve ter pelo menos 6 caracteres.';
  END IF;

  IF p_full_name IS NULL OR trim(p_full_name) = '' THEN
    RAISE EXCEPTION 'Nome completo e obrigatorio.';
  END IF;

  IF EXISTS (SELECT 1 FROM auth.users WHERE lower(email) = lower(trim(p_email))) THEN
    RAISE EXCEPTION 'Este e-mail ja esta cadastrado.';
  END IF;

  INSERT INTO auth.users (
    id, aud, role, email, encrypted_password, email_confirmed_at,
    raw_app_meta_data, raw_user_meta_data, created_at, updated_at
  ) VALUES (
    gen_random_uuid(), 'authenticated', 'authenticated',
    lower(trim(p_email)), crypt(p_password, gen_salt('bf')), now(),
    '{"provider":"email","providers":["email"]}',
    jsonb_build_object('full_name', p_full_name, 'employee_id', p_employee_id),
    now(), now()
  ) RETURNING id INTO new_user_id;

  INSERT INTO public.profiles (id, full_name, employee_id, role, sector, is_active)
  VALUES (new_user_id, p_full_name, p_employee_id, 'supervisor', p_sector, true);

  INSERT INTO public.audit_logs (user_id, action, table_name, record_id, old_data, new_data)
  VALUES (
    auth.uid(), 'INSERT', 'profiles', new_user_id, NULL,
    jsonb_build_object(
      'id', new_user_id, 'full_name', p_full_name, 'role', 'supervisor',
      'created_by_rpc', true, 'is_active', true
    )
  );

  RETURN new_user_id;
END;
$$;

-- Ativar / desativar conta.
CREATE OR REPLACE FUNCTION public.set_supervisor_active(
  p_profile_id UUID,
  p_is_active BOOLEAN
)
  RETURNS VOID
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path = public
AS $$
DECLARE
  previous RECORD;
BEGIN
  IF NOT public.is_active_admin() THEN
    RAISE EXCEPTION 'Acesso negado: somente o administrador pode ativar ou desativar contas.';
  END IF;

  IF p_profile_id = auth.uid() THEN
    RAISE EXCEPTION 'Nao e possivel alterar o status da sua propria conta.';
  END IF;

  SELECT role, is_active INTO previous
  FROM public.profiles
  WHERE id = p_profile_id;

  IF previous IS NULL THEN
    RAISE EXCEPTION 'Conta nao encontrada.';
  END IF;

  IF previous.is_active = p_is_active THEN
    RETURN;
  END IF;

  PERFORM set_config('jamaaw.privilege_change', 'on', true);

  UPDATE public.profiles
  SET is_active = p_is_active,
      updated_at = now()
  WHERE id = p_profile_id;

  PERFORM set_config('jamaaw.privilege_change', 'off', true);

  INSERT INTO public.audit_logs (user_id, action, table_name, record_id, old_data, new_data)
  VALUES (
    auth.uid(), 'UPDATE', 'profiles', p_profile_id,
    jsonb_build_object('is_active', previous.is_active),
    jsonb_build_object('is_active', p_is_active, 'activated_by_rpc', p_is_active)
  );
END;
$$;

-- Promover a admin / rebaixar a supervisor.
CREATE OR REPLACE FUNCTION public.set_supervisor_role(
  p_profile_id UUID,
  p_role TEXT
)
  RETURNS VOID
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path = public
AS $$
DECLARE
  previous_role public.app_role;
BEGIN
  IF NOT public.is_active_admin() THEN
    RAISE EXCEPTION 'Acesso negado: somente o administrador pode alterar papeis.';
  END IF;

  IF p_role NOT IN ('admin', 'supervisor') THEN
    RAISE EXCEPTION 'Papel invalido para conta de login: use admin ou supervisor.';
  END IF;

  SELECT role INTO previous_role
  FROM public.profiles
  WHERE id = p_profile_id;

  IF previous_role IS NULL THEN
    RAISE EXCEPTION 'Conta nao encontrada.';
  END IF;

  IF previous_role::TEXT = p_role THEN
    RETURN;
  END IF;

  -- Rebaixar a si mesmo e permitido, mas o trigger guard_last_admin impede
  -- que isso deixe o almoxarifado sem administrador.
  PERFORM set_config('jamaaw.privilege_change', 'on', true);

  UPDATE public.profiles
  SET role = p_role::public.app_role,
      updated_at = now()
  WHERE id = p_profile_id;

  PERFORM set_config('jamaaw.privilege_change', 'off', true);

  INSERT INTO public.audit_logs (user_id, action, table_name, record_id, old_data, new_data)
  VALUES (
    auth.uid(), 'UPDATE', 'profiles', p_profile_id,
    jsonb_build_object('role', previous_role::TEXT),
    jsonb_build_object('role', p_role, 'role_changed_by_rpc', true)
  );
END;
$$;

-- Redefinir a senha de uma conta.
CREATE OR REPLACE FUNCTION public.reset_supervisor_password(
  p_profile_id UUID,
  p_password TEXT
)
  RETURNS VOID
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path = public
AS $$
BEGIN
  IF NOT public.is_active_admin() THEN
    RAISE EXCEPTION 'Acesso negado: somente o administrador pode redefinir senhas.';
  END IF;

  IF p_password IS NULL OR length(p_password) < 6 THEN
    RAISE EXCEPTION 'Senha deve ter pelo menos 6 caracteres.';
  END IF;

  IF NOT EXISTS (SELECT 1 FROM public.profiles WHERE id = p_profile_id) THEN
    RAISE EXCEPTION 'Conta nao encontrada.';
  END IF;

  UPDATE auth.users
  SET encrypted_password = crypt(p_password, gen_salt('bf')),
      updated_at = now()
  WHERE id = p_profile_id;

  INSERT INTO public.audit_logs (user_id, action, table_name, record_id, old_data, new_data)
  VALUES (
    auth.uid(), 'UPDATE', 'profiles', p_profile_id, NULL,
    jsonb_build_object('password_reset_by_rpc', true)
  );
END;
$$;

-- ---------------------------------------------------------------------------
-- 6. Painel de contas para o admin
-- ---------------------------------------------------------------------------

-- Atividade por conta. SECURITY DEFINER porque le auth.users (e-mail e ultimo
-- acesso) e agrega sobre tabelas que o supervisor nao deve varrer por conta
-- alheia; o proprio corpo exige admin ativo.
CREATE OR REPLACE FUNCTION public.admin_account_overview()
  RETURNS TABLE (
    id UUID,
    full_name TEXT,
    email TEXT,
    employee_id TEXT,
    role TEXT,
    sector TEXT,
    photo_url TEXT,
    is_active BOOLEAN,
    created_at TIMESTAMPTZ,
    last_sign_in_at TIMESTAMPTZ,
    withdrawals_count BIGINT,
    returns_count BIGINT,
    audit_count BIGINT,
    last_action_at TIMESTAMPTZ
  )
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path = public
AS $$
BEGIN
  IF NOT public.is_active_admin() THEN
    RAISE EXCEPTION 'Acesso negado: painel disponivel apenas para o administrador.';
  END IF;

  RETURN QUERY
  SELECT
    p.id,
    p.full_name,
    u.email::TEXT,
    p.employee_id,
    p.role::TEXT,
    p.sector,
    p.photo_url,
    p.is_active,
    p.created_at,
    u.last_sign_in_at,
    COALESCE(w.total, 0) AS withdrawals_count,
    COALESCE(r.total, 0) AS returns_count,
    COALESCE(a.total, 0) AS audit_count,
    a.last_at AS last_action_at
  FROM public.profiles p
  LEFT JOIN auth.users u ON u.id = p.id
  LEFT JOIN (
    -- authorized_by e a conta de login que autorizou a retirada;
    -- requested_by aponta para people, nao serve aqui.
    SELECT authorized_by, count(*) AS total
    FROM public.withdrawals
    WHERE authorized_by IS NOT NULL
    GROUP BY authorized_by
  ) w ON w.authorized_by = p.id
  LEFT JOIN (
    SELECT created_by, count(*) AS total
    FROM public.stock_returns
    WHERE created_by IS NOT NULL
    GROUP BY created_by
  ) r ON r.created_by = p.id
  LEFT JOIN (
    SELECT user_id, count(*) AS total, max(created_at) AS last_at
    FROM public.audit_logs
    WHERE user_id IS NOT NULL
    GROUP BY user_id
  ) a ON a.user_id = p.id
  ORDER BY (p.role = 'admin') DESC, p.is_active DESC, p.full_name;
END;
$$;

-- ---------------------------------------------------------------------------
-- 7. Permissoes de execucao
-- ---------------------------------------------------------------------------

REVOKE ALL ON FUNCTION public.create_supervisor_account(TEXT, TEXT, TEXT, TEXT, TEXT) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.set_supervisor_active(UUID, BOOLEAN) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.set_supervisor_role(UUID, TEXT) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.reset_supervisor_password(UUID, TEXT) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.admin_account_overview() FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.is_active_admin() FROM PUBLIC, anon;

GRANT EXECUTE ON FUNCTION public.create_supervisor_account(TEXT, TEXT, TEXT, TEXT, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.set_supervisor_active(UUID, BOOLEAN) TO authenticated;
GRANT EXECUTE ON FUNCTION public.set_supervisor_role(UUID, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.reset_supervisor_password(UUID, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_account_overview() TO authenticated;
GRANT EXECUTE ON FUNCTION public.is_active_admin() TO authenticated;

COMMIT;
