-- ============================================================================
-- JAMAAW STORAGE - 004: Robust Schema with Supervisor Command
-- Migration: Restores strong RLS, adds create_supervisor_account RPC,
-- adds missing triggers/indexes/columns, and hardens security.
-- Backward compatible with migrations 001-003.
-- Idempotent: safe to run on fresh or existing databases.
-- ============================================================================

BEGIN;

-- ============================================================================
-- 1. EXTENSIONS
-- ============================================================================
CREATE EXTENSION IF NOT EXISTS pg_trgm;
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- ============================================================================
-- 2. ENUM TYPES (ensure they exist with correct values)
-- ============================================================================
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

-- Align enum values from older migrations if needed
DO $$
BEGIN
    IF EXISTS (
        SELECT 1 FROM pg_enum e
        JOIN pg_type t ON t.oid = e.enumtypid
        WHERE t.typname = 'withdrawal_destination_type'
        AND e.enumlabel = 'worksite'
    ) AND NOT EXISTS (
        SELECT 1 FROM pg_enum e
        JOIN pg_type t ON t.oid = e.enumtypid
        WHERE t.typname = 'withdrawal_destination_type'
        AND e.enumlabel = 'work_site'
    ) THEN
        ALTER TYPE withdrawal_destination_type RENAME VALUE 'worksite' TO 'work_site';
    END IF;
END
$$;

DO $$
BEGIN
    IF EXISTS (
        SELECT 1 FROM pg_enum e
        JOIN pg_type t ON t.oid = e.enumtypid
        WHERE t.typname = 'withdrawal_status'
        AND e.enumlabel = 'authorized'
    ) AND NOT EXISTS (
        SELECT 1 FROM pg_enum e
        JOIN pg_type t ON t.oid = e.enumtypid
        WHERE t.typname = 'withdrawal_status'
        AND e.enumlabel = 'approved'
    ) THEN
        ALTER TYPE withdrawal_status RENAME VALUE 'authorized' TO 'approved';
    END IF;

    IF EXISTS (
        SELECT 1 FROM pg_enum e
        JOIN pg_type t ON t.oid = e.enumtypid
        WHERE t.typname = 'withdrawal_status'
        AND e.enumlabel = 'cancelled'
    ) AND NOT EXISTS (
        SELECT 1 FROM pg_enum e
        JOIN pg_type t ON t.oid = e.enumtypid
        WHERE t.typname = 'withdrawal_status'
        AND e.enumlabel = 'rejected'
    ) THEN
        ALTER TYPE withdrawal_status RENAME VALUE 'cancelled' TO 'rejected';
    END IF;
END
$$;

ALTER TYPE withdrawal_status ADD VALUE IF NOT EXISTS 'completed';

COMMENT ON TYPE app_role IS 'User roles: supervisor (auth user), leader, collaborator (managed people)';
COMMENT ON TYPE withdrawal_destination_type IS 'Where withdrawn items go: to a collaborator or to a work site';
COMMENT ON TYPE withdrawal_status IS 'Withdrawal lifecycle: pending, approved, completed, or rejected';

-- ============================================================================
-- 3. TABLES (CREATE IF NOT EXISTS - idempotent)
-- ============================================================================

-- --------------------------------------------------------------------------
-- 3.1 profiles
-- --------------------------------------------------------------------------
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

COMMENT ON TABLE profiles IS 'Authenticated supervisor accounts linked to Supabase Auth';
COMMENT ON COLUMN profiles.employee_id IS 'Matrícula/employee ID number';
COMMENT ON COLUMN profiles.sector IS 'Setor/obra padrão assigned to the supervisor';
COMMENT ON COLUMN profiles.role IS 'Always supervisor for auth users; leader/collaborator are in people table';

-- --------------------------------------------------------------------------
-- 3.2 people
-- --------------------------------------------------------------------------
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

COMMENT ON TABLE people IS 'Leaders and collaborators managed by supervisors; they do NOT have auth login';
COMMENT ON COLUMN people.employee_id IS 'Matrícula/employee ID number';
COMMENT ON COLUMN people.sector IS 'Setor/obra padrão assigned to the person';
COMMENT ON COLUMN people.created_by IS 'Supervisor who created this person record';

-- --------------------------------------------------------------------------
-- 3.3 work_sites
-- --------------------------------------------------------------------------
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

COMMENT ON TABLE work_sites IS 'Construction sites / obras where items can be dispatched to';
COMMENT ON COLUMN work_sites.name IS 'Name/identifier of the work site';
COMMENT ON COLUMN work_sites.location IS 'Physical location or address of the work site';

-- --------------------------------------------------------------------------
-- 3.4 stock_items
-- --------------------------------------------------------------------------
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

