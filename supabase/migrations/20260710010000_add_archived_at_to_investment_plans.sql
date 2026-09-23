-- Add archived_at support for admin-managed mining plans.
ALTER TABLE public.investment_plans
  ADD COLUMN IF NOT EXISTS archived_at timestamptz;
