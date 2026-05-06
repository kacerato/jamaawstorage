BEGIN;

ALTER TABLE public.withdrawals
ADD COLUMN IF NOT EXISTS supervisor_signature_attachment_url TEXT,
ADD COLUMN IF NOT EXISTS supervisor_signature_attachment_name TEXT,
ADD COLUMN IF NOT EXISTS requester_signature_attachment_url TEXT,
ADD COLUMN IF NOT EXISTS requester_signature_attachment_name TEXT;

COMMIT;
