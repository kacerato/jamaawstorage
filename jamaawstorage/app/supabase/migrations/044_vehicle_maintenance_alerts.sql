BEGIN;

CREATE TABLE IF NOT EXISTS public.vehicle_maintenance_alerts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  vehicle_id UUID NOT NULL REFERENCES public.vehicles(id) ON DELETE CASCADE,
  alert_type TEXT NOT NULL DEFAULT 'custom' CHECK (
    alert_type IN ('oil_change', 'scheduled_review', 'tires', 'brakes', 'document', 'custom')
  ),
  title TEXT NOT NULL,
  due_date DATE NULL,
  due_odometer_km NUMERIC NULL CHECK (due_odometer_km IS NULL OR due_odometer_km >= 0),
  advance_days INTEGER NOT NULL DEFAULT 7 CHECK (advance_days >= 0),
  advance_km NUMERIC NOT NULL DEFAULT 500 CHECK (advance_km >= 0),
  repeat_interval_days INTEGER NULL CHECK (repeat_interval_days IS NULL OR repeat_interval_days > 0),
  repeat_interval_km NUMERIC NULL CHECK (repeat_interval_km IS NULL OR repeat_interval_km > 0),
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'completed', 'disabled')),
  completed_at TIMESTAMPTZ NULL,
  completed_odometer_km NUMERIC NULL CHECK (completed_odometer_km IS NULL OR completed_odometer_km >= 0),
  notes TEXT NULL,
  created_by UUID NULL REFERENCES public.profiles(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT vehicle_maintenance_alerts_due_target_check CHECK (
    due_date IS NOT NULL OR due_odometer_km IS NOT NULL
  )
);

CREATE INDEX IF NOT EXISTS idx_vehicle_maintenance_alerts_vehicle_status
  ON public.vehicle_maintenance_alerts(vehicle_id, status, due_date, due_odometer_km);

CREATE INDEX IF NOT EXISTS idx_vehicle_maintenance_alerts_active_due_date
  ON public.vehicle_maintenance_alerts(due_date)
  WHERE status = 'active' AND due_date IS NOT NULL;

ALTER TABLE public.vehicle_maintenance_alerts ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "vehicle_maintenance_alerts_select_supervisor" ON public.vehicle_maintenance_alerts;
CREATE POLICY "vehicle_maintenance_alerts_select_supervisor" ON public.vehicle_maintenance_alerts
FOR SELECT
USING ((SELECT public.is_active_supervisor()));

DROP POLICY IF EXISTS "vehicle_maintenance_alerts_insert_supervisor" ON public.vehicle_maintenance_alerts;
CREATE POLICY "vehicle_maintenance_alerts_insert_supervisor" ON public.vehicle_maintenance_alerts
FOR INSERT
WITH CHECK ((SELECT public.is_active_supervisor()));

DROP POLICY IF EXISTS "vehicle_maintenance_alerts_update_supervisor" ON public.vehicle_maintenance_alerts;
CREATE POLICY "vehicle_maintenance_alerts_update_supervisor" ON public.vehicle_maintenance_alerts
FOR UPDATE
USING ((SELECT public.is_active_supervisor()))
WITH CHECK ((SELECT public.is_active_supervisor()));

DROP POLICY IF EXISTS "vehicle_maintenance_alerts_delete_supervisor" ON public.vehicle_maintenance_alerts;
CREATE POLICY "vehicle_maintenance_alerts_delete_supervisor" ON public.vehicle_maintenance_alerts
FOR DELETE
USING ((SELECT public.is_active_supervisor()));

DROP TRIGGER IF EXISTS trg_vehicle_maintenance_alerts_updated_at ON public.vehicle_maintenance_alerts;
CREATE TRIGGER trg_vehicle_maintenance_alerts_updated_at
  BEFORE UPDATE ON public.vehicle_maintenance_alerts
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();

COMMIT;
