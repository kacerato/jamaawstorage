BEGIN;

ALTER TABLE public.withdrawals
  ALTER COLUMN supervisor_signature DROP NOT NULL,
  ALTER COLUMN requester_signature DROP NOT NULL;

COMMIT;
