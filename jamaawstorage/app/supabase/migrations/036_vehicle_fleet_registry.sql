BEGIN;

CREATE TABLE IF NOT EXISTS public.vehicles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  code TEXT NOT NULL UNIQUE,
  plate TEXT NULL,
  model TEXT NOT NULL DEFAULT 'Shineray TLux T30 2025',
  color TEXT NULL,
  year INTEGER NULL,
  responsible_person_id UUID NULL REFERENCES public.people(id),
  photo_url TEXT NULL,
  document_url TEXT NULL,
  document_name TEXT NULL,
  notes TEXT NULL,
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_by UUID NULL REFERENCES public.profiles(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.vehicle_usage_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  vehicle_id UUID NOT NULL REFERENCES public.vehicles(id) ON DELETE CASCADE,
  responsible_person_id UUID NULL REFERENCES public.people(id),
  event_type TEXT NOT NULL CHECK (event_type IN ('pickup', 'return', 'fuel')),
  occurred_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  odometer_km NUMERIC NULL,
  fuel_level_percent INTEGER NULL CHECK (fuel_level_percent IS NULL OR (fuel_level_percent >= 0 AND fuel_level_percent <= 100)),
  fuel_liters NUMERIC NULL,
  fuel_amount NUMERIC NULL,
  station_name TEXT NULL,
  photo_url TEXT NULL,
  ocr_text TEXT NULL,
  ai_summary TEXT NULL,
  ai_confidence NUMERIC NULL,
  notes TEXT NULL,
  created_by UUID NULL REFERENCES public.profiles(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_vehicles_responsible_person
  ON public.vehicles(responsible_person_id)
  WHERE responsible_person_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_vehicle_usage_logs_vehicle
  ON public.vehicle_usage_logs(vehicle_id, occurred_at DESC);

CREATE INDEX IF NOT EXISTS idx_vehicle_usage_logs_event_type
  ON public.vehicle_usage_logs(event_type, occurred_at DESC);

ALTER TABLE public.vehicles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.vehicle_usage_logs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "vehicles_select_supervisor" ON public.vehicles;
CREATE POLICY "vehicles_select_supervisor" ON public.vehicles
FOR SELECT
USING ((SELECT public.is_active_supervisor()));

DROP POLICY IF EXISTS "vehicles_insert_supervisor" ON public.vehicles;
CREATE POLICY "vehicles_insert_supervisor" ON public.vehicles
FOR INSERT
WITH CHECK ((SELECT public.is_active_supervisor()));

DROP POLICY IF EXISTS "vehicles_update_supervisor" ON public.vehicles;
CREATE POLICY "vehicles_update_supervisor" ON public.vehicles
FOR UPDATE
USING ((SELECT public.is_active_supervisor()))
WITH CHECK ((SELECT public.is_active_supervisor()));

DROP POLICY IF EXISTS "vehicles_delete_supervisor" ON public.vehicles;
CREATE POLICY "vehicles_delete_supervisor" ON public.vehicles
FOR DELETE
USING ((SELECT public.is_active_supervisor()));

DROP POLICY IF EXISTS "vehicle_usage_logs_select_supervisor" ON public.vehicle_usage_logs;
CREATE POLICY "vehicle_usage_logs_select_supervisor" ON public.vehicle_usage_logs
FOR SELECT
USING ((SELECT public.is_active_supervisor()));

DROP POLICY IF EXISTS "vehicle_usage_logs_insert_supervisor" ON public.vehicle_usage_logs;
CREATE POLICY "vehicle_usage_logs_insert_supervisor" ON public.vehicle_usage_logs
FOR INSERT
WITH CHECK ((SELECT public.is_active_supervisor()));

DROP POLICY IF EXISTS "vehicle_usage_logs_update_supervisor" ON public.vehicle_usage_logs;
CREATE POLICY "vehicle_usage_logs_update_supervisor" ON public.vehicle_usage_logs
FOR UPDATE
USING ((SELECT public.is_active_supervisor()))
WITH CHECK ((SELECT public.is_active_supervisor()));

DROP TRIGGER IF EXISTS trg_vehicles_updated_at ON public.vehicles;
CREATE TRIGGER trg_vehicles_updated_at
  BEFORE UPDATE ON public.vehicles
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();

DROP TRIGGER IF EXISTS trg_vehicle_usage_logs_updated_at ON public.vehicle_usage_logs;
CREATE TRIGGER trg_vehicle_usage_logs_updated_at
  BEFORE UPDATE ON public.vehicle_usage_logs
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();

COMMIT;