COMMENT ON TABLE stock_items IS 'Warehouse stock items: EPIs, tools, materials, etc.';
COMMENT ON COLUMN stock_items.code IS 'Unique item code (código do item)';
COMMENT ON COLUMN stock_items.unit IS 'Unit of measure: un, pç, cx, m, etc.';
COMMENT ON COLUMN stock_items.ca_nr IS 'CA/NR number — optional, for EPI items (Certificado de Aprovação)';
COMMENT ON COLUMN stock_items.category IS 'Item category: EPI, ferramenta, material, etc.';
COMMENT ON COLUMN stock_items.svg_icon_key IS 'Key to reference which SVG icon to display in the UI';
COMMENT ON COLUMN stock_items.current_quantity IS 'Current available quantity in warehouse';
COMMENT ON COLUMN stock_items.minimum_quantity IS 'Minimum stock level for low-stock alerts';

-- --------------------------------------------------------------------------
-- 3.5 stock_item_lots
-- --------------------------------------------------------------------------
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

COMMENT ON TABLE stock_item_lots IS 'Lot/batch tracking for stock items with optional expiry dates';
COMMENT ON COLUMN stock_item_lots.lot_code IS 'Manufacturer or internal lot/batch code';
COMMENT ON COLUMN stock_item_lots.expiry_date IS 'Optional expiry date for the lot';

-- --------------------------------------------------------------------------
-- 3.6 kits
-- --------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS kits (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name TEXT NOT NULL,
    description TEXT,
    is_active BOOLEAN NOT NULL DEFAULT true,
    created_by UUID REFERENCES profiles(id),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

COMMENT ON TABLE kits IS 'Predefined kits grouping multiple stock items together';

-- --------------------------------------------------------------------------
-- 3.7 kit_items
-- --------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS kit_items (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    kit_id UUID NOT NULL REFERENCES kits(id) ON DELETE CASCADE,
    stock_item_id UUID NOT NULL REFERENCES stock_items(id),
    quantity INTEGER NOT NULL DEFAULT 1,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT kit_items_quantity_pos CHECK (quantity > 0),
    CONSTRAINT kit_items_unique_item UNIQUE (kit_id, stock_item_id)
);

COMMENT ON TABLE kit_items IS 'Junction table: which stock items belong to which kits and in what quantity';

-- --------------------------------------------------------------------------
-- 3.8 withdrawals
-- --------------------------------------------------------------------------
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

COMMENT ON TABLE withdrawals IS 'Core withdrawal record with electronic signatures for stock dispatch';
COMMENT ON COLUMN withdrawals.code IS 'Auto-generated withdrawal code: RET-YYYYMMDD-NNN';
COMMENT ON COLUMN withdrawals.authorized_by IS 'Supervisor who authorized the withdrawal';
COMMENT ON COLUMN withdrawals.requested_by IS 'Leader who requested the withdrawal';
COMMENT ON COLUMN withdrawals.destination_type IS 'Whether items go to a collaborator or a work site';
COMMENT ON COLUMN withdrawals.collaborator_id IS 'Collaborator receiving items (NULL if destination is worksite)';
COMMENT ON COLUMN withdrawals.work_site_id IS 'Work site receiving items (NULL if destination is collaborator)';
COMMENT ON COLUMN withdrawals.supervisor_signature IS 'Base64-encoded signature image of the authorizing supervisor';
COMMENT ON COLUMN withdrawals.requester_signature IS 'Base64-encoded signature image of the requesting leader';
COMMENT ON COLUMN withdrawals.witness_signature IS 'Optional base64-encoded signature of witness/almoxarife';
COMMENT ON COLUMN withdrawals.photo_url IS 'Photographic record URL of the withdrawal';

-- --------------------------------------------------------------------------
-- 3.9 withdrawal_items
-- --------------------------------------------------------------------------
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

COMMENT ON TABLE withdrawal_items IS 'Individual stock items within a withdrawal record';
COMMENT ON COLUMN withdrawal_items.lot_id IS 'Optional reference to the specific lot being withdrawn';
COMMENT ON COLUMN withdrawal_items.unit IS 'Unit of measure at time of withdrawal (snapshot)';

-- --------------------------------------------------------------------------
-- 3.10 person_inventories
-- --------------------------------------------------------------------------
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

COMMENT ON TABLE person_inventories IS 'Current inventory per person — tracks what each collaborator currently holds';
COMMENT ON COLUMN person_inventories.last_withdrawal_id IS 'The most recent withdrawal that affected this inventory line';

-- --------------------------------------------------------------------------
-- 3.11 audit_logs
-- --------------------------------------------------------------------------
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

COMMENT ON TABLE audit_logs IS 'Audit trail capturing all data changes across tracked tables';
COMMENT ON COLUMN audit_logs.user_id IS 'Profile of the user who performed the action';
COMMENT ON COLUMN audit_logs.record_id IS 'Primary key of the affected record';
COMMENT ON COLUMN audit_logs.old_data IS 'JSON snapshot of the row before the change (NULL for INSERT)';
COMMENT ON COLUMN audit_logs.new_data IS 'JSON snapshot of the row after the change (NULL for DELETE)';

-- ============================================================================
-- 4. COLUMN ADDITIONS (idempotent - ADD IF NOT EXISTS pattern)
-- ============================================================================

-- Add description to work_sites if not exists
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema = 'public'
        AND table_name = 'work_sites'
        AND column_name = 'description'
    ) THEN
        ALTER TABLE public.work_sites ADD COLUMN description TEXT;
    END IF;
