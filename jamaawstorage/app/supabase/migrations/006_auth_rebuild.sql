-- ============================================================================
-- JAMAAW STORAGE - 006: Auth Rebuild
-- Cleans up conflicting RLS policies, functions, and triggers from
-- migrations 001-005. Idempotent: safe to run multiple times.
-- ============================================================================

-- ============================================================================
-- Phase 0: Enum operations (must be OUTSIDE transaction blocks)
-- ============================================================================
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'app_role') THEN
    CREATE TYPE app_role AS ENUM ('supervisor', 'leader', 'collaborator');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'withdrawal_destination_type') THEN
    CREATE TYPE withdrawal_destination_type AS ENUM ('collaborator', 'work_site');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'withdrawal_status') THEN
    CREATE TYPE withdrawal_status AS ENUM ('pending', 'approved', 'rejected', 'completed');
  END IF;
END $$;

ALTER TYPE withdrawal_status ADD VALUE IF NOT EXISTS 'completed';

-- ============================================================================
-- Phase 1: Transactional cleanup + rebuild
-- ============================================================================
BEGIN;

-- ----------------------------------------------------------------------------
-- 1.1 Ensure tables exist (idempotent)
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS profiles (
  id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  full_name TEXT NOT NULL,
  employee_id TEXT UNIQUE,
  role app_role NOT NULL DEFAULT 'supervisor',
  sector TEXT,
  photo_url TEXT,
  is_active BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE profiles DROP CONSTRAINT IF EXISTS profiles_role_check;
ALTER TABLE profiles ALTER COLUMN is_active SET DEFAULT false;

CREATE TABLE IF NOT EXISTS people (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  full_name TEXT NOT NULL,
  employee_id TEXT NOT NULL UNIQUE,
  role app_role NOT NULL,
  sector TEXT,
  photo_url TEXT,
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_by UUID REFERENCES profiles(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT people_role_check CHECK (role IN ('leader', 'collaborator'))
);

CREATE TABLE IF NOT EXISTS work_sites (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  description TEXT,
  location TEXT,
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_by UUID REFERENCES profiles(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS stock_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  code TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  description TEXT,
  unit TEXT NOT NULL DEFAULT 'un',
  ca_nr TEXT,
  category TEXT,
  svg_icon_key TEXT,
  current_quantity INTEGER NOT NULL DEFAULT 0,
  minimum_quantity INTEGER NOT NULL DEFAULT 0,
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_by UUID REFERENCES profiles(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT stock_items_current_quantity_nonneg CHECK (current_quantity >= 0),
  CONSTRAINT stock_items_minimum_quantity_nonneg CHECK (minimum_quantity >= 0)
);

CREATE TABLE IF NOT EXISTS stock_item_lots (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  stock_item_id UUID NOT NULL REFERENCES stock_items(id) ON DELETE CASCADE,
  lot_code TEXT NOT NULL,
  quantity INTEGER NOT NULL DEFAULT 0,
  expiry_date DATE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT stock_item_lots_quantity_nonneg CHECK (quantity >= 0),
  CONSTRAINT stock_item_lots_unique_lot UNIQUE (stock_item_id, lot_code)
);

CREATE TABLE IF NOT EXISTS kits (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  description TEXT,
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_by UUID REFERENCES profiles(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS kit_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  kit_id UUID NOT NULL REFERENCES kits(id) ON DELETE CASCADE,
  stock_item_id UUID NOT NULL REFERENCES stock_items(id),
  quantity INTEGER NOT NULL DEFAULT 1,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT kit_items_quantity_pos CHECK (quantity > 0),
  CONSTRAINT kit_items_unique_item UNIQUE (kit_id, stock_item_id)
);

CREATE TABLE IF NOT EXISTS withdrawals (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  code TEXT NOT NULL UNIQUE,
  authorized_by UUID NOT NULL REFERENCES profiles(id),
  requested_by UUID NOT NULL REFERENCES people(id),
  destination_type withdrawal_destination_type NOT NULL,
  collaborator_id UUID REFERENCES people(id),
  work_site_id UUID REFERENCES work_sites(id),
  status withdrawal_status NOT NULL DEFAULT 'pending',
  notes TEXT,
  photo_url TEXT,
  supervisor_signature TEXT NOT NULL,
  requester_signature TEXT NOT NULL,
  witness_signature TEXT,
  withdrawn_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT withdrawals_destination_check CHECK (
    (destination_type = 'collaborator' AND collaborator_id IS NOT NULL)
    OR
    (destination_type = 'work_site' AND work_site_id IS NOT NULL)
  )
);

CREATE TABLE IF NOT EXISTS withdrawal_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  withdrawal_id UUID NOT NULL REFERENCES withdrawals(id) ON DELETE CASCADE,
  stock_item_id UUID NOT NULL REFERENCES stock_items(id),
  lot_id UUID REFERENCES stock_item_lots(id),
  quantity INTEGER NOT NULL,
  unit TEXT NOT NULL DEFAULT 'un',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT withdrawal_items_quantity_pos CHECK (quantity > 0)
);

CREATE TABLE IF NOT EXISTS person_inventories (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  person_id UUID NOT NULL REFERENCES people(id) ON DELETE CASCADE,
  stock_item_id UUID NOT NULL REFERENCES stock_items(id),
  quantity INTEGER NOT NULL DEFAULT 0,
  last_withdrawal_id UUID REFERENCES withdrawals(id),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT person_inventories_quantity_nonneg CHECK (quantity >= 0),
  CONSTRAINT person_inventories_unique_item UNIQUE (person_id, stock_item_id)
);

CREATE TABLE IF NOT EXISTS audit_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES profiles(id),
  action TEXT NOT NULL,
  table_name TEXT NOT NULL,
  record_id UUID,
  old_data JSONB,
  new_data JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT audit_logs_action_check CHECK (action IN ('INSERT', 'UPDATE', 'DELETE'))
);

-- ----------------------------------------------------------------------------
-- 1.2 Enable RLS on all public tables
-- ----------------------------------------------------------------------------
DO $$ DECLARE tbl_name TEXT;
BEGIN
  FOR tbl_name IN SELECT tablename FROM pg_tables WHERE schemaname = 'public' LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', tbl_name);
  END LOOP;
END $$;

-- ----------------------------------------------------------------------------
-- 1.3 DROP ALL existing RLS policies from ALL public tables (dynamic loop)
-- ----------------------------------------------------------------------------
DO $$ DECLARE pol RECORD;
BEGIN
  FOR pol IN SELECT policyname, tablename FROM pg_policies WHERE schemaname = 'public' LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', pol.policyname, pol.tablename);
  END LOOP;
END $$;

-- ----------------------------------------------------------------------------
-- 1.4 Recreate is_active_supervisor() function
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.is_active_supervisor()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.profiles
    WHERE id = auth.uid()
      AND role = 'supervisor'
      AND is_active = true
  );
$$;

COMMENT ON FUNCTION public.is_active_supervisor() IS 'Returns true when the current auth user has an active supervisor profile. Used in RLS policies.';

-- ----------------------------------------------------------------------------
-- 1.5 Create clean RLS policies
-- ----------------------------------------------------------------------------

-- profiles: SELECT (own row OR is_active_supervisor)
CREATE POLICY "profiles_select_own_or_supervisor" ON profiles
  FOR SELECT TO authenticated
  USING (id = auth.uid() OR public.is_active_supervisor());

-- profiles: INSERT only for is_active_supervisor AND must be own id
CREATE POLICY "profiles_insert_supervisor_own" ON profiles
  FOR INSERT TO authenticated
  WITH CHECK (id = auth.uid() AND public.is_active_supervisor());

-- profiles: UPDATE own row AND is_active_supervisor (WITH CHECK also enforces supervisor)
CREATE POLICY "profiles_update_supervisor_own" ON profiles
FOR UPDATE TO authenticated
USING (id = auth.uid() AND public.is_active_supervisor())
WITH CHECK (id = auth.uid() AND public.is_active_supervisor());

-- people: full CRUD for active supervisors only
CREATE POLICY "people_select_supervisor" ON people
  FOR SELECT TO authenticated
  USING (public.is_active_supervisor());

CREATE POLICY "people_insert_supervisor" ON people
  FOR INSERT TO authenticated
  WITH CHECK (public.is_active_supervisor());

CREATE POLICY "people_update_supervisor" ON people
  FOR UPDATE TO authenticated
  USING (public.is_active_supervisor())
  WITH CHECK (public.is_active_supervisor());

CREATE POLICY "people_delete_supervisor" ON people
  FOR DELETE TO authenticated
  USING (public.is_active_supervisor());

-- work_sites: full CRUD for active supervisors only
CREATE POLICY "work_sites_select_supervisor" ON work_sites
  FOR SELECT TO authenticated
  USING (public.is_active_supervisor());

CREATE POLICY "work_sites_insert_supervisor" ON work_sites
  FOR INSERT TO authenticated
  WITH CHECK (public.is_active_supervisor());

CREATE POLICY "work_sites_update_supervisor" ON work_sites
  FOR UPDATE TO authenticated
  USING (public.is_active_supervisor())
  WITH CHECK (public.is_active_supervisor());

CREATE POLICY "work_sites_delete_supervisor" ON work_sites
  FOR DELETE TO authenticated
  USING (public.is_active_supervisor());

-- stock_items: full CRUD for active supervisors only
CREATE POLICY "stock_items_select_supervisor" ON stock_items
  FOR SELECT TO authenticated
  USING (public.is_active_supervisor());

CREATE POLICY "stock_items_insert_supervisor" ON stock_items
  FOR INSERT TO authenticated
  WITH CHECK (public.is_active_supervisor());

CREATE POLICY "stock_items_update_supervisor" ON stock_items
  FOR UPDATE TO authenticated
  USING (public.is_active_supervisor())
  WITH CHECK (public.is_active_supervisor());

CREATE POLICY "stock_items_delete_supervisor" ON stock_items
  FOR DELETE TO authenticated
  USING (public.is_active_supervisor());

-- stock_item_lots: full CRUD for active supervisors only
CREATE POLICY "stock_item_lots_select_supervisor" ON stock_item_lots
  FOR SELECT TO authenticated
  USING (public.is_active_supervisor());

CREATE POLICY "stock_item_lots_insert_supervisor" ON stock_item_lots
  FOR INSERT TO authenticated
  WITH CHECK (public.is_active_supervisor());

CREATE POLICY "stock_item_lots_update_supervisor" ON stock_item_lots
  FOR UPDATE TO authenticated
  USING (public.is_active_supervisor())
  WITH CHECK (public.is_active_supervisor());

CREATE POLICY "stock_item_lots_delete_supervisor" ON stock_item_lots
  FOR DELETE TO authenticated
  USING (public.is_active_supervisor());

-- kits: full CRUD for active supervisors only
CREATE POLICY "kits_select_supervisor" ON kits
  FOR SELECT TO authenticated
  USING (public.is_active_supervisor());

CREATE POLICY "kits_insert_supervisor" ON kits
  FOR INSERT TO authenticated
  WITH CHECK (public.is_active_supervisor());

CREATE POLICY "kits_update_supervisor" ON kits
  FOR UPDATE TO authenticated
  USING (public.is_active_supervisor())
  WITH CHECK (public.is_active_supervisor());

CREATE POLICY "kits_delete_supervisor" ON kits
  FOR DELETE TO authenticated
  USING (public.is_active_supervisor());

-- kit_items: full CRUD for active supervisors only
CREATE POLICY "kit_items_select_supervisor" ON kit_items
  FOR SELECT TO authenticated
  USING (public.is_active_supervisor());

CREATE POLICY "kit_items_insert_supervisor" ON kit_items
  FOR INSERT TO authenticated
  WITH CHECK (public.is_active_supervisor());

CREATE POLICY "kit_items_update_supervisor" ON kit_items
  FOR UPDATE TO authenticated
  USING (public.is_active_supervisor())
  WITH CHECK (public.is_active_supervisor());

CREATE POLICY "kit_items_delete_supervisor" ON kit_items
  FOR DELETE TO authenticated
  USING (public.is_active_supervisor());

-- withdrawals: full CRUD for active supervisors only
CREATE POLICY "withdrawals_select_supervisor" ON withdrawals
  FOR SELECT TO authenticated
  USING (public.is_active_supervisor());

CREATE POLICY "withdrawals_insert_supervisor" ON withdrawals
  FOR INSERT TO authenticated
  WITH CHECK (public.is_active_supervisor());

CREATE POLICY "withdrawals_update_supervisor" ON withdrawals
  FOR UPDATE TO authenticated
  USING (public.is_active_supervisor())
  WITH CHECK (public.is_active_supervisor());

CREATE POLICY "withdrawals_delete_supervisor" ON withdrawals
  FOR DELETE TO authenticated
  USING (public.is_active_supervisor());

-- withdrawal_items: full CRUD for active supervisors only
CREATE POLICY "withdrawal_items_select_supervisor" ON withdrawal_items
  FOR SELECT TO authenticated
  USING (public.is_active_supervisor());

CREATE POLICY "withdrawal_items_insert_supervisor" ON withdrawal_items
  FOR INSERT TO authenticated
  WITH CHECK (public.is_active_supervisor());

CREATE POLICY "withdrawal_items_update_supervisor" ON withdrawal_items
  FOR UPDATE TO authenticated
  USING (public.is_active_supervisor())
  WITH CHECK (public.is_active_supervisor());

CREATE POLICY "withdrawal_items_delete_supervisor" ON withdrawal_items
  FOR DELETE TO authenticated
  USING (public.is_active_supervisor());

-- person_inventories: full CRUD for active supervisors only
CREATE POLICY "person_inventories_select_supervisor" ON person_inventories
  FOR SELECT TO authenticated
  USING (public.is_active_supervisor());

CREATE POLICY "person_inventories_insert_supervisor" ON person_inventories
  FOR INSERT TO authenticated
  WITH CHECK (public.is_active_supervisor());

CREATE POLICY "person_inventories_update_supervisor" ON person_inventories
  FOR UPDATE TO authenticated
  USING (public.is_active_supervisor())
  WITH CHECK (public.is_active_supervisor());

CREATE POLICY "person_inventories_delete_supervisor" ON person_inventories
  FOR DELETE TO authenticated
  USING (public.is_active_supervisor());

-- audit_logs: SELECT for is_active_supervisor, INSERT only under own identity
CREATE POLICY "audit_logs_select_supervisor" ON audit_logs
FOR SELECT TO authenticated
USING (public.is_active_supervisor());

CREATE POLICY "audit_logs_insert_own" ON audit_logs
FOR INSERT TO authenticated
WITH CHECK (user_id = auth.uid());

-- ----------------------------------------------------------------------------
-- 1.6 Recreate create_supervisor_account() — SAFE columns only
-- ----------------------------------------------------------------------------
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
  IF NOT public.is_active_supervisor() THEN
    RAISE EXCEPTION 'Acesso negado: somente supervisores ativos podem criar novas contas.';
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

  INSERT INTO auth.users (
    id,
    aud,
    role,
    email,
    encrypted_password,
    email_confirmed_at,
    raw_app_meta_data,
    raw_user_meta_data,
    created_at,
    updated_at
  ) VALUES (
    gen_random_uuid(),
    'authenticated',
    'authenticated',
    lower(trim(p_email)),
    crypt(p_password, gen_salt('bf')),
    now(),
    '{"provider":"email","providers":["email"]}',
    jsonb_build_object('full_name', p_full_name, 'employee_id', p_employee_id),
    now(),
    now()
  ) RETURNING id INTO new_user_id;

  INSERT INTO public.profiles (id, full_name, employee_id, role, sector, is_active)
  VALUES (new_user_id, p_full_name, p_employee_id, 'supervisor', p_sector, true);

  INSERT INTO public.audit_logs (user_id, action, table_name, record_id, old_data, new_data)
  VALUES (
    auth.uid(), 'INSERT', 'profiles', new_user_id, NULL,
    jsonb_build_object('id', new_user_id, 'full_name', p_full_name, 'role', 'supervisor', 'created_by_rpc', true)
  );

  RETURN new_user_id;
END;
$$;

COMMENT ON FUNCTION public.create_supervisor_account(TEXT, TEXT, TEXT, TEXT, TEXT)
  IS 'RPC: creates a new supervisor account (auth.user + profile). Only callable by active supervisors. Uses SECURITY DEFINER.';

-- ----------------------------------------------------------------------------
-- 1.7 Recreate all utility functions
-- ----------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE SEQUENCE IF NOT EXISTS withdrawal_code_seq START 1;

CREATE OR REPLACE FUNCTION generate_withdrawal_code()
RETURNS TRIGGER AS $$
DECLARE
  today_code TEXT;
  next_seq INTEGER;
BEGIN
  today_code := 'RET-' || to_char(now(), 'YYYYMMDD');

  SELECT COALESCE(MAX(
    CAST(SUBSTRING(w.code FROM LENGTH(today_code) + 2) AS INTEGER)
  ), 0) + 1 INTO next_seq
  FROM withdrawals w
  WHERE w.code LIKE today_code || '-%'
  FOR UPDATE SKIP LOCKED;

  NEW.code := today_code || '-' || LPAD(next_seq::TEXT, 3, '0');
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION handle_stock_deduction()
RETURNS TRIGGER AS $$
DECLARE
  w_dest_type withdrawal_destination_type;
  w_collab_id UUID;
  w_status withdrawal_status;
  new_qty INTEGER;
BEGIN
  SELECT destination_type, collaborator_id, status
  INTO w_dest_type, w_collab_id, w_status
  FROM withdrawals
  WHERE id = NEW.withdrawal_id;

  IF w_status = 'rejected' THEN
    RETURN NEW;
  END IF;

  UPDATE stock_items
  SET current_quantity = current_quantity - NEW.quantity
  WHERE id = NEW.stock_item_id
    AND current_quantity >= NEW.quantity
  RETURNING current_quantity INTO new_qty;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Insufficient stock for item %. Requested: %',
      NEW.stock_item_id, NEW.quantity;
  END IF;

  IF NEW.lot_id IS NOT NULL THEN
    UPDATE stock_item_lots
    SET quantity = quantity - NEW.quantity
    WHERE id = NEW.lot_id;
  END IF;

  IF w_dest_type = 'collaborator' AND w_collab_id IS NOT NULL THEN
    INSERT INTO person_inventories (person_id, stock_item_id, quantity, last_withdrawal_id)
    VALUES (w_collab_id, NEW.stock_item_id, NEW.quantity, NEW.withdrawal_id)
    ON CONFLICT (person_id, stock_item_id) DO UPDATE
    SET quantity = person_inventories.quantity + EXCLUDED.quantity,
        last_withdrawal_id = EXCLUDED.last_withdrawal_id,
        updated_at = now();
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION handle_stock_restoration()
RETURNS TRIGGER AS $$
BEGIN
  IF OLD.status = NEW.status THEN
    RETURN NEW;
  END IF;

  IF NEW.status = 'rejected' AND OLD.status <> 'rejected' THEN
    -- Restore stock_items in batch
    UPDATE stock_items si
    SET current_quantity = si.current_quantity + wi.quantity
    FROM withdrawal_items wi
    WHERE wi.withdrawal_id = NEW.id
      AND si.id = wi.stock_item_id;

    -- Restore lots in batch
    UPDATE stock_item_lots sil
    SET quantity = sil.quantity + wi.quantity
    FROM withdrawal_items wi
    WHERE wi.withdrawal_id = NEW.id
      AND sil.id = wi.lot_id;

    -- Restore person inventories in batch
    UPDATE person_inventories pi
    SET quantity = GREATEST(pi.quantity - wi.quantity, 0),
        updated_at = now()
    FROM withdrawal_items wi
    JOIN withdrawals w ON w.id = wi.withdrawal_id
    WHERE wi.withdrawal_id = NEW.id
      AND pi.person_id = w.collaborator_id
      AND pi.stock_item_id = wi.stock_item_id;

    -- Delete zeroed inventories
    DELETE FROM person_inventories pi
    WHERE pi.quantity = 0
      AND EXISTS (
        SELECT 1 FROM withdrawal_items wi
        JOIN withdrawals w ON w.id = wi.withdrawal_id
        WHERE wi.withdrawal_id = NEW.id
          AND pi.person_id = w.collaborator_id
          AND pi.stock_item_id = wi.stock_item_id
      );
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION log_audit()
RETURNS TRIGGER AS $$
DECLARE
  audit_user_id UUID;
BEGIN
  audit_user_id := auth.uid();

  IF TG_OP = 'INSERT' THEN
    INSERT INTO audit_logs (user_id, action, table_name, record_id, old_data, new_data)
    VALUES (audit_user_id, 'INSERT', TG_TABLE_NAME, NEW.id, NULL, to_jsonb(NEW));
    RETURN NEW;
  ELSIF TG_OP = 'UPDATE' THEN
    INSERT INTO audit_logs (user_id, action, table_name, record_id, old_data, new_data)
    VALUES (audit_user_id, 'UPDATE', TG_TABLE_NAME, NEW.id, to_jsonb(OLD), to_jsonb(NEW));
    RETURN NEW;
  ELSIF TG_OP = 'DELETE' THEN
    INSERT INTO audit_logs (user_id, action, table_name, record_id, old_data, new_data)
    VALUES (audit_user_id, 'DELETE', TG_TABLE_NAME, OLD.id, to_jsonb(OLD), NULL);
    RETURN OLD;
  END IF;

  RETURN COALESCE(NEW, OLD);
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION check_low_stock()
RETURNS SETOF stock_items AS $$
BEGIN
  RETURN QUERY
  SELECT *
  FROM stock_items
  WHERE current_quantity <= minimum_quantity
    AND minimum_quantity > 0
    AND is_active = true;
END;
$$ LANGUAGE plpgsql STABLE;

-- ----------------------------------------------------------------------------
-- 1.8 handle_new_user() — SAFE auto-profile creation
-- When a user signs up via supabase.auth.signUp(), this trigger creates a
-- profile row with is_active = false. The user cannot access any data
-- until a supervisor activates their account via activate_supervisor_profile().
-- This is SAFE because inactive users pass no RLS policy checks.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO public.profiles (id, full_name, role, is_active)
  VALUES (
    NEW.id,
    COALESCE(NEW.raw_user_meta_data->>'full_name', NEW.email, 'Sem nome'),
    'supervisor',
    false
  );
  RETURN NEW;
EXCEPTION WHEN others THEN
  RETURN NEW;
END;
$$;

COMMENT ON FUNCTION public.handle_new_user() IS 'Trigger: auto-creates an INACTIVE supervisor profile on auth.users insert. Safe because is_active=false blocks all RLS access. Activation requires activate_supervisor_profile() RPC.';

-- ----------------------------------------------------------------------------
-- 1.8b activate_supervisor_profile() — RPC for supervisors to activate users
-- Only active supervisors can call this. It updates the profile to set
-- is_active = true, full_name, employee_id, and sector.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.activate_supervisor_profile(
  p_user_id UUID,
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
  target_id UUID;
BEGIN
  IF NOT public.is_active_supervisor() THEN
    RAISE EXCEPTION 'Acesso negado: somente supervisores ativos podem ativar contas.';
  END IF;

  IF p_user_id IS NULL THEN
    RAISE EXCEPTION 'ID do usuario e obrigatorio.';
  END IF;

  IF p_full_name IS NULL OR trim(p_full_name) = '' THEN
    RAISE EXCEPTION 'Nome completo e obrigatorio.';
  END IF;

  UPDATE public.profiles
  SET
    full_name = p_full_name,
    employee_id = p_employee_id,
    sector = p_sector,
    is_active = true,
    updated_at = now()
  WHERE id = p_user_id
  RETURNING id INTO target_id;

  IF target_id IS NULL THEN
    RAISE EXCEPTION 'Perfil nao encontrado para o usuario informado.';
  END IF;

  INSERT INTO public.audit_logs (user_id, action, table_name, record_id, old_data, new_data)
  VALUES (
    auth.uid(), 'UPDATE', 'profiles', target_id,
    jsonb_build_object('is_active', false),
    jsonb_build_object('id', target_id, 'full_name', p_full_name, 'role', 'supervisor', 'is_active', true, 'activated_by_rpc', true)
  );

  RETURN target_id;
END;
$$;

COMMENT ON FUNCTION public.activate_supervisor_profile(UUID, TEXT, TEXT, TEXT)
IS 'RPC: activates an existing supervisor profile. Only callable by active supervisors. Uses SECURITY DEFINER.';

-- ----------------------------------------------------------------------------
-- 1.9 Recreate all triggers (DROP IF EXISTS + CREATE for idempotency)
-- ----------------------------------------------------------------------------

-- updated_at triggers
DROP TRIGGER IF EXISTS trg_profiles_updated_at ON profiles;
CREATE TRIGGER trg_profiles_updated_at
  BEFORE UPDATE ON profiles FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

DROP TRIGGER IF EXISTS trg_people_updated_at ON people;
CREATE TRIGGER trg_people_updated_at
  BEFORE UPDATE ON people FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

DROP TRIGGER IF EXISTS trg_work_sites_updated_at ON work_sites;
CREATE TRIGGER trg_work_sites_updated_at
  BEFORE UPDATE ON work_sites FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

DROP TRIGGER IF EXISTS trg_stock_items_updated_at ON stock_items;
CREATE TRIGGER trg_stock_items_updated_at
  BEFORE UPDATE ON stock_items FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

DROP TRIGGER IF EXISTS trg_stock_item_lots_updated_at ON stock_item_lots;
CREATE TRIGGER trg_stock_item_lots_updated_at
  BEFORE UPDATE ON stock_item_lots FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

DROP TRIGGER IF EXISTS trg_kits_updated_at ON kits;
CREATE TRIGGER trg_kits_updated_at
  BEFORE UPDATE ON kits FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

DROP TRIGGER IF EXISTS trg_withdrawals_updated_at ON withdrawals;
CREATE TRIGGER trg_withdrawals_updated_at
  BEFORE UPDATE ON withdrawals FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

DROP TRIGGER IF EXISTS trg_person_inventories_updated_at ON person_inventories;
CREATE TRIGGER trg_person_inventories_updated_at
  BEFORE UPDATE ON person_inventories FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

-- Withdrawal code generation trigger
DROP TRIGGER IF EXISTS trg_withdrawals_generate_code ON withdrawals;
CREATE TRIGGER trg_withdrawals_generate_code
  BEFORE INSERT ON withdrawals FOR EACH ROW
  EXECUTE FUNCTION generate_withdrawal_code();

-- Stock deduction trigger
DROP TRIGGER IF EXISTS trg_withdrawal_items_stock_deduction ON withdrawal_items;
CREATE TRIGGER trg_withdrawal_items_stock_deduction
  AFTER INSERT ON withdrawal_items FOR EACH ROW
  EXECUTE FUNCTION handle_stock_deduction();

-- Stock restoration trigger
DROP TRIGGER IF EXISTS trg_withdrawals_stock_restoration ON withdrawals;
CREATE TRIGGER trg_withdrawals_stock_restoration
  AFTER UPDATE ON withdrawals FOR EACH ROW
  EXECUTE FUNCTION handle_stock_restoration();

-- Audit triggers
DROP TRIGGER IF EXISTS trg_profiles_audit ON profiles;
CREATE TRIGGER trg_profiles_audit
  AFTER INSERT OR UPDATE OR DELETE ON profiles FOR EACH ROW
  EXECUTE FUNCTION log_audit();

DROP TRIGGER IF EXISTS trg_people_audit ON people;
CREATE TRIGGER trg_people_audit
  AFTER INSERT OR UPDATE OR DELETE ON people FOR EACH ROW
  EXECUTE FUNCTION log_audit();

DROP TRIGGER IF EXISTS trg_work_sites_audit ON work_sites;
CREATE TRIGGER trg_work_sites_audit
  AFTER INSERT OR UPDATE OR DELETE ON work_sites FOR EACH ROW
  EXECUTE FUNCTION log_audit();

DROP TRIGGER IF EXISTS trg_stock_items_audit ON stock_items;
CREATE TRIGGER trg_stock_items_audit
  AFTER INSERT OR UPDATE OR DELETE ON stock_items FOR EACH ROW
  EXECUTE FUNCTION log_audit();

DROP TRIGGER IF EXISTS trg_stock_item_lots_audit ON stock_item_lots;
CREATE TRIGGER trg_stock_item_lots_audit
  AFTER INSERT OR UPDATE OR DELETE ON stock_item_lots FOR EACH ROW
  EXECUTE FUNCTION log_audit();

DROP TRIGGER IF EXISTS trg_kits_audit ON kits;
CREATE TRIGGER trg_kits_audit
  AFTER INSERT OR UPDATE OR DELETE ON kits FOR EACH ROW
  EXECUTE FUNCTION log_audit();

DROP TRIGGER IF EXISTS trg_kit_items_audit ON kit_items;
CREATE TRIGGER trg_kit_items_audit
  AFTER INSERT OR UPDATE OR DELETE ON kit_items FOR EACH ROW
  EXECUTE FUNCTION log_audit();

DROP TRIGGER IF EXISTS trg_withdrawals_audit ON withdrawals;
CREATE TRIGGER trg_withdrawals_audit
  AFTER INSERT OR UPDATE OR DELETE ON withdrawals FOR EACH ROW
  EXECUTE FUNCTION log_audit();

DROP TRIGGER IF EXISTS trg_withdrawal_items_audit ON withdrawal_items;
CREATE TRIGGER trg_withdrawal_items_audit
  AFTER INSERT OR UPDATE OR DELETE ON withdrawal_items FOR EACH ROW
  EXECUTE FUNCTION log_audit();

DROP TRIGGER IF EXISTS trg_person_inventories_audit ON person_inventories;
CREATE TRIGGER trg_person_inventories_audit
  AFTER INSERT OR UPDATE OR DELETE ON person_inventories FOR EACH ROW
  EXECUTE FUNCTION log_audit();

-- ----------------------------------------------------------------------------
-- 1.10 Indexes (idempotent)
-- ----------------------------------------------------------------------------
CREATE INDEX IF NOT EXISTS idx_people_role ON people(role);
CREATE INDEX IF NOT EXISTS idx_people_is_active ON people(is_active);
CREATE INDEX IF NOT EXISTS idx_profiles_is_active ON profiles(is_active) WHERE is_active = true;
CREATE INDEX IF NOT EXISTS idx_profiles_auth_check ON profiles(id, role, is_active) WHERE is_active = true AND role = 'supervisor';
CREATE INDEX IF NOT EXISTS idx_stock_items_code ON stock_items(code);
CREATE INDEX IF NOT EXISTS idx_stock_items_category ON stock_items(category);
CREATE INDEX IF NOT EXISTS idx_stock_items_current_quantity ON stock_items(current_quantity);
CREATE INDEX IF NOT EXISTS idx_stock_items_name_trgm ON stock_items USING gin (name gin_trgm_ops);
CREATE INDEX IF NOT EXISTS idx_stock_items_name_lower ON stock_items(lower(name));
CREATE INDEX IF NOT EXISTS idx_stock_items_code_lower ON stock_items(lower(code));
CREATE INDEX IF NOT EXISTS idx_stock_items_active_name ON stock_items(is_active, name);
CREATE INDEX IF NOT EXISTS idx_people_created_by ON people(created_by);
CREATE INDEX IF NOT EXISTS idx_work_sites_created_by ON work_sites(created_by);
CREATE INDEX IF NOT EXISTS idx_stock_items_created_by ON stock_items(created_by);
CREATE INDEX IF NOT EXISTS idx_kits_created_by ON kits(created_by);
CREATE INDEX IF NOT EXISTS idx_person_inventories_last_withdrawal ON person_inventories(last_withdrawal_id);
CREATE INDEX IF NOT EXISTS idx_audit_logs_record_id ON audit_logs(record_id);
CREATE INDEX IF NOT EXISTS idx_withdrawals_authorized_by ON withdrawals(authorized_by);
CREATE INDEX IF NOT EXISTS idx_withdrawals_requested_by ON withdrawals(requested_by);
CREATE INDEX IF NOT EXISTS idx_withdrawals_status ON withdrawals(status);
CREATE INDEX IF NOT EXISTS idx_withdrawals_destination_type ON withdrawals(destination_type);
CREATE INDEX IF NOT EXISTS idx_withdrawals_collaborator_id ON withdrawals(collaborator_id);
CREATE INDEX IF NOT EXISTS idx_withdrawals_work_site_id ON withdrawals(work_site_id);
CREATE INDEX IF NOT EXISTS idx_withdrawals_withdrawn_at ON withdrawals(withdrawn_at);
CREATE INDEX IF NOT EXISTS idx_withdrawals_status_date ON withdrawals(status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_withdrawals_code_pattern ON withdrawals(code text_pattern_ops);
CREATE INDEX IF NOT EXISTS idx_withdrawal_items_withdrawal_id ON withdrawal_items(withdrawal_id);
CREATE INDEX IF NOT EXISTS idx_withdrawal_items_stock_item_id ON withdrawal_items(stock_item_id);
CREATE INDEX IF NOT EXISTS idx_withdrawal_items_lot_id ON withdrawal_items(lot_id);
CREATE INDEX IF NOT EXISTS idx_withdrawal_items_created_at ON withdrawal_items(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_person_inventories_person_id ON person_inventories(person_id);
CREATE INDEX IF NOT EXISTS idx_person_inventories_stock_item_id ON person_inventories(stock_item_id);
CREATE INDEX IF NOT EXISTS idx_kit_items_kit_id ON kit_items(kit_id);
CREATE INDEX IF NOT EXISTS idx_kit_items_stock_item_id ON kit_items(stock_item_id);
CREATE INDEX IF NOT EXISTS idx_audit_logs_user_id ON audit_logs(user_id);
CREATE INDEX IF NOT EXISTS idx_audit_logs_table_name ON audit_logs(table_name);
CREATE INDEX IF NOT EXISTS idx_audit_logs_created_at ON audit_logs(created_at);
CREATE INDEX IF NOT EXISTS idx_audit_logs_table_created ON audit_logs(table_name, created_at DESC);

-- ----------------------------------------------------------------------------
-- 1.11 Grants
-- ----------------------------------------------------------------------------
GRANT USAGE ON SCHEMA public TO anon, authenticated, service_role;

GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public
  TO authenticated, service_role;

GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public
  TO authenticated, service_role;

GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA public
  TO authenticated, service_role;

ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO authenticated, service_role;

ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT USAGE, SELECT ON SEQUENCES TO authenticated, service_role;

ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT EXECUTE ON FUNCTIONS TO authenticated, service_role;

GRANT EXECUTE ON FUNCTION public.activate_supervisor_profile(UUID, TEXT, TEXT, TEXT) TO authenticated;

COMMIT;

-- ============================================================================
-- Phase 2: OUTSIDE transaction — create trigger on auth.users
-- Supabase does not allow triggers on auth.users inside transaction blocks.
-- The handle_new_user() function was created inside the transaction above;
-- this step only attaches it as a trigger.
-- ============================================================================
DROP TRIGGER IF EXISTS trg_auth_user_created ON auth.users;
CREATE TRIGGER trg_auth_user_created
AFTER INSERT ON auth.users
FOR EACH ROW
EXECUTE FUNCTION public.handle_new_user();

-- ============================================================================
-- Phase 3: SEED — EXECUTE SEPARATELY IF DATABASE IS EMPTY
-- ============================================================================
-- When the database has NO supervisor accounts, is_active_supervisor()
-- returns false for everyone, making activate_supervisor_profile() unusable.
-- For the VERY FIRST admin, use the Supabase Dashboard:
--   1. Authentication > Users > Add User (mark "Auto Confirm User")
--   2. Then run the UPDATE below in the SQL Editor to activate the profile.
--
-- The handle_new_user() trigger auto-creates the profile as is_active=false
-- when you add the user via Dashboard. You just need to activate it:
-- ============================================================================

/*
UPDATE public.profiles
SET
  full_name = '<NOME_COMPLETO>',
  employee_id = '<MATRICULA>',
  sector = 'Almoxarifado',
  is_active = true
WHERE id = (SELECT id FROM auth.users WHERE email = '<SEU_EMAIL_AQUI>');
*/
