BEGIN;

-- Lock down SECURITY DEFINER functions to a fixed schema lookup.
ALTER FUNCTION public.adjust_stock_item_quantity(UUID, INTEGER)
  SET search_path = public;

ALTER FUNCTION public.create_completed_withdrawal(
  UUID,
  public.withdrawal_destination_type,
  UUID,
  UUID,
  UUID,
  TEXT,
  TEXT,
  TEXT,
  TEXT,
  TEXT,
  JSONB
)
  SET search_path = public;

ALTER FUNCTION public.update_stock_item_details_and_quantity(
  UUID,
  TEXT,
  TEXT,
  TEXT,
  TEXT,
  TEXT,
  INTEGER,
  TEXT,
  INTEGER
)
  SET search_path = public;

ALTER FUNCTION public.assign_inventory_item_to_person(UUID, UUID, INTEGER)
  SET search_path = public;

-- Ensure exposed RPCs are not callable through PUBLIC/anon by default.
REVOKE EXECUTE ON FUNCTION public.is_active_supervisor() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.is_active_supervisor() TO authenticated, service_role;

REVOKE EXECUTE ON FUNCTION public.create_supervisor_account(TEXT, TEXT, TEXT, TEXT, TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.create_supervisor_account(TEXT, TEXT, TEXT, TEXT, TEXT) TO authenticated, service_role;

REVOKE EXECUTE ON FUNCTION public.activate_supervisor_profile(UUID, TEXT, TEXT, TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.activate_supervisor_profile(UUID, TEXT, TEXT, TEXT) TO authenticated, service_role;

REVOKE EXECUTE ON FUNCTION public.adjust_stock_item_quantity(UUID, INTEGER) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.adjust_stock_item_quantity(UUID, INTEGER) TO authenticated, service_role;

REVOKE EXECUTE ON FUNCTION public.create_completed_withdrawal(
  UUID,
  public.withdrawal_destination_type,
  UUID,
  UUID,
  UUID,
  TEXT,
  TEXT,
  TEXT,
  TEXT,
  TEXT,
  JSONB
) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.create_completed_withdrawal(
  UUID,
  public.withdrawal_destination_type,
  UUID,
  UUID,
  UUID,
  TEXT,
  TEXT,
  TEXT,
  TEXT,
  TEXT,
  JSONB
) TO authenticated, service_role;

REVOKE EXECUTE ON FUNCTION public.update_stock_item_details_and_quantity(
  UUID,
  TEXT,
  TEXT,
  TEXT,
  TEXT,
  TEXT,
  INTEGER,
  TEXT,
  INTEGER
) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.update_stock_item_details_and_quantity(
  UUID,
  TEXT,
  TEXT,
  TEXT,
  TEXT,
  TEXT,
  INTEGER,
  TEXT,
  INTEGER
) TO authenticated, service_role;

REVOKE EXECUTE ON FUNCTION public.assign_inventory_item_to_person(UUID, UUID, INTEGER) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.assign_inventory_item_to_person(UUID, UUID, INTEGER) TO authenticated, service_role;

-- Trigger-only helper should not be directly callable from API roles.
REVOKE EXECUTE ON FUNCTION public.handle_new_user() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.handle_new_user() TO service_role;

COMMIT;
