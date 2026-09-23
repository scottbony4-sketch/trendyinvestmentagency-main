-- Combined migration for TRENDY INVESTMENT AGENCY updates
-- 1) App settings: mpesa till, whatsapp number, branded defaults
UPDATE public.app_settings
SET
  mpesa_till = '4970892',
  whatsapp = '+447308516057',
  whatsapp_default_msg = 'Hello TRENDY INVESTMENT AGENCY, I need help with my account.',
  site_name = 'TRENDY INVESTMENT AGENCY'
WHERE id = 1;

-- 2) Add investments.payment_source column to distinguish 'mpesa' vs 'balance'
ALTER TABLE public.investments
  ADD COLUMN IF NOT EXISTS payment_source text NOT NULL DEFAULT 'mpesa';
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'investments_payment_source_check') THEN
    EXECUTE $$ALTER TABLE public.investments
      ADD CONSTRAINT investments_payment_source_check
      CHECK (payment_source IN ('mpesa','balance'))$$;
  END IF;
END;
$$;

-- 3) Prevent duplicate mpesa codes on deposits (safe add: only if no duplicates)
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'deposits_mpesa_code_unique') THEN
    IF NOT EXISTS (SELECT mpesa_code FROM public.deposits GROUP BY mpesa_code HAVING count(*) > 1) THEN
      EXECUTE 'ALTER TABLE public.deposits ADD CONSTRAINT deposits_mpesa_code_unique UNIQUE (mpesa_code)';
    ELSE
      RAISE NOTICE 'deposits.mpesa_code contains duplicates; clean them before adding unique constraint';
    END IF;
  END IF;
END;
$$;

-- 4) Prevent multiple referral earnings for the same referred user (one-time referral)
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'referral_earnings_referred_unique') THEN
    IF NOT EXISTS (SELECT referred_id FROM public.referral_earnings GROUP BY referred_id HAVING count(*) > 1) THEN
      EXECUTE 'ALTER TABLE public.referral_earnings ADD CONSTRAINT referral_earnings_referred_unique UNIQUE (referred_id)';
    ELSE
      RAISE NOTICE 'referral_earnings.referred_id contains duplicates; clean them before adding unique constraint';
    END IF;
  END IF;
END;
$$;

-- 5) daily_earnings table to store per-investment per-day earnings (prevent duplicates per day)
CREATE TABLE IF NOT EXISTS public.daily_earnings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  investment_id uuid NOT NULL REFERENCES public.investments(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  earning_date date NOT NULL,
  amount numeric(14,2) NOT NULL,
  added_to_balance boolean NOT NULL DEFAULT false,
  status text NOT NULL DEFAULT 'pending',
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS daily_earnings_unique_per_day ON public.daily_earnings (investment_id, earning_date);

-- 6) email_logs to store email notification history
CREATE TABLE IF NOT EXISTS public.email_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid REFERENCES auth.users(id),
  to_email text NOT NULL,
  subject text NOT NULL,
  body text NOT NULL,
  sent_at timestamptz DEFAULT now(),
  status text NOT NULL DEFAULT 'sent',
  meta jsonb DEFAULT '{}'::jsonb
);

-- 7) Update validate_withdrawal_request(): block Sundays only (Africa/Nairobi)
CREATE OR REPLACE FUNCTION public.validate_withdrawal_request()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  min_w numeric;
  open_over boolean;
  is_sunday boolean;
BEGIN
  SELECT min_withdrawal, withdrawals_open_override INTO min_w, open_over FROM public.app_settings WHERE id = 1;
  IF NEW.amount < COALESCE(min_w, 20) THEN
    RAISE EXCEPTION 'Minimum withdrawal is KSh %', COALESCE(min_w, 20);
  END IF;

  -- Only block Sundays (ISODOW = 7) in Africa/Nairobi
  is_sunday := (EXTRACT(ISODOW FROM (now() AT TIME ZONE 'Africa/Nairobi')) = 7);

  IF open_over IS FALSE THEN
    RAISE EXCEPTION 'Withdrawals are currently closed by admin';
  ELSIF open_over IS NULL AND is_sunday THEN
    RAISE EXCEPTION 'Withdrawals are closed on Sundays. Please request withdrawal from Monday to Saturday.';
  END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS validate_withdrawal ON public.withdrawals;
CREATE TRIGGER validate_withdrawal BEFORE INSERT ON public.withdrawals
  FOR EACH ROW EXECUTE FUNCTION public.validate_withdrawal_request();

-- 8) Overwrite activate_deposit to award referral only on first approved deposit and create investment with whole-number daily returns
CREATE OR REPLACE FUNCTION public.activate_deposit()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  inv_id uuid; plan_rec RECORD;
  p_roi numeric(6,2); p_days integer; projected numeric(14,2); p_daily numeric(14,2);
  referrer uuid; ref_pct numeric(5,2); ref_amt numeric(14,2);
  prior_approved_count int;
