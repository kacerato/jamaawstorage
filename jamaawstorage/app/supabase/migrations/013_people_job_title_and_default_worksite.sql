ALTER TABLE public.people
ADD COLUMN IF NOT EXISTS job_title TEXT;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'people_job_title_check'
      AND conrelid = 'public.people'::regclass
  ) THEN
    ALTER TABLE public.people
    ADD CONSTRAINT people_job_title_check
    CHECK (
      job_title IS NULL
      OR job_title IN ('cabista', 'ajudante de cabista')
    );
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_people_job_title ON public.people(job_title);

INSERT INTO public.work_sites (name, description, is_active)
SELECT
  'Obra',
  'Destino padrao para retiradas de uso coletivo',
  true
WHERE NOT EXISTS (
  SELECT 1
  FROM public.work_sites
  WHERE lower(name) = 'obra'
);
