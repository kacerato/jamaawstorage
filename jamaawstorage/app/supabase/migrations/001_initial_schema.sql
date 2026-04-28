-- ============================================================================
-- JamaaW Storage - Initial Schema Migration
-- Warehouse/Stock Control with EPI Management & Electronic Signatures
-- ============================================================================

BEGIN;

-- ============================================================================
-- 1. ENUM TYPES
-- ============================================================================

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_type t WHERE t.typname = 'app_role') THEN
        CREATE TYPE app_role AS ENUM ('supervisor', 'leader', 'collaborator');
    END IF;

    IF NOT EXISTS (SELECT 1 FROM pg_type t WHERE t.typname = 'withdrawal_destination_type') THEN
        CREATE TYPE withdrawal_destination_type AS ENUM ('collaborator', 'worksite');
    END IF;

    IF NOT EXISTS (SELECT 1 FROM pg_type t WHERE t.typname = 'withdrawal_status') THEN
        CREATE TYPE withdrawal_status AS ENUM ('pending', 'authorized', 'cancelled');
    END IF;
END
$$;

COMMENT ON TYPE app_role IS 'User roles: supervisor (auth user), leader, collaborator (managed people)';
COMMENT ON TYPE withdrawal_destination_type IS 'Where withdrawn items go: to a collaborator or to a work site';
COMMENT ON TYPE withdrawal_status IS 'Withdrawal lifecycle: pending, authorized, or cancelled';

-- ============================================================================
-- 2. TABLES
-- ============================================================================

-- --------------------------------------------------------------------------
-- 2.1 profiles: Authenticated users (supervisors) linked to Supabase Auth
-- --------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS profiles (
    id            UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
    full_name     TEXT NOT NULL,
    employee_id   TEXT UNIQUE,
    role          app_role NOT NULL DEFAULT 'supervisor',
    sector        TEXT,
    photo_url     TEXT,
    is_active     BOOLEAN NOT NULL DEFAULT true,
    created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at    TIMESTAMPTZ NOT NULL DEFAULT now(),

    CONSTRAINT profiles_role_check CHECK (role = 'supervisor')
);

COMMENT ON TABLE profiles IS 'Authenticated supervisor accounts linked to Supabase Auth';
COMMENT ON COLUMN profiles.employee_id IS 'Matrícula/employee ID number';
COMMENT ON COLUMN profiles.sector IS 'Setor/obra padrão assigned to the supervisor';
COMMENT ON COLUMN profiles.role IS 'Always supervisor for auth users; leader/collaborator are in people table';

-- --------------------------------------------------------------------------
-- 2.2 people: Leaders and collaborators managed by supervisors (no auth login)
-- --------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS people (
    id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    full_name     TEXT NOT NULL,
    employee_id   TEXT NOT NULL UNIQUE,
    role          app_role NOT NULL,
    sector        TEXT,
    photo_url     TEXT,
    is_active     BOOLEAN NOT NULL DEFAULT true,
    created_by    UUID REFERENCES profiles(id),
    created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at    TIMESTAMPTZ NOT NULL DEFAULT now(),

    CONSTRAINT people_role_check CHECK (role IN ('leader', 'collaborator'))
);

COMMENT ON TABLE people IS 'Leaders and collaborators managed by supervisors; they do NOT have auth login';
COMMENT ON COLUMN people.employee_id IS 'Matrícula/employee ID number';
COMMENT ON COLUMN people.sector IS 'Setor/obra padrão assigned to the person';
COMMENT ON COLUMN people.created_by IS 'Supervisor who created this person record';

