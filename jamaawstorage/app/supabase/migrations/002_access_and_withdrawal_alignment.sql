-- ============================================================================
-- 1. ACCESS GRANTS
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

-- ============================================================================
-- 2. AUTHORIZATION HELPER
-- ============================================================================

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
IS 'Returns true when the current auth user has an active supervisor profile.';

-- ============================================================================
-- 3. RLS POLICIES
-- ============================================================================

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

CREATE POLICY "profiles_select_active_supervisors" ON profiles
  FOR SELECT TO authenticated
  USING (public.is_active_supervisor());

CREATE POLICY "profiles_insert_own_supervisor" ON profiles
  FOR INSERT TO authenticated
  WITH CHECK (id = auth.uid() AND role = 'supervisor');

CREATE POLICY "profiles_update_own_supervisor" ON profiles
  FOR UPDATE TO authenticated
  USING (id = auth.uid() AND public.is_active_supervisor())
  WITH CHECK (id = auth.uid() AND role = 'supervisor');

CREATE POLICY "people_all_active_supervisors" ON people
  FOR ALL TO authenticated
  USING (public.is_active_supervisor())
  WITH CHECK (public.is_active_supervisor());

CREATE POLICY "work_sites_all_active_supervisors" ON work_sites
  FOR ALL TO authenticated
  USING (public.is_active_supervisor())
  WITH CHECK (public.is_active_supervisor());

CREATE POLICY "stock_items_all_active_supervisors" ON stock_items
  FOR ALL TO authenticated
  USING (public.is_active_supervisor())
  WITH CHECK (public.is_active_supervisor());

CREATE POLICY "stock_item_lots_all_active_supervisors" ON stock_item_lots
  FOR ALL TO authenticated
  USING (public.is_active_supervisor())
  WITH CHECK (public.is_active_supervisor());

CREATE POLICY "kits_all_active_supervisors" ON kits
  FOR ALL TO authenticated
  USING (public.is_active_supervisor())
  WITH CHECK (public.is_active_supervisor());

CREATE POLICY "kit_items_all_active_supervisors" ON kit_items
  FOR ALL TO authenticated
  USING (public.is_active_supervisor())
  WITH CHECK (public.is_active_supervisor());

CREATE POLICY "withdrawals_all_active_supervisors" ON withdrawals
  FOR ALL TO authenticated
  USING (public.is_active_supervisor())
  WITH CHECK (public.is_active_supervisor());

CREATE POLICY "withdrawal_items_all_active_supervisors" ON withdrawal_items
  FOR ALL TO authenticated
  USING (public.is_active_supervisor())
  WITH CHECK (public.is_active_supervisor());

CREATE POLICY "person_inventories_all_active_supervisors" ON person_inventories
  FOR ALL TO authenticated
  USING (public.is_active_supervisor())
  WITH CHECK (public.is_active_supervisor());

CREATE POLICY "audit_logs_select_active_supervisors" ON audit_logs
  FOR SELECT TO authenticated
  USING (public.is_active_supervisor());

CREATE POLICY "audit_logs_insert_active_supervisors" ON audit_logs
  FOR INSERT TO authenticated
  WITH CHECK (public.is_active_supervisor());

-- ============================================================================
-- 4. WITHDRAWAL ENUM ALIGNMENT
-- ============================================================================

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM pg_enum e
    JOIN pg_type t ON t.oid = e.enumtypid
    WHERE t.typname = 'withdrawal_destination_type'
      AND e.enumlabel = 'worksite'
  ) AND NOT EXISTS (
    SELECT 1
    FROM pg_enum e
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
    SELECT 1
    FROM pg_enum e
    JOIN pg_type t ON t.oid = e.enumtypid
    WHERE t.typname = 'withdrawal_status'
      AND e.enumlabel = 'authorized'
  ) AND NOT EXISTS (
    SELECT 1
    FROM pg_enum e
    JOIN pg_type t ON t.oid = e.enumtypid
    WHERE t.typname = 'withdrawal_status'
      AND e.enumlabel = 'approved'
  ) THEN
    ALTER TYPE withdrawal_status RENAME VALUE 'authorized' TO 'approved';
  END IF;
END
$$;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM pg_enum e
    JOIN pg_type t ON t.oid = e.enumtypid
    WHERE t.typname = 'withdrawal_status'
      AND e.enumlabel = 'cancelled'
  ) AND NOT EXISTS (
    SELECT 1
    FROM pg_enum e
    JOIN pg_type t ON t.oid = e.enumtypid
    WHERE t.typname = 'withdrawal_status'
      AND e.enumlabel = 'rejected'
  ) THEN
    ALTER TYPE withdrawal_status RENAME VALUE 'cancelled' TO 'rejected';
  END IF;
END
$$;

ALTER TYPE withdrawal_status ADD VALUE IF NOT EXISTS 'completed';
ALTER TABLE withdrawals ALTER COLUMN status SET DEFAULT 'pending';

ALTER TABLE withdrawals DROP CONSTRAINT IF EXISTS withdrawals_destination_check;
ALTER TABLE withdrawals
  ADD CONSTRAINT withdrawals_destination_check
  CHECK (
    (destination_type = 'collaborator' AND collaborator_id IS NOT NULL)
    OR
    (destination_type = 'work_site' AND work_site_id IS NOT NULL)
  );

COMMENT ON TYPE withdrawal_destination_type
IS 'Where withdrawn items go: to a collaborator or to a work site';

COMMENT ON TYPE withdrawal_status
IS 'Withdrawal lifecycle: pending, approved, completed, or rejected';

-- ============================================================================
-- 5. TRIGGER FUNCTION ALIGNMENT
-- ============================================================================

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