BEGIN
  IF NEW.status = 'approved' AND OLD.status = 'pending' THEN
    IF NEW.plan_id IS NOT NULL THEN
      SELECT * INTO plan_rec FROM public.investment_plans WHERE id = NEW.plan_id;
      p_roi := COALESCE(plan_rec.roi_percent, 20);
      p_days := COALESCE(plan_rec.duration_days, 7);
    ELSE
      p_roi := 20; p_days := 7;
    END IF;

    projected := FLOOR(NEW.amount * (1 + p_roi/100.0));
    p_daily := FLOOR((projected - NEW.amount) / GREATEST(p_days,1));
    -- ensure daily_return at least 0
    IF p_daily < 0 THEN p_daily := 0; END IF;

    INSERT INTO public.investments (user_id, plan_id, plan_amount, daily_return, duration_days, start_at, end_at, projected_payout, roi_percent, status, payment_source)
    VALUES (NEW.user_id, NEW.plan_id, NEW.amount, p_daily, p_days, now(), now() + (p_days || ' days')::interval, projected, p_roi, 'active', 'mpesa')
    RETURNING id INTO inv_id;

    NEW.processed_at = now();

    INSERT INTO public.transactions (user_id, type, amount, status, reference, description)
    VALUES (NEW.user_id, 'deposit', NEW.amount, 'completed', NEW.mpesa_code, 'Deposit approved');

    INSERT INTO public.transactions (user_id, type, amount, status, reference, description, metadata)
    VALUES (NEW.user_id, 'investment', NEW.amount, 'active', inv_id::text, 'Mining cycle started', jsonb_build_object('plan_id', NEW.plan_id, 'projected', projected));

    INSERT INTO public.notifications (user_id, type, title, body, link)
    VALUES (NEW.user_id, 'success', 'Deposit approved',
            'Your deposit of KSh ' || NEW.amount || ' has been approved. Projected payout KSh ' || projected || '.', '/dashboard');

    -- Award referral commission only if this is the referred user's first approved deposit
    SELECT referred_by INTO referrer FROM public.profiles WHERE id = NEW.user_id;
    IF referrer IS NOT NULL THEN
      SELECT COUNT(*) INTO prior_approved_count FROM public.deposits
        WHERE user_id = NEW.user_id AND status = 'approved' AND id <> NEW.id;
      IF prior_approved_count = 0 THEN
        SELECT referral_percent INTO ref_pct FROM public.app_settings WHERE id = 1;
        ref_pct := COALESCE(ref_pct, 10);
        ref_amt := FLOOR(NEW.amount * ref_pct / 100.0);
        IF ref_amt > 0 THEN
          UPDATE public.profiles SET balance = COALESCE(balance,0) + ref_amt WHERE id = referrer;
          INSERT INTO public.referral_earnings (referrer_id, referred_id, deposit_id, amount, percent, status)
            VALUES (referrer, NEW.user_id, NEW.id, ref_amt, ref_pct, 'pending');
          INSERT INTO public.transactions (user_id, type, amount, status, description, metadata)
            VALUES (referrer, 'referral', ref_amt, 'completed', 'Referral bonus (' || ref_pct || '% of KSh ' || NEW.amount || ')', jsonb_build_object('referred_id', NEW.user_id, 'deposit_id', NEW.id));
          INSERT INTO public.notifications (user_id, type, title, body, link)
            VALUES (referrer, 'success', 'Referral bonus earned', 'You earned KSh ' || ref_amt || ' from a referral deposit.', '/referrals');
        END IF;
      END IF;
    END IF;

  ELSIF NEW.status = 'rejected' AND OLD.status = 'pending' THEN
    NEW.processed_at = now();
    INSERT INTO public.transactions (user_id, type, amount, status, reference, description)
    VALUES (NEW.user_id, 'deposit', NEW.amount, 'rejected', NEW.mpesa_code, 'Deposit rejected');
    INSERT INTO public.notifications (user_id, type, title, body, link)
    VALUES (NEW.user_id, 'warning', 'Deposit rejected', COALESCE(NEW.admin_note, 'Your deposit was not approved.'), '/deposit');
  END IF;
  RETURN NEW;
END;
$$;

-- 9) Recreate trigger to use updated function
DROP TRIGGER IF EXISTS activate_deposit ON public.deposits;
DROP TRIGGER IF EXISTS deposit_status_update ON public.deposits;
CREATE TRIGGER activate_deposit
  AFTER UPDATE OF status ON public.deposits
  FOR EACH ROW WHEN (OLD.status IS DISTINCT FROM NEW.status)
  EXECUTE FUNCTION public.activate_deposit();

-- 10) Helpful indexes for admin searching/filtering
CREATE INDEX IF NOT EXISTS idx_deposits_user_status_created ON public.deposits (user_id, status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_withdrawals_user_status_created ON public.withdrawals (user_id, status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_investments_user_status ON public.investments (user_id, status);

-- End of migration. Review NOTICEs after running and resolve duplicates if reported.