-- --------------------------------------------------------------------------
-- 2.3 work_sites: Construction/worksites (obras)
-- --------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS work_sites (
    id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name          TEXT NOT NULL,
    description   TEXT,
    location      TEXT,
    is_active     BOOLEAN NOT NULL DEFAULT true,
    created_by    UUID REFERENCES profiles(id),
    created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

COMMENT ON TABLE work_sites IS 'Construction sites / obras where items can be dispatched to';
COMMENT ON COLUMN work_sites.name IS 'Name/identifier of the work site';
COMMENT ON COLUMN work_sites.location IS 'Physical location or address of the work site';

-- --------------------------------------------------------------------------
-- 2.4 stock_items: Items in the warehouse (EPIs, tools, materials, etc.)
-- --------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS stock_items (
    id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    code              TEXT NOT NULL UNIQUE,
    name              TEXT NOT NULL,
    description       TEXT,
    unit              TEXT NOT NULL DEFAULT 'un',
    ca_nr             TEXT,
    category          TEXT,
    svg_icon_key      TEXT,
    current_quantity  INTEGER NOT NULL DEFAULT 0,
    minimum_quantity  INTEGER NOT NULL DEFAULT 0,
    is_active         BOOLEAN NOT NULL DEFAULT true,
    created_by        UUID REFERENCES profiles(id),
    created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at        TIMESTAMPTZ NOT NULL DEFAULT now(),

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
-- 2.5 stock_item_lots: Lot/batch tracking for stock items
-- --------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS stock_item_lots (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    stock_item_id   UUID NOT NULL REFERENCES stock_items(id) ON DELETE CASCADE,
    lot_code        TEXT NOT NULL,
    quantity        INTEGER NOT NULL DEFAULT 0,
    expiry_date     DATE,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),

    CONSTRAINT stock_item_lots_quantity_nonneg CHECK (quantity >= 0),
    CONSTRAINT stock_item_lots_unique_lot UNIQUE (stock_item_id, lot_code)
);

COMMENT ON TABLE stock_item_lots IS 'Lot/batch tracking for stock items with optional expiry dates';
COMMENT ON COLUMN stock_item_lots.lot_code IS 'Manufacturer or internal lot/batch code';
COMMENT ON COLUMN stock_item_lots.expiry_date IS 'Optional expiry date for the lot';

-- --------------------------------------------------------------------------
-- 2.6 kits: Predefined kits (e.g., "Kit EPI Padrão")
-- --------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS kits (
    id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name          TEXT NOT NULL,
    description   TEXT,
    is_active     BOOLEAN NOT NULL DEFAULT true,
    created_by    UUID REFERENCES profiles(id),
    created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

COMMENT ON TABLE kits IS 'Predefined kits grouping multiple stock items together';

-- --------------------------------------------------------------------------
-- 2.7 kit_items: Items that belong to a kit
-- --------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS kit_items (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    kit_id          UUID NOT NULL REFERENCES kits(id) ON DELETE CASCADE,
    stock_item_id   UUID NOT NULL REFERENCES stock_items(id),
    quantity        INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT kit_items_quantity_pos CHECK (quantity > 0),
    CONSTRAINT kit_items_unique_item UNIQUE (kit_id, stock_item_id)
);

COMMENT ON TABLE kit_items IS 'Junction table: which stock items belong to which kits and in what quantity';

-- --------------------------------------------------------------------------
-- 2.8 withdrawals: Core withdrawal record with electronic signatures
-- --------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS withdrawals (
    id                      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    code                    TEXT NOT NULL UNIQUE,
    authorized_by           UUID NOT NULL REFERENCES profiles(id),
    requested_by            UUID NOT NULL REFERENCES people(id),
    destination_type        withdrawal_destination_type NOT NULL,
    collaborator_id         UUID REFERENCES people(id),
    work_site_id            UUID REFERENCES work_sites(id),
    status                  withdrawal_status NOT NULL DEFAULT 'authorized',
    notes                   TEXT,
    photo_url               TEXT,
    supervisor_signature    TEXT NOT NULL,
    requester_signature     TEXT NOT NULL,
    witness_signature       TEXT,
    withdrawn_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
    created_at              TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at              TIMESTAMPTZ NOT NULL DEFAULT now(),

    CONSTRAINT withdrawals_destination_check
        CHECK (
            (destination_type = 'collaborator' AND collaborator_id IS NOT NULL)
            OR
            (destination_type = 'worksite' AND work_site_id IS NOT NULL)
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
-- 2.9 withdrawal_items: Individual items within a withdrawal
-- --------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS withdrawal_items (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    withdrawal_id   UUID NOT NULL REFERENCES withdrawals(id) ON DELETE CASCADE,
    stock_item_id   UUID NOT NULL REFERENCES stock_items(id),
    lot_id          UUID REFERENCES stock_item_lots(id),
    quantity        INTEGER NOT NULL,
    unit            TEXT NOT NULL DEFAULT 'un',

    CONSTRAINT withdrawal_items_quantity_pos CHECK (quantity > 0),
    CONSTRAINT withdrawal_items_unique_entry UNIQUE (withdrawal_id, stock_item_id, lot_id)
);

COMMENT ON TABLE withdrawal_items IS 'Individual stock items within a withdrawal record';
COMMENT ON COLUMN withdrawal_items.lot_id IS 'Optional reference to the specific lot being withdrawn';
COMMENT ON COLUMN withdrawal_items.unit IS 'Unit of measure at time of withdrawal (snapshot)';

-- --------------------------------------------------------------------------
-- 2.10 person_inventories: Current inventory per collaborator
-- --------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS person_inventories (
    id                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    person_id            UUID NOT NULL REFERENCES people(id) ON DELETE CASCADE,
    stock_item_id        UUID NOT NULL REFERENCES stock_items(id),
    quantity             INTEGER NOT NULL DEFAULT 0,
    last_withdrawal_id   UUID REFERENCES withdrawals(id),
    updated_at           TIMESTAMPTZ NOT NULL DEFAULT now(),

    CONSTRAINT person_inventories_quantity_nonneg CHECK (quantity >= 0),
    CONSTRAINT person_inventories_unique_item UNIQUE (person_id, stock_item_id)
);

COMMENT ON TABLE person_inventories IS 'Current inventory per person — tracks what each collaborator currently holds';
COMMENT ON COLUMN person_inventories.last_withdrawal_id IS 'The most recent withdrawal that affected this inventory line';

-- --------------------------------------------------------------------------
-- 2.11 audit_logs: Audit trail for all changes
-- --------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS audit_logs (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id     UUID REFERENCES profiles(id),
    action      TEXT NOT NULL,
    table_name  TEXT NOT NULL,
    record_id   UUID,
    old_data    JSONB,
    new_data    JSONB,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),

    CONSTRAINT audit_logs_action_check CHECK (action IN ('INSERT', 'UPDATE', 'DELETE'))
);

COMMENT ON TABLE audit_logs IS 'Audit trail capturing all data changes across tracked tables';
COMMENT ON COLUMN audit_logs.user_id IS 'Profile of the user who performed the action';
COMMENT ON COLUMN audit_logs.record_id IS 'Primary key of the affected record';
COMMENT ON COLUMN audit_logs.old_data IS 'JSON snapshot of the row before the change (NULL for INSERT)';
COMMENT ON COLUMN audit_logs.new_data IS 'JSON snapshot of the row after the change (NULL for DELETE)';

-- ============================================================================
-- 3. INDEXES
-- ============================================================================

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

-- ============================================================================
-- 4. ROW LEVEL SECURITY (RLS)
-- ============================================================================

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
-- profiles: users can read their own profile; supervisors can read all
-- --------------------------------------------------------------------------
CREATE POLICY "profiles_read_own" ON profiles
    FOR SELECT TO authenticated
    USING (id = auth.uid());

CREATE POLICY "profiles_read_all_supervisor" ON profiles
    FOR SELECT TO authenticated
    USING (
        EXISTS (
            SELECT 1 FROM profiles p
            WHERE p.id = auth.uid() AND p.role = 'supervisor'
        )
    );

CREATE POLICY "profiles_update_own" ON profiles
    FOR UPDATE TO authenticated
    USING (id = auth.uid());

-- --------------------------------------------------------------------------
-- people: only authenticated users (supervisors) can do everything
-- --------------------------------------------------------------------------
CREATE POLICY "people_all_authenticated" ON people
    FOR ALL TO authenticated
    USING (
        EXISTS (
            SELECT 1 FROM profiles p
            WHERE p.id = auth.uid() AND p.role = 'supervisor'
        )
    )
    WITH CHECK (
        EXISTS (
            SELECT 1 FROM profiles p
            WHERE p.id = auth.uid() AND p.role = 'supervisor'
        )
    );

-- --------------------------------------------------------------------------
-- work_sites: only authenticated users can do everything
-- --------------------------------------------------------------------------
CREATE POLICY "work_sites_all_authenticated" ON work_sites
    FOR ALL TO authenticated
    USING (true)
    WITH CHECK (true);

-- --------------------------------------------------------------------------
-- stock_items: only authenticated users can do everything
-- --------------------------------------------------------------------------
CREATE POLICY "stock_items_all_authenticated" ON stock_items
    FOR ALL TO authenticated
    USING (true)
    WITH CHECK (true);

-- --------------------------------------------------------------------------
-- stock_item_lots: only authenticated users can do everything
-- --------------------------------------------------------------------------
CREATE POLICY "stock_item_lots_all_authenticated" ON stock_item_lots
    FOR ALL TO authenticated
    USING (true)
    WITH CHECK (true);

-- --------------------------------------------------------------------------
-- kits: only authenticated users can do everything
-- --------------------------------------------------------------------------
CREATE POLICY "kits_all_authenticated" ON kits
    FOR ALL TO authenticated
    USING (true)
    WITH CHECK (true);

-- --------------------------------------------------------------------------
-- kit_items: only authenticated users can do everything
-- --------------------------------------------------------------------------
CREATE POLICY "kit_items_all_authenticated" ON kit_items
    FOR ALL TO authenticated
    USING (true)
    WITH CHECK (true);

-- --------------------------------------------------------------------------
-- withdrawals: only authenticated users can do everything
-- --------------------------------------------------------------------------
CREATE POLICY "withdrawals_all_authenticated" ON withdrawals
    FOR ALL TO authenticated
    USING (true)
    WITH CHECK (true);

-- --------------------------------------------------------------------------
-- withdrawal_items: only authenticated users can do everything
-- --------------------------------------------------------------------------
CREATE POLICY "withdrawal_items_all_authenticated" ON withdrawal_items
    FOR ALL TO authenticated
    USING (true)
    WITH CHECK (true);

-- --------------------------------------------------------------------------
-- person_inventories: only authenticated users can do everything
-- --------------------------------------------------------------------------
CREATE POLICY "person_inventories_all_authenticated" ON person_inventories
    FOR ALL TO authenticated
    USING (true)
    WITH CHECK (true);

-- --------------------------------------------------------------------------
-- audit_logs: only authenticated users can read; only system can insert
-- --------------------------------------------------------------------------
CREATE POLICY "audit_logs_select_authenticated" ON audit_logs
    FOR SELECT TO authenticated
    USING (true);

CREATE POLICY "audit_logs_insert_system" ON audit_logs
    FOR INSERT TO authenticated
    WITH CHECK (true);

-- ============================================================================
-- 5. FUNCTIONS
-- ============================================================================

-- --------------------------------------------------------------------------
-- 5.1 Auto-update updated_at column
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
-- 5.2 Generate withdrawal code: RET-YYYYMMDD-NNN (sequential per day)
-- --------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION generate_withdrawal_code()
RETURNS TRIGGER AS $$
DECLARE
    today_code  TEXT;
    next_seq    INTEGER;
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
-- 5.3 Handle stock deduction after withdrawal_items INSERT
-- --------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION handle_stock_deduction()
RETURNS TRIGGER AS $$
DECLARE
    w_dest_type  withdrawal_destination_type;
    w_collab_id  UUID;
    w_status     withdrawal_status;
    new_qty      INTEGER;
BEGIN
    SELECT destination_type, collaborator_id, status
    INTO w_dest_type, w_collab_id, w_status
    FROM withdrawals
    WHERE id = NEW.withdrawal_id;

    IF w_status = 'cancelled' THEN
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
        SET quantity      = person_inventories.quantity + EXCLUDED.quantity,
            last_withdrawal_id = EXCLUDED.last_withdrawal_id,
            updated_at         = now();
    END IF;

    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION handle_stock_deduction() IS 'Trigger function: deducts stock on withdrawal item insert, upserts person_inventories if destination is collaborator';

-- --------------------------------------------------------------------------
-- 5.4 Handle stock restoration when a withdrawal is cancelled
-- --------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION handle_stock_restoration()
RETURNS TRIGGER AS $$
DECLARE
    wi_rec  RECORD;
BEGIN
    IF OLD.status = NEW.status THEN
        RETURN NEW;
    END IF;

    IF NEW.status = 'cancelled' AND OLD.status <> 'cancelled' THEN
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
                SET quantity   = GREATEST(quantity - wi_rec.quantity, 0),
                    updated_at = now()
                WHERE person_id     = wi_rec.collaborator_id
                  AND stock_item_id = wi_rec.stock_item_id;

                DELETE FROM person_inventories
                WHERE person_id     = wi_rec.collaborator_id
                  AND stock_item_id = wi_rec.stock_item_id
                  AND quantity      = 0;
            END IF;
        END LOOP;
    END IF;

    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION handle_stock_restoration() IS 'Trigger function: restores stock quantities and adjusts person_inventories when a withdrawal is cancelled';

-- --------------------------------------------------------------------------
-- 5.5 Generic audit trigger function
-- --------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION log_audit()
RETURNS TRIGGER AS $$
DECLARE
    audit_user_id  UUID;
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
-- 5.6 Check low stock: returns items at or below minimum quantity
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

-- ============================================================================
-- 6. TRIGGERS
-- ============================================================================

-- --------------------------------------------------------------------------
-- 6.1 update_updated_at triggers
-- --------------------------------------------------------------------------
CREATE TRIGGER trg_profiles_updated_at
    BEFORE UPDATE ON profiles
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER trg_people_updated_at
    BEFORE UPDATE ON people
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER trg_work_sites_updated_at
    BEFORE UPDATE ON work_sites
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER trg_stock_items_updated_at
    BEFORE UPDATE ON stock_items
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER trg_kits_updated_at
    BEFORE UPDATE ON kits
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER trg_withdrawals_updated_at
    BEFORE UPDATE ON withdrawals
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER trg_person_inventories_updated_at
    BEFORE UPDATE ON person_inventories
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();

-- --------------------------------------------------------------------------
-- 6.2 Withdrawal code generation trigger
-- --------------------------------------------------------------------------
CREATE TRIGGER trg_withdrawals_generate_code
    BEFORE INSERT ON withdrawals
    FOR EACH ROW
    EXECUTE FUNCTION generate_withdrawal_code();

-- --------------------------------------------------------------------------
-- 6.3 Stock deduction trigger (AFTER INSERT on withdrawal_items)
-- --------------------------------------------------------------------------
CREATE TRIGGER trg_withdrawal_items_stock_deduction
    AFTER INSERT ON withdrawal_items
    FOR EACH ROW
    EXECUTE FUNCTION handle_stock_deduction();

-- --------------------------------------------------------------------------
-- 6.4 Stock restoration trigger (AFTER UPDATE on withdrawals)
-- --------------------------------------------------------------------------
CREATE TRIGGER trg_withdrawals_stock_restoration
    AFTER UPDATE ON withdrawals
    FOR EACH ROW
    EXECUTE FUNCTION handle_stock_restoration();

-- --------------------------------------------------------------------------
-- 6.5 Audit triggers
-- --------------------------------------------------------------------------
CREATE TRIGGER trg_people_audit
    AFTER INSERT OR UPDATE OR DELETE ON people
    FOR EACH ROW
    EXECUTE FUNCTION log_audit();

CREATE TRIGGER trg_work_sites_audit
    AFTER INSERT OR UPDATE OR DELETE ON work_sites
    FOR EACH ROW
    EXECUTE FUNCTION log_audit();

CREATE TRIGGER trg_stock_items_audit
    AFTER INSERT OR UPDATE OR DELETE ON stock_items
    FOR EACH ROW
    EXECUTE FUNCTION log_audit();

CREATE TRIGGER trg_kits_audit
    AFTER INSERT OR UPDATE OR DELETE ON kits
    FOR EACH ROW
    EXECUTE FUNCTION log_audit();

CREATE TRIGGER trg_withdrawals_audit
    AFTER INSERT OR UPDATE OR DELETE ON withdrawals
    FOR EACH ROW
    EXECUTE FUNCTION log_audit();

CREATE TRIGGER trg_person_inventories_audit
    AFTER INSERT OR UPDATE OR DELETE ON person_inventories
    FOR EACH ROW
    EXECUTE FUNCTION log_audit();

COMMIT;