END
$$;

-- Verify withdrawn_at exists on withdrawals
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema = 'public'
        AND table_name = 'withdrawals'
        AND column_name = 'withdrawn_at'
    ) THEN
        ALTER TABLE public.withdrawals ADD COLUMN withdrawn_at TIMESTAMPTZ NOT NULL DEFAULT now();
    END IF;
END
$$;

-- Verify last_withdrawal_id exists on person_inventories
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema = 'public'
        AND table_name = 'person_inventories'
        AND column_name = 'last_withdrawal_id'
    ) THEN
        ALTER TABLE public.person_inventories ADD COLUMN last_withdrawal_id UUID REFERENCES public.withdrawals(id);
    END IF;
END
$$;

-- Verify updated_at exists on stock_item_lots
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema = 'public'
        AND table_name = 'stock_item_lots'
        AND column_name = 'updated_at'
    ) THEN
        ALTER TABLE public.stock_item_lots ADD COLUMN updated_at TIMESTAMPTZ NOT NULL DEFAULT now();
    END IF;
END
$$;

-- Verify created_at exists on kit_items
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema = 'public'
        AND table_name = 'kit_items'
        AND column_name = 'created_at'
    ) THEN
        ALTER TABLE public.kit_items ADD COLUMN created_at TIMESTAMPTZ NOT NULL DEFAULT now();
    END IF;
END
$$;

-- Verify created_at exists on withdrawal_items
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema = 'public'
        AND table_name = 'withdrawal_items'
        AND column_name = 'created_at'
    ) THEN
        ALTER TABLE public.withdrawal_items ADD COLUMN created_at TIMESTAMPTZ NOT NULL DEFAULT now();
    END IF;
END
$$;

-- Set default for withdrawals.status to 'pending' if not already
ALTER TABLE public.withdrawals ALTER COLUMN status SET DEFAULT 'pending';

-- ============================================================================
-- 5. INDEXES
-- ============================================================================

-- Basic indexes (foreign keys and frequent lookups)
CREATE INDEX IF NOT EXISTS idx_people_role ON people(role);
CREATE INDEX IF NOT EXISTS idx_people_is_active ON people(is_active);
CREATE INDEX IF NOT EXISTS idx_stock_items_code ON stock_items(code);
CREATE INDEX IF NOT EXISTS idx_stock_items_category ON stock_items(category);
CREATE INDEX IF NOT EXISTS idx_stock_items_current_quantity ON stock_items(current_quantity);
CREATE INDEX IF NOT EXISTS idx_withdrawals_authorized_by ON withdrawals(authorized_by);
CREATE INDEX IF NOT EXISTS idx_withdrawals_requested_by ON withdrawals(requested_by);
CREATE INDEX IF NOT EXISTS idx_withdrawals_destination_type ON withdrawals(destination_type);
CREATE INDEX IF NOT EXISTS idx_withdrawals_collaborator_id ON withdrawals(collaborator_id);
CREATE INDEX IF NOT EXISTS idx_withdrawals_work_site_id ON withdrawals(work_site_id);
CREATE INDEX IF NOT EXISTS idx_withdrawals_withdrawn_at ON withdrawals(withdrawn_at);
CREATE INDEX IF NOT EXISTS idx_withdrawal_items_withdrawal_id ON withdrawal_items(withdrawal_id);
CREATE INDEX IF NOT EXISTS idx_withdrawal_items_stock_item_id ON withdrawal_items(stock_item_id);
CREATE INDEX IF NOT EXISTS idx_person_inventories_person_id ON person_inventories(person_id);
CREATE INDEX IF NOT EXISTS idx_audit_logs_user_id ON audit_logs(user_id);
CREATE INDEX IF NOT EXISTS idx_audit_logs_table_name ON audit_logs(table_name);
CREATE INDEX IF NOT EXISTS idx_audit_logs_created_at ON audit_logs(created_at);

