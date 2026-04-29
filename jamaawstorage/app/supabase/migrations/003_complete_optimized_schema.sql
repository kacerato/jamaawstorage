-- ============================================================================
-- JAMAAW STORAGE - SCHEMA COMPLETO OTIMIZADO
-- Execute isso no SQL Editor do Supabase para recriar o banco do zero
-- ============================================================================
-- Este schema inclui:
-- 1. Todas as tabelas otimizadas
-- 2. Índices de performance críticos
-- 3. RLS policies simplificadas (sem funções pesadas)
-- 4. Triggers para atualização automática
-- ============================================================================

BEGIN;

-- ============================================================================
-- 1. EXTENSÕES
-- ============================================================================
CREATE EXTENSION IF NOT EXISTS pg_trgm;
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- ============================================================================
-- 2. ENUMS
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

-- ============================================================================
-- 3. TABELAS
-- ============================================================================

-- Profiles (usuários autenticados)
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

-- People (líderes e colaboradores)
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

-- Work Sites
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

-- Stock Items
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

-- Stock Item Lots
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

-- Kits
CREATE TABLE IF NOT EXISTS kits (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  description TEXT,
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_by UUID REFERENCES profiles(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Kit Items
CREATE TABLE IF NOT EXISTS kit_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  kit_id UUID NOT NULL REFERENCES kits(id) ON DELETE CASCADE,
  stock_item_id UUID NOT NULL REFERENCES stock_items(id),
  quantity INTEGER NOT NULL DEFAULT 1,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT kit_items_quantity_pos CHECK (quantity > 0),
  CONSTRAINT kit_items_unique_item UNIQUE (kit_id, stock_item_id)
);

-- Withdrawals
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

-- Withdrawal Items (com created_at para ordenação)
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

-- Person Inventories
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

-- Audit Logs
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

-- ============================================================================
-- 4. ÍNDICES OTIMIZADOS PARA PERFORMANCE
-- ============================================================================

-- Índices básicos (para foreign keys e buscas frequentes)
CREATE INDEX IF NOT EXISTS idx_people_role ON people(role);
CREATE INDEX IF NOT EXISTS idx_people_is_active ON people(is_active);
CREATE INDEX IF NOT EXISTS idx_stock_items_code ON stock_items(code);
CREATE INDEX IF NOT EXISTS idx_stock_items_category ON stock_items(category);
CREATE INDEX IF NOT EXISTS idx_withdrawals_authorized_by ON withdrawals(authorized_by);
CREATE INDEX IF NOT EXISTS idx_withdrawals_requested_by ON withdrawals(requested_by);
CREATE INDEX IF NOT EXISTS idx_withdrawals_status ON withdrawals(status);
CREATE INDEX IF NOT EXISTS idx_withdrawal_items_withdrawal_id ON withdrawal_items(withdrawal_id);
CREATE INDEX IF NOT EXISTS idx_withdrawal_items_stock_item_id ON withdrawal_items(stock_item_id);
CREATE INDEX IF NOT EXISTS idx_person_inventories_person_id ON person_inventories(person_id);
CREATE INDEX IF NOT EXISTS idx_audit_logs_created_at ON audit_logs(created_at);

-- Índices CRÍTICOS NOVOS para performance de busca
-- Buscas por texto (stock_items) - ESSENCIAL para o campo de busca
CREATE INDEX IF NOT EXISTS idx_stock_items_name_trgm ON stock_items USING gin (name gin_trgm_ops);
CREATE INDEX IF NOT EXISTS idx_stock_items_name_lower ON stock_items(lower(name));
CREATE INDEX IF NOT EXISTS idx_stock_items_code_lower ON stock_items(lower(code));

-- Índice composto para listagem com filtros
CREATE INDEX IF NOT EXISTS idx_stock_items_active_name ON stock_items(is_active, name);

-- Índices para joins frequentes
CREATE INDEX IF NOT EXISTS idx_person_inventories_stock_item_id ON person_inventories(stock_item_id);
CREATE INDEX IF NOT EXISTS idx_kit_items_kit_id ON kit_items(kit_id);
CREATE INDEX IF NOT EXISTS idx_kit_items_stock_item_id ON kit_items(stock_item_id);
CREATE INDEX IF NOT EXISTS idx_withdrawal_items_lot_id ON withdrawal_items(lot_id);

-- Índice para ordenação de withdrawal_items
CREATE INDEX IF NOT EXISTS idx_withdrawal_items_created_at ON withdrawal_items(created_at DESC);

-- Índices compostos para queries comuns
CREATE INDEX IF NOT EXISTS idx_withdrawals_status_date ON withdrawals(status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_audit_logs_table_created ON audit_logs(table_name, created_at DESC);

-- Índice para pattern matching no código de retirada
CREATE INDEX IF NOT EXISTS idx_withdrawals_code_pattern ON withdrawals(code text_pattern_ops);

-- ============================================================================
-- 5. RLS POLICIES (SIMPLIFICADAS E PERFORMÁTICAS)
-- ============================================================================

-- Habilitar RLS em todas as tabelas
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

-- Remover policies antigas se existirem
DROP POLICY IF EXISTS "profiles_read_own" ON profiles;
DROP POLICY IF EXISTS "profiles_read_all_supervisor" ON profiles;
DROP POLICY IF EXISTS "profiles_update_own" ON profiles;
DROP POLICY IF EXISTS "people_all_authenticated" ON people;
DROP POLICY IF EXISTS "work_sites_all_authenticated" ON work_sites;
DROP POLICY IF EXISTS "stock_items_all_authenticated" ON stock_items;
DROP POLICY IF EXISTS "stock_item_lots_all_authenticated" ON stock_item_lots;
DROP POLICY IF EXISTS "kits_all_authenticated" ON kits;
DROP POLICY IF EXISTS "kit_items_all_authenticated" ON kit_items;
DROP POLICY IF EXISTS "withdrawals_all_authenticated" ON withdrawals;
DROP POLICY IF EXISTS "withdrawal_items_all_authenticated" ON withdrawal_items;
DROP POLICY IF EXISTS "person_inventories_all_authenticated" ON person_inventories;
DROP POLICY IF EXISTS "audit_logs_select_authenticated" ON audit_logs;
DROP POLICY IF EXISTS "audit_logs_insert_system" ON audit_logs;
DROP POLICY IF EXISTS "profiles_select_active_supervisors" ON profiles;
DROP POLICY IF EXISTS "profiles_insert_own_supervisor" ON profiles;
DROP POLICY IF EXISTS "profiles_update_own_supervisor" ON profiles;
DROP POLICY IF EXISTS "people_all_active_supervisors" ON people;
DROP POLICY IF EXISTS "work_sites_all_active_supervisors" ON work_sites;
DROP POLICY IF EXISTS "stock_items_all_active_supervisors" ON stock_items;
DROP POLICY IF EXISTS "stock_item_lots_all_active_supervisors" ON stock_item_lots;
DROP POLICY IF EXISTS "kits_all_active_supervisors" ON kits;
DROP POLICY IF EXISTS "kit_items_all_active_supervisors" ON kit_items;
DROP POLICY IF EXISTS "withdrawals_all_active_supervisors" ON withdrawals;
DROP POLICY IF EXISTS "withdrawal_items_all_active_supervisors" ON withdrawal_items;
DROP POLICY IF EXISTS "person_inventories_all_active_supervisors" ON person_inventories;
DROP POLICY IF EXISTS "audit_logs_select_active_supervisors" ON audit_logs;
DROP POLICY IF EXISTS "audit_logs_insert_active_supervisors" ON audit_logs;

-- Profiles: acesso próprio (mais simples e rápido)
CREATE POLICY "profiles_access_own" ON profiles
  FOR ALL TO authenticated
  USING (id = auth.uid())
  WITH CHECK (id = auth.uid());

-- Outras tabelas: acesso livre para autenticados
-- NOTA: O controle de acesso é feito na aplicação
-- Isso elimina as subqueries pesadas que causavam lentidão
CREATE POLICY "people_all_auth" ON people
  FOR ALL TO authenticated
  USING (true)
  WITH CHECK (true);

CREATE POLICY "work_sites_all_auth" ON work_sites
  FOR ALL TO authenticated
  USING (true)
  WITH CHECK (true);

CREATE POLICY "stock_items_all_auth" ON stock_items
  FOR ALL TO authenticated
  USING (true)
  WITH CHECK (true);

CREATE POLICY "stock_item_lots_all_auth" ON stock_item_lots
  FOR ALL TO authenticated
  USING (true)
  WITH CHECK (true);

CREATE POLICY "kits_all_auth" ON kits
  FOR ALL TO authenticated
  USING (true)
  WITH CHECK (true);

CREATE POLICY "kit_items_all_auth" ON kit_items
  FOR ALL TO authenticated
  USING (true)
  WITH CHECK (true);

CREATE POLICY "withdrawals_all_auth" ON withdrawals
  FOR ALL TO authenticated
  USING (true)
  WITH CHECK (true);

CREATE POLICY "withdrawal_items_all_auth" ON withdrawal_items
  FOR ALL TO authenticated
  USING (true)
  WITH CHECK (true);

CREATE POLICY "person_inventories_all_auth" ON person_inventories
  FOR ALL TO authenticated
  USING (true)
  WITH CHECK (true);

CREATE POLICY "audit_logs_select_auth" ON audit_logs
  FOR SELECT TO authenticated
  USING (true);

CREATE POLICY "audit_logs_insert_auth" ON audit_logs
  FOR INSERT TO authenticated
  WITH CHECK (true);

-- ============================================================================
-- 6. FUNÇÕES
-- ============================================================================

-- Atualização automática de updated_at
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Geração de código de retirada
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

-- Deduzir estoque ao criar withdrawal_items
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
    RAISE EXCEPTION 'Insufficient stock for item %. Available: %, Requested: %',
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

-- Restaurar estoque ao rejeitar retirada
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

-- Audit log
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

-- Check low stock
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

-- ============================================================================
-- 7. TRIGGERS
-- ============================================================================

-- Atualização automática de updated_at
CREATE TRIGGER trg_profiles_updated_at
  BEFORE UPDATE ON profiles
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER trg_people_updated_at
  BEFORE UPDATE ON people
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER trg_work_sites_updated_at
  BEFORE UPDATE ON work_sites
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER trg_stock_items_updated_at
  BEFORE UPDATE ON stock_items
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER trg_kits_updated_at
  BEFORE UPDATE ON kits
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER trg_withdrawals_updated_at
  BEFORE UPDATE ON withdrawals
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER trg_person_inventories_updated_at
  BEFORE UPDATE ON person_inventories
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- Geração de código de retirada
CREATE TRIGGER trg_withdrawals_generate_code
  BEFORE INSERT ON withdrawals
  FOR EACH ROW EXECUTE FUNCTION generate_withdrawal_code();

-- Deduzir estoque
CREATE TRIGGER trg_withdrawal_items_stock_deduction
  AFTER INSERT ON withdrawal_items
  FOR EACH ROW EXECUTE FUNCTION handle_stock_deduction();

-- Restaurar estoque
CREATE TRIGGER trg_withdrawals_stock_restoration
  AFTER UPDATE ON withdrawals
  FOR EACH ROW EXECUTE FUNCTION handle_stock_restoration();

-- Audit triggers
CREATE TRIGGER trg_people_audit
  AFTER INSERT OR UPDATE OR DELETE ON people
  FOR EACH ROW EXECUTE FUNCTION log_audit();

CREATE TRIGGER trg_work_sites_audit
  AFTER INSERT OR UPDATE OR DELETE ON work_sites
  FOR EACH ROW EXECUTE FUNCTION log_audit();

CREATE TRIGGER trg_stock_items_audit
  AFTER INSERT OR UPDATE OR DELETE ON stock_items
  FOR EACH ROW EXECUTE FUNCTION log_audit();

CREATE TRIGGER trg_kits_audit
  AFTER INSERT OR UPDATE OR DELETE ON kits
  FOR EACH ROW EXECUTE FUNCTION log_audit();

CREATE TRIGGER trg_withdrawals_audit
  AFTER INSERT OR UPDATE OR DELETE ON withdrawals
  FOR EACH ROW EXECUTE FUNCTION log_audit();

CREATE TRIGGER trg_person_inventories_audit
  AFTER INSERT OR UPDATE OR DELETE ON person_inventories
  FOR EACH ROW EXECUTE FUNCTION log_audit();

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

COMMIT;

-- ============================================================================
-- INSTRUÇÕES DE USO:
-- ============================================================================
-- 1. Abra o SQL Editor do Supabase
-- 2. Cole este script completo
-- 3. Execute (o "COMMIT" no final garante que tudo será aplicado)
-- 4. Verifique se não houve erros
-- 5. Teste a aplicação - a lentidão deve ter desaparecido
-- ============================================================================
