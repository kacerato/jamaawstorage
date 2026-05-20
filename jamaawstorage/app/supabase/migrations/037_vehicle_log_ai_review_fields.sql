BEGIN;

ALTER TABLE public.vehicle_usage_logs
  ADD COLUMN IF NOT EXISTS fuel_level_range TEXT NULL CHECK (
    fuel_level_range IS NULL OR fuel_level_range IN ('reserva', 'baixo', 'meio', 'alto', 'cheio')
  ),
  ADD COLUMN IF NOT EXISTS needs_review BOOLEAN NOT NULL DEFAULT false;

CREATE INDEX IF NOT EXISTS idx_vehicle_usage_logs_needs_review
  ON public.vehicle_usage_logs(needs_review, occurred_at DESC)
  WHERE needs_review = true;

COMMIT;