-- Performance indexes from migration 003
CREATE INDEX IF NOT EXISTS idx_withdrawals_status ON withdrawals(status);
CREATE INDEX IF NOT EXISTS idx_stock_items_name_trgm ON stock_items USING gin (name gin_trgm_ops);
CREATE INDEX IF NOT EXISTS idx_stock_items_name_lower ON stock_items(lower(name));
CREATE INDEX IF NOT EXISTS idx_stock_items_code_lower ON stock_items(lower(code));
CREATE INDEX IF NOT EXISTS idx_stock_items_active_name ON stock_items(is_active, name);
CREATE INDEX IF NOT EXISTS idx_person_inventories_stock_item_id ON person_inventories(stock_item_id);
CREATE INDEX IF NOT EXISTS idx_kit_items_kit_id ON kit_items(kit_id);
CREATE INDEX IF NOT EXISTS idx_kit_items_stock_item_id ON kit_items(stock_item_id);
CREATE INDEX IF NOT EXISTS idx_withdrawal_items_lot_id ON withdrawal_items(lot_id);
CREATE INDEX IF NOT EXISTS idx_withdrawal_items_created_at ON withdrawal_items(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_withdrawals_status_date ON withdrawals(status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_audit_logs_table_created ON audit_logs(table_name, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_withdrawals_code_pattern ON withdrawals(code text_pattern_ops);

-- NEW: Index on profiles.is_active for is_active_supervisor() performance
CREATE INDEX IF NOT EXISTS idx_profiles_is_active ON profiles(is_active) WHERE is_active = true;

-- --------------------------------------------------------------------------
-- Pre-RLS function: is_active_supervisor() must exist BEFORE policies
-- --------------------------------------------------------------------------
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

COMMENT ON FUNCTION public.is_active_supervisor()
IS 'Returns true when the current auth user has an active supervisor profile. Used in RLS policies.';

-- ============================================================================
-- 6. ROW LEVEL SECURITY
-- ============================================================================

-- Enable RLS on all tables (idempotent)
ALTER TABLE profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE people ENABLE ROW LEVEL SECURITY;
ALTER TABLE work_sites ENABLE ROW LEVEL SECURITY;
ALTER TABLE stock_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE stock_item_lots ENABLE ROW LEVEL SECURITY;
ALTER TABLE kits ENABLE ROW LEVEL SECURITY;
ALTER TABLE kit_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE withdrawals ENABLE ROW LEVEL SECURITY;
ALTER TABLE withdrawal_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE person_inventories ENABLE ROW LEVEL SECURITY;
ALTER TABLE audit_logs ENABLE ROW LEVEL SECURITY;

-- --------------------------------------------------------------------------
-- 6.1 Drop ALL existing policies (from migrations 001, 002, 003)
-- --------------------------------------------------------------------------
DROP POLICY IF EXISTS "profiles_read_own" ON profiles;
DROP POLICY IF EXISTS "profiles_read_all_supervisor" ON profiles;
DROP POLICY IF EXISTS "profiles_update_own" ON profiles;
DROP POLICY IF EXISTS "profiles_select_active_supervisors" ON profiles;
DROP POLICY IF EXISTS "profiles_insert_own_supervisor" ON profiles;
DROP POLICY IF EXISTS "profiles_update_own_supervisor" ON profiles;
DROP POLICY IF EXISTS "profiles_access_own" ON profiles;

DROP POLICY IF EXISTS "people_all_authenticated" ON people;
DROP POLICY IF EXISTS "people_all_active_supervisors" ON people;
DROP POLICY IF EXISTS "people_all_auth" ON people;

DROP POLICY IF EXISTS "work_sites_all_authenticated" ON work_sites;
DROP POLICY IF EXISTS "work_sites_all_active_supervisors" ON work_sites;
DROP POLICY IF EXISTS "work_sites_all_auth" ON work_sites;

DROP POLICY IF EXISTS "stock_items_all_authenticated" ON stock_items;
DROP POLICY IF EXISTS "stock_items_all_active_supervisors" ON stock_items;
DROP POLICY IF EXISTS "stock_items_all_auth" ON stock_items;

DROP POLICY IF EXISTS "stock_item_lots_all_authenticated" ON stock_item_lots;
DROP POLICY IF EXISTS "stock_item_lots_all_active_supervisors" ON stock_item_lots;
DROP POLICY IF EXISTS "stock_item_lots_all_auth" ON stock_item_lots;

DROP POLICY IF EXISTS "kits_all_authenticated" ON kits;
DROP POLICY IF EXISTS "kits_all_active_supervisors" ON kits;
DROP POLICY IF EXISTS "kits_all_auth" ON kits;

DROP POLICY IF EXISTS "kit_items_all_authenticated" ON kit_items;
DROP POLICY IF EXISTS "kit_items_all_active_supervisors" ON kit_items;
DROP POLICY IF EXISTS "kit_items_all_auth" ON kit_items;

DROP POLICY IF EXISTS "withdrawals_all_authenticated" ON withdrawals;
DROP POLICY IF EXISTS "withdrawals_all_active_supervisors" ON withdrawals;
DROP POLICY IF EXISTS "withdrawals_all_auth" ON withdrawals;

DROP POLICY IF EXISTS "withdrawal_items_all_authenticated" ON withdrawal_items;
DROP POLICY IF EXISTS "withdrawal_items_all_active_supervisors" ON withdrawal_items;
DROP POLICY IF EXISTS "withdrawal_items_all_auth" ON withdrawal_items;

DROP POLICY IF EXISTS "person_inventories_all_authenticated" ON person_inventories;
DROP POLICY IF EXISTS "person_inventories_all_active_supervisors" ON person_inventories;
DROP POLICY IF EXISTS "person_inventories_all_auth" ON person_inventories;

DROP POLICY IF EXISTS "audit_logs_select_authenticated" ON audit_logs;
DROP POLICY IF EXISTS "audit_logs_insert_system" ON audit_logs;
DROP POLICY IF EXISTS "audit_logs_select_active_supervisors" ON audit_logs;
DROP POLICY IF EXISTS "audit_logs_insert_active_supervisors" ON audit_logs;
DROP POLICY IF EXISTS "audit_logs_select_auth" ON audit_logs;
DROP POLICY IF EXISTS "audit_logs_insert_auth" ON audit_logs;

-- --------------------------------------------------------------------------
-- 6.2 Create NEW strong RLS policies using is_active_supervisor()
-- --------------------------------------------------------------------------

-- profiles: SELECT for authenticated (own row OR is_active_supervisor)
CREATE POLICY "profiles_select_own_or_supervisor" ON profiles
    FOR SELECT TO authenticated
    USING (id = auth.uid() OR public.is_active_supervisor());

-- profiles: INSERT only for is_active_supervisor AND own id
CREATE POLICY "profiles_insert_supervisor_own" ON profiles
    FOR INSERT TO authenticated
    WITH CHECK (id = auth.uid() AND public.is_active_supervisor());

-- profiles: UPDATE only for is_active_supervisor AND own id
CREATE POLICY "profiles_update_supervisor_own" ON profiles
    FOR UPDATE TO authenticated
    USING (id = auth.uid() AND public.is_active_supervisor())
    WITH CHECK (id = auth.uid());

-- people: SELECT for active supervisors, CUD for active supervisors only
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

-- work_sites: SELECT for active supervisors, CUD for active supervisors only
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

-- stock_items: SELECT for active supervisors, CUD for active supervisors only
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

-- stock_item_lots: SELECT for active supervisors, CUD for active supervisors only
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

-- kits: SELECT for active supervisors, CUD for active supervisors only
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

-- kit_items: SELECT for active supervisors, CUD for active supervisors only
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

-- withdrawals: SELECT for active supervisors, CUD for active supervisors only
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

-- withdrawal_items: SELECT for active supervisors, CUD for active supervisors only
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

-- person_inventories: SELECT for active supervisors, CUD for active supervisors only
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

-- audit_logs: SELECT for is_active_supervisor only, INSERT via trigger (allow system inserts)
CREATE POLICY "audit_logs_select_supervisor" ON audit_logs
    FOR SELECT TO authenticated
    USING (public.is_active_supervisor());

CREATE POLICY "audit_logs_insert_system" ON audit_logs
    FOR INSERT TO authenticated
    WITH CHECK (true);

-- ============================================================================
-- 7. FUNCTIONS
-- ============================================================================

-- (is_active_supervisor moved before RLS policies in section 6)

-- --------------------------------------------------------------------------
-- 7.2 update_updated_at_column()
-- --------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = now();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION update_updated_at_column() IS 'Trigger function: automatically sets updated_at to now() on every row update';

-- --------------------------------------------------------------------------
-- 7.3 generate_withdrawal_code()
-- --------------------------------------------------------------------------
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
    WHERE w.code LIKE today_code || '-%';

    NEW.code := today_code || '-' || LPAD(next_seq::TEXT, 3, '0');
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION generate_withdrawal_code() IS 'Trigger function: auto-generates withdrawal code RET-YYYYMMDD-NNN, sequential per day';

-- --------------------------------------------------------------------------
-- 7.4 handle_stock_deduction()
-- --------------------------------------------------------------------------
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

    SELECT current_quantity INTO new_qty
    FROM stock_items
    WHERE id = NEW.stock_item_id;

    IF new_qty < NEW.quantity THEN
        RAISE EXCEPTION
        'Insufficient stock for item %. Available: %, Requested: %',
        NEW.stock_item_id, new_qty, NEW.quantity;
    END IF;

    UPDATE stock_items
    SET current_quantity = current_quantity - NEW.quantity
    WHERE id = NEW.stock_item_id;

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

COMMENT ON FUNCTION handle_stock_deduction() IS 'Trigger function: deducts stock on withdrawal item insert, upserts person_inventories if destination is collaborator';

-- --------------------------------------------------------------------------
-- 7.5 handle_stock_restoration()
-- --------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION handle_stock_restoration()
RETURNS TRIGGER AS $$
DECLARE
    wi_rec RECORD;
BEGIN
    IF OLD.status = NEW.status THEN
        RETURN NEW;
    END IF;

    IF NEW.status = 'rejected' AND OLD.status <> 'rejected' THEN
        FOR wi_rec IN
            SELECT wi.stock_item_id, wi.lot_id, wi.quantity, w.destination_type, w.collaborator_id
            FROM withdrawal_items wi
            JOIN withdrawals w ON w.id = wi.withdrawal_id
            WHERE wi.withdrawal_id = NEW.id
        LOOP
            UPDATE stock_items
            SET current_quantity = current_quantity + wi_rec.quantity
            WHERE id = wi_rec.stock_item_id;

            IF wi_rec.lot_id IS NOT NULL THEN
                UPDATE stock_item_lots
                SET quantity = quantity + wi_rec.quantity
                WHERE id = wi_rec.lot_id;
            END IF;

            IF wi_rec.destination_type = 'collaborator' AND wi_rec.collaborator_id IS NOT NULL THEN
                UPDATE person_inventories
                SET quantity = GREATEST(quantity - wi_rec.quantity, 0),
                    updated_at = now()
                WHERE person_id = wi_rec.collaborator_id
                AND stock_item_id = wi_rec.stock_item_id;

                DELETE FROM person_inventories
                WHERE person_id = wi_rec.collaborator_id
                AND stock_item_id = wi_rec.stock_item_id
                AND quantity = 0;
            END IF;
        END LOOP;
    END IF;

    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION handle_stock_restoration() IS 'Trigger function: restores stock quantities and adjusts person_inventories when a withdrawal is rejected';

-- --------------------------------------------------------------------------
-- 7.6 log_audit()
-- --------------------------------------------------------------------------
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

COMMENT ON FUNCTION log_audit() IS 'Generic audit trigger function: logs INSERT/UPDATE/DELETE into audit_logs with old/new row snapshots';

-- --------------------------------------------------------------------------
-- 7.7 check_low_stock()
-- --------------------------------------------------------------------------
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

COMMENT ON FUNCTION check_low_stock() IS 'Returns active stock items where current_quantity <= minimum_quantity and minimum_quantity > 0';

-- --------------------------------------------------------------------------
-- 7.8 create_supervisor_account() — RPC function for supervisor creation
-- --------------------------------------------------------------------------
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
        instance_id,
        id,
        aud,
        role,
        email,
        encrypted_password,
        email_confirmed_at,
        confirmation_token,
        confirmed_at,
        raw_app_meta_data,
        raw_user_meta_data,
        created_at,
        updated_at,
        last_sign_in_at,
        auth_token
    ) VALUES (
        '00000000-0000-0000-0000-000000000000',
        gen_random_uuid(),
        'authenticated',
        'authenticated',
        lower(trim(p_email)),
        crypt(p_password, gen_salt('bf')),
        now(),
        encode(gen_random_bytes(32), 'hex'),
        now(),
        '{"provider":"email","providers":["email"]}',
        jsonb_build_object('full_name', p_full_name, 'employee_id', p_employee_id),
        now(),
        now(),
        now(),
        encode(gen_random_bytes(32), 'hex')
    ) RETURNING id INTO new_user_id;

    INSERT INTO public.profiles (id, full_name, employee_id, role, sector, is_active)
    VALUES (new_user_id, p_full_name, p_employee_id, 'supervisor', p_sector, true);

    INSERT INTO public.audit_logs (user_id, action, table_name, record_id, old_data, new_data)
    VALUES (auth.uid(), 'INSERT', 'profiles', new_user_id, NULL,
        jsonb_build_object('id', new_user_id, 'full_name', p_full_name, 'role', 'supervisor', 'created_by_rpc', true));

    RETURN new_user_id;
END;
$$;

COMMENT ON FUNCTION public.create_supervisor_account()
IS 'RPC function: creates a new supervisor account (auth.user + profile). Only callable by active supervisors. Uses SECURITY DEFINER to insert into auth.users. Email confirmation is auto-set. Audit log is recorded.';

-- ============================================================================
-- 8. GRANTS
-- ============================================================================

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

-- Explicit grant on create_supervisor_account for authenticated role
GRANT EXECUTE ON FUNCTION public.create_supervisor_account(TEXT, TEXT, TEXT, TEXT, TEXT) TO authenticated;

-- ============================================================================
-- 9. TRIGGERS (DROP IF EXISTS + CREATE for idempotency)
-- ============================================================================

-- --------------------------------------------------------------------------
-- 9.1 update_updated_at triggers
-- --------------------------------------------------------------------------
DROP TRIGGER IF EXISTS trg_profiles_updated_at ON profiles;
CREATE TRIGGER trg_profiles_updated_at
    BEFORE UPDATE ON profiles
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();

DROP TRIGGER IF EXISTS trg_people_updated_at ON people;
CREATE TRIGGER trg_people_updated_at
    BEFORE UPDATE ON people
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();

DROP TRIGGER IF EXISTS trg_work_sites_updated_at ON work_sites;
CREATE TRIGGER trg_work_sites_updated_at
    BEFORE UPDATE ON work_sites
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();

DROP TRIGGER IF EXISTS trg_stock_items_updated_at ON stock_items;
CREATE TRIGGER trg_stock_items_updated_at
    BEFORE UPDATE ON stock_items
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();

DROP TRIGGER IF EXISTS trg_kits_updated_at ON kits;
CREATE TRIGGER trg_kits_updated_at
    BEFORE UPDATE ON kits
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();

DROP TRIGGER IF EXISTS trg_withdrawals_updated_at ON withdrawals;
CREATE TRIGGER trg_withdrawals_updated_at
    BEFORE UPDATE ON withdrawals
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();

DROP TRIGGER IF EXISTS trg_person_inventories_updated_at ON person_inventories;
CREATE TRIGGER trg_person_inventories_updated_at
    BEFORE UPDATE ON person_inventories
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();

-- NEW: Missing updated_at trigger for stock_item_lots
DROP TRIGGER IF EXISTS trg_stock_item_lots_updated_at ON stock_item_lots;
CREATE TRIGGER trg_stock_item_lots_updated_at
    BEFORE UPDATE ON stock_item_lots
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();

-- --------------------------------------------------------------------------
-- 9.2 Withdrawal code generation trigger
-- --------------------------------------------------------------------------
DROP TRIGGER IF EXISTS trg_withdrawals_generate_code ON withdrawals;
CREATE TRIGGER trg_withdrawals_generate_code
    BEFORE INSERT ON withdrawals
    FOR EACH ROW
    EXECUTE FUNCTION generate_withdrawal_code();

-- --------------------------------------------------------------------------
-- 9.3 Stock deduction trigger (AFTER INSERT on withdrawal_items)
-- --------------------------------------------------------------------------
DROP TRIGGER IF EXISTS trg_withdrawal_items_stock_deduction ON withdrawal_items;
CREATE TRIGGER trg_withdrawal_items_stock_deduction
    AFTER INSERT ON withdrawal_items
    FOR EACH ROW
    EXECUTE FUNCTION handle_stock_deduction();

-- --------------------------------------------------------------------------
-- 9.4 Stock restoration trigger (AFTER UPDATE on withdrawals)
-- --------------------------------------------------------------------------
DROP TRIGGER IF EXISTS trg_withdrawals_stock_restoration ON withdrawals;
CREATE TRIGGER trg_withdrawals_stock_restoration
    AFTER UPDATE ON withdrawals
    FOR EACH ROW
    EXECUTE FUNCTION handle_stock_restoration();

-- --------------------------------------------------------------------------
-- 9.5 Audit triggers (ensure all are present)
-- --------------------------------------------------------------------------
DROP TRIGGER IF EXISTS trg_people_audit ON people;
CREATE TRIGGER trg_people_audit
    AFTER INSERT OR UPDATE OR DELETE ON people
    FOR EACH ROW
    EXECUTE FUNCTION log_audit();

DROP TRIGGER IF EXISTS trg_work_sites_audit ON work_sites;
CREATE TRIGGER trg_work_sites_audit
    AFTER INSERT OR UPDATE OR DELETE ON work_sites
    FOR EACH ROW
    EXECUTE FUNCTION log_audit();

DROP TRIGGER IF EXISTS trg_stock_items_audit ON stock_items;
CREATE TRIGGER trg_stock_items_audit
    AFTER INSERT OR UPDATE OR DELETE ON stock_items
    FOR EACH ROW
    EXECUTE FUNCTION log_audit();

DROP TRIGGER IF EXISTS trg_kits_audit ON kits;
CREATE TRIGGER trg_kits_audit
    AFTER INSERT OR UPDATE OR DELETE ON kits
    FOR EACH ROW
    EXECUTE FUNCTION log_audit();

DROP TRIGGER IF EXISTS trg_withdrawals_audit ON withdrawals;
CREATE TRIGGER trg_withdrawals_audit
    AFTER INSERT OR UPDATE OR DELETE ON withdrawals
    FOR EACH ROW
    EXECUTE FUNCTION log_audit();

DROP TRIGGER IF EXISTS trg_person_inventories_audit ON person_inventories;
CREATE TRIGGER trg_person_inventories_audit
    AFTER INSERT OR UPDATE OR DELETE ON person_inventories
    FOR EACH ROW
    EXECUTE FUNCTION log_audit();

-- NEW: Missing audit triggers for profiles, stock_item_lots, kit_items, withdrawal_items
DROP TRIGGER IF EXISTS trg_profiles_audit ON profiles;
CREATE TRIGGER trg_profiles_audit
    AFTER INSERT OR UPDATE OR DELETE ON profiles
    FOR EACH ROW
    EXECUTE FUNCTION log_audit();

DROP TRIGGER IF EXISTS trg_stock_item_lots_audit ON stock_item_lots;
CREATE TRIGGER trg_stock_item_lots_audit
    AFTER INSERT OR UPDATE OR DELETE ON stock_item_lots
    FOR EACH ROW
    EXECUTE FUNCTION log_audit();

DROP TRIGGER IF EXISTS trg_kit_items_audit ON kit_items;
CREATE TRIGGER trg_kit_items_audit
    AFTER INSERT OR UPDATE OR DELETE ON kit_items
    FOR EACH ROW
    EXECUTE FUNCTION log_audit();

DROP TRIGGER IF EXISTS trg_withdrawal_items_audit ON withdrawal_items;
CREATE TRIGGER trg_withdrawal_items_audit
    AFTER INSERT OR UPDATE OR DELETE ON withdrawal_items
    FOR EACH ROW
    EXECUTE FUNCTION log_audit();

-- ============================================================================
-- 10. SECURITY NOTE: Disable public signup
-- ============================================================================
-- IMPORTANT: To prevent unauthorized account creation via Supabase Auth,
-- go to Supabase Dashboard -> Authentication -> Settings and DISABLE
-- "Enable email signup" for anon users. This blocks direct signups via
-- the Supabase Auth API. The create_supervisor_account() function bypasses
-- this restriction because it runs as SECURITY DEFINER and inserts directly
-- into auth.users, which is not affected by the Auth API signup toggle.

-- ============================================================================
-- COMMIT
-- ============================================================================
COMMIT;

-- ============================================================================
-- SEED: Execute no SQL Editor para criar o primeiro supervisor
-- ============================================================================
-- Quando o banco esta vazio, is_active_supervisor() retorna false para todos,
-- impossibilitando chamar create_supervisor_account(). Execute este bloco
-- DIRETAMENTE no SQL Editor do Supabase para criar o primeiro supervisor.
-- Depois disso, novos supervisores podem ser criados via RPC.
--
-- INSTRUCOES:
-- 1. Substitua os valores abaixo pelos dados reais do primeiro supervisor
-- 2. Abra o SQL Editor no Supabase Dashboard
-- 3. Cole e execute este bloco (fora de transacao)
-- 4. Apos a criacao, faca login no app e use create_supervisor_account
--    para criar demais supervisores
-- ============================================================================
--
-- INSERT INTO auth.users (
--     instance_id,
--     id,
--     aud,
--     role,
--     email,
--     encrypted_password,
--     email_confirmed_at,
--     confirmation_token,
--     confirmed_at,
--     raw_app_meta_data,
--     raw_user_meta_data,
--     created_at,
--     updated_at,
--     last_sign_in_at,
--     auth_token
-- ) VALUES (
--     '00000000-0000-0000-0000-000000000000',
--     gen_random_uuid(),
--     'authenticated',
--     'authenticated',
--     'admin@jamaawstorage.com',
--     crypt('SenhaForte123!', gen_salt('bf')),
--     now(),
--     encode(gen_random_bytes(32), 'hex'),
--     now(),
--     '{"provider":"email","providers":["email"]}',
--     '{"full_name":"Administrador Inicial", "employee_id":"SUP-001"}',
--     now(),
--     now(),
--     now(),
--     encode(gen_random_bytes(32), 'hex')
-- );
--
-- INSERT INTO public.profiles (id, full_name, employee_id, role, sector, is_active)
-- VALUES (
--     (SELECT id FROM auth.users WHERE email = 'admin@jamaawstorage.com'),
--     'Administrador Inicial',
--     'SUP-001',
--     'supervisor',
--     'Almoxarifado',
--     true
-- );
