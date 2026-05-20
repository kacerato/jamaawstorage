ALTER TABLE public.withdrawals
  ADD COLUMN IF NOT EXISTS photo_urls TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];

UPDATE public.withdrawals
SET photo_urls = ARRAY[photo_url]
WHERE photo_url IS NOT NULL
  AND COALESCE(array_length(photo_urls, 1), 0) = 0;
