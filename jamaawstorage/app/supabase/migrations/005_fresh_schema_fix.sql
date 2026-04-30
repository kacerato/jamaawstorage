-- ============================================================================
-- JAMAAW STORAGE - 005: Fresh Schema Fix (REVISED)
-- Limpe TODO o seu SQL Editor antes de colar este código.
-- ============================================================================

-- Phase 0: Enum operations (Outside transaction)
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_type t WHERE t.typname = 'app_role') THEN
        CREATE TYPE app_role AS ENUM ('supervisor', 'leader', 'collaborator');
    END IF;

    IF NOT EXISTS (SELECT 1 FROM pg_type t WHERE t.typname = 'withdrawal_destination_type') THEN
        CREATE TYPE withdrawal_destination_type AS ENUM ('collaborator', 'work_site');
    END IF;

    IF NOT EXISTS (SELECT 1 FROM pg_type t WHERE t.typname = 'withdrawal_status') THEN
        CREATE TYPE withdrawal_status AS ENUM ('pending', 'approved', 'rejected', 'completed');
    END IF;
END
$$;

ALTER TYPE withdrawal_status ADD VALUE IF NOT EXISTS 'completed';

BEGIN;

-- 1. Extensions
CREATE EXTENSION IF NOT EXISTS pg_trgm;
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- 2. Tables
CREATE TABLE IF NOT EXISTS profiles (
    id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
    full_name TEXT NOT NULL,
    employee_id TEXT UNIQUE,
    role app_role NOT NULL DEFAULT 'supervisor',
    sector TEXT,
    photo_url TEXT,
    is_active BOOLEAN NOT NULL DEFAULT true,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT profiles_role_check CHECK (role = 'supervisor')
);

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

-- 3. Indexes
CREATE INDEX IF NOT EXISTS idx_people_role ON people(role);
CREATE INDEX IF NOT EXISTS idx_stock_items_code ON stock_items(code);
CREATE INDEX IF NOT EXISTS idx_withdrawals_status ON withdrawals(status);
CREATE INDEX IF NOT EXISTS idx_profiles_is_active ON profiles(is_active) WHERE is_active = true;

-- 4. is_active_supervisor function (Must exist for RLS)
CREATE OR REPLACE FUNCTION public.is_active_supervisor()
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
SELECT EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND role = 'supervisor' AND is_active = true);
$$;

-- 5. RLS
DO $$
DECLARE
    tbl_name TEXT;
BEGIN
    FOR tbl_name IN SELECT tablename FROM pg_tables WHERE schemaname = 'public' LOOP
        EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', tbl_name);
    END LOOP;
END $$;

DO $$
DECLARE
    pol RECORD;
BEGIN
    FOR pol IN SELECT policyname, tablename FROM pg_policies WHERE schemaname = 'public' LOOP
        EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', pol.policyname, pol.tablename);
    END LOOP;
END $$;

-- Policies (Simplified)
CREATE POLICY "profiles_select_own_or_supervisor" ON profiles FOR SELECT TO authenticated USING (id = auth.uid() OR public.is_active_supervisor());
CREATE POLICY "profiles_update_supervisor_own" ON profiles FOR UPDATE TO authenticated USING (id = auth.uid() AND public.is_active_supervisor()) WITH CHECK (id = auth.uid());
-- Allow authenticated to select most tables if they are active supervisor
DO $$
DECLARE
    tbl_name TEXT;
BEGIN
    FOR tbl_name IN SELECT tablename FROM pg_tables WHERE schemaname = 'public' AND tablename != 'profiles' AND tablename != 'audit_logs' LOOP
        EXECUTE format('CREATE POLICY %I_select_supervisor ON public.%I FOR SELECT TO authenticated USING (public.is_active_supervisor())', tbl_name, tbl_name);
        EXECUTE format('CREATE POLICY %I_insert_supervisor ON public.%I FOR INSERT TO authenticated WITH CHECK (public.is_active_supervisor())', tbl_name, tbl_name);
        EXECUTE format('CREATE POLICY %I_update_supervisor ON public.%I FOR UPDATE TO authenticated USING (public.is_active_supervisor()) WITH CHECK (public.is_active_supervisor())', tbl_name, tbl_name);
        EXECUTE format('CREATE POLICY %I_delete_supervisor ON public.%I FOR DELETE TO authenticated USING (public.is_active_supervisor())', tbl_name, tbl_name);
    END LOOP;
END $$;

CREATE POLICY "audit_logs_select_supervisor" ON audit_logs FOR SELECT TO authenticated USING (public.is_active_supervisor());
CREATE POLICY "audit_logs_insert_system" ON audit_logs FOR INSERT TO authenticated WITH CHECK (true);

-- 6. Functions & Triggers
CREATE OR REPLACE FUNCTION update_updated_at_column() RETURNS TRIGGER AS $$ BEGIN NEW.updated_at = now(); RETURN NEW; END; $$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION public.create_supervisor_account(
    p_email TEXT, p_password TEXT, p_full_name TEXT, p_employee_id TEXT DEFAULT NULL, p_sector TEXT DEFAULT NULL
) RETURNS UUID LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
    new_user_id UUID;
BEGIN
    IF NOT public.is_active_supervisor() THEN RAISE EXCEPTION 'Acesso negado.'; END IF;

    INSERT INTO auth.users (
        id, aud, role, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at
    ) VALUES (
        gen_random_uuid(), 'authenticated', 'authenticated', lower(trim(p_email)), crypt(p_password, gen_salt('bf')), now(), '{"provider":"email","providers":["email"]}', jsonb_build_object('full_name', p_full_name, 'employee_id', p_employee_id), now(), now()
    ) RETURNING id INTO new_user_id;

    INSERT INTO public.profiles (id, full_name, employee_id, role, sector, is_active)
    VALUES (new_user_id, p_full_name, p_employee_id, 'supervisor', p_sector, true);

    RETURN new_user_id;
END; $$;

COMMENT ON FUNCTION public.create_supervisor_account(TEXT, TEXT, TEXT, TEXT, TEXT) IS 'Creates a new supervisor account.';

-- Grants
GRANT USAGE ON SCHEMA public TO anon, authenticated, service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO authenticated, service_role;
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA public TO authenticated, service_role;

COMMIT;
