BEGIN;

ALTER TABLE public.vehicle_usage_logs
  ADD COLUMN IF NOT EXISTS fuel_bars_filled INTEGER NULL CHECK (
    fuel_bars_filled IS NULL OR fuel_bars_filled >= 0
  ),
  ADD COLUMN IF NOT EXISTS fuel_bars_total INTEGER NULL CHECK (
    fuel_bars_total IS NULL OR fuel_bars_total > 0
  );

DROP POLICY IF EXISTS "vehicle_usage_logs_delete_supervisor" ON public.vehicle_usage_logs;
CREATE POLICY "vehicle_usage_logs_delete_supervisor" ON public.vehicle_usage_logs
FOR DELETE
USING ((SELECT public.is_active_supervisor()));

COMMIT;
