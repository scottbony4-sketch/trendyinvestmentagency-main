-- Add mpesa_phone and payer_name to deposits so deposit form can collect them
ALTER TABLE public.deposits
  ADD COLUMN IF NOT EXISTS mpesa_phone text,
  ADD COLUMN IF NOT EXISTS payer_name text;

-- Ensure deposits table allows status values including 'pending','approved','rejected','under_review'
ALTER TABLE public.deposits DROP CONSTRAINT IF EXISTS deposits_status_check;
ALTER TABLE public.deposits ADD CONSTRAINT deposits_status_check
  CHECK (status IN ('pending','approved','rejected'));

-- Grant to authenticated role (keeps existing privileges)
GRANT SELECT, INSERT, UPDATE ON public.deposits TO authenticated;
