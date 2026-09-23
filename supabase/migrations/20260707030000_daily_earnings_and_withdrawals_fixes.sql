-- Fix daily earnings release logic, duplicate protection, and access controls.
-- Keeps the system on whole-shilling KSh logic using Africa/Nairobi time.

ALTER TABLE public.deposits
  ADD COLUMN IF NOT EXISTS mpesa_code text,
  ADD COLUMN IF NOT EXISTS mpesa_phone text,
  ADD COLUMN IF NOT EXISTS payer_name text,
  ADD COLUMN IF NOT EXISTS processed_at timestamptz;

ALTER TABLE public.withdrawals
  ADD COLUMN IF NOT EXISTS mpesa_phone text,
  ADD COLUMN IF NOT EXISTS payout_mpesa_code text,
  ADD COLUMN IF NOT EXISTS processed_at timestamptz;

ALTER TABLE public.investments
  ADD COLUMN IF NOT EXISTS deposit_id uuid REFERENCES public.deposits(id) ON DELETE SET NULL;

CREATE UNIQUE INDEX IF NOT EXISTS idx_investments_deposit_id_unique
  ON public.investments (deposit_id)
  WHERE deposit_id IS NOT NULL;

ALTER TABLE public.daily_earnings
  ALTER COLUMN amount TYPE numeric(14,0) USING round(amount)::numeric(14,0);

DELETE FROM public.daily_earnings a
USING public.daily_earnings b
WHERE a.id > b.id
  AND a.investment_id = b.investment_id
  AND a.earning_date = b.earning_date;

CREATE UNIQUE INDEX IF NOT EXISTS daily_earnings_unique_per_day
  ON public.daily_earnings (investment_id, earning_date);

DROP POLICY IF EXISTS "Users can insert own daily earnings" ON public.daily_earnings;

REVOKE EXECUTE ON FUNCTION public.generate_daily_earnings() FROM authenticated, anon;
REVOKE EXECUTE ON FUNCTION public.release_unlocked_daily_earnings() FROM authenticated, anon;
GRANT EXECUTE ON FUNCTION public.generate_daily_earnings() TO service_role;
GRANT EXECUTE ON FUNCTION public.release_unlocked_daily_earnings() TO service_role;

CREATE OR REPLACE FUNCTION public.generate_daily_earnings()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  inv RECORD;
  total_profit numeric(14,0);
  base_daily numeric(14,0);
  remainder numeric(14,0);
  duration_days integer;
  start_date date;
  today_date date;
  earning_date date;
  day_index integer;
  inserted_count integer := 0;
  inserted_row_count integer := 0;
  amount numeric(14,0);
BEGIN
  today_date := (now() AT TIME ZONE 'Africa/Nairobi')::date;

  FOR inv IN
    SELECT i.id, i.user_id, i.plan_id, i.plan_amount, i.duration_days, i.start_at, i.end_at, i.projected_payout, i.status
    FROM public.investments i
    WHERE i.status = 'active'
      AND i.start_at IS NOT NULL
      AND (i.end_at IS NULL OR i.end_at >= now())
  LOOP
    duration_days := GREATEST(COALESCE(inv.duration_days, 1), 1);
    start_date := (inv.start_at AT TIME ZONE 'Africa/Nairobi')::date;

    total_profit := COALESCE(inv.projected_payout, 0) - COALESCE(inv.plan_amount, 0);
    IF total_profit < 0 THEN
      total_profit := 0;
    END IF;

    base_daily := FLOOR(total_profit / duration_days);
    remainder := total_profit - (base_daily * duration_days);

    FOR day_index IN 1..duration_days LOOP
      earning_date := start_date + (day_index - 1) * INTERVAL '1 day';
      IF earning_date > today_date THEN
        EXIT;
      END IF;

      amount := base_daily;
      IF day_index = duration_days THEN
        amount := base_daily + remainder;
      END IF;

      IF amount <= 0 THEN
        CONTINUE;
      END IF;

      INSERT INTO public.daily_earnings (investment_id, user_id, earning_date, amount, status)
      VALUES (inv.id, inv.user_id, earning_date, amount, 'pending')
      ON CONFLICT (investment_id, earning_date) DO NOTHING;

      GET DIAGNOSTICS inserted_row_count = ROW_COUNT;
      IF inserted_row_count > 0 THEN
        inserted_count := inserted_count + 1;
      END IF;
    END LOOP;
  END LOOP;

  RETURN inserted_count;
END;
$$;

CREATE OR REPLACE FUNCTION public.release_unlocked_daily_earnings()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  row_record RECORD;
  today_date date;
  start_date date;
  unlock_day integer;
  plan_duration integer;
  released_count integer := 0;
BEGIN
  today_date := (now() AT TIME ZONE 'Africa/Nairobi')::date;

  FOR row_record IN
    SELECT de.id, de.investment_id, de.user_id, de.earning_date, de.amount, i.start_at, i.plan_id, i.duration_days, i.unlock_day
    FROM public.daily_earnings de
    JOIN public.investments i ON i.id = de.investment_id
    WHERE de.added_to_balance = FALSE
      AND de.status = 'pending'
      AND de.earning_date <= today_date
      AND i.status IN ('active', 'completed')
  LOOP
    start_date := (row_record.start_at AT TIME ZONE 'Africa/Nairobi')::date;
    plan_duration := COALESCE(row_record.duration_days, (SELECT duration_days FROM public.investment_plans WHERE id = row_record.plan_id), 0);
    unlock_day := COALESCE(row_record.unlock_day, CASE
      WHEN plan_duration <= 7 THEN 1
      WHEN plan_duration <= 17 THEN 8
      WHEN plan_duration <= 28 THEN 22
      ELSE 1
    END);

    IF today_date >= start_date + (unlock_day - 1) THEN
      UPDATE public.daily_earnings
      SET added_to_balance = TRUE,
          status = 'released'
      WHERE id = row_record.id
        AND added_to_balance = FALSE
        AND status = 'pending';

      IF FOUND THEN
        UPDATE public.profiles
        SET balance = COALESCE(balance, 0) + row_record.amount
        WHERE id = row_record.user_id;

        INSERT INTO public.transactions (user_id, type, amount, status, description, metadata)
        VALUES (
          row_record.user_id,
          'daily_earning',
          row_record.amount,
          'completed',
          'Daily mining earning released',
          jsonb_build_object('earning_id', row_record.id, 'earning_date', row_record.earning_date)
        );

        released_count := released_count + 1;
      END IF;
    END IF;
  END LOOP;

  RETURN released_count;
END;
$$;

CREATE OR REPLACE FUNCTION public.activate_deposit()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  inv_id uuid; plan_rec RECORD;
  p_roi numeric(6,2); p_days integer; projected numeric(14,0); p_daily numeric(14,0);
  referrer uuid; ref_pct numeric(5,2); ref_amt numeric(14,0);
  prior_approved_count int;
  existing_inv_id uuid;
BEGIN
  IF NEW.status = 'approved' AND OLD.status = 'pending' THEN
    NEW.processed_at = now();

    SELECT id INTO existing_inv_id FROM public.investments WHERE deposit_id = NEW.id LIMIT 1;
    IF existing_inv_id IS NOT NULL THEN
      RETURN NEW;
    END IF;

    IF NEW.plan_id IS NOT NULL THEN
      SELECT * INTO plan_rec FROM public.investment_plans WHERE id = NEW.plan_id;
      p_roi := COALESCE(plan_rec.roi_percent, 20);
      p_days := COALESCE(plan_rec.duration_days, 7);
    ELSE
      p_roi := 20; p_days := 7;
    END IF;

    projected := FLOOR(NEW.amount * (1 + p_roi/100.0));
    p_daily := FLOOR((projected - NEW.amount) / GREATEST(p_days,1));
    IF p_daily < 0 THEN p_daily := 0; END IF;

    INSERT INTO public.investments (user_id, plan_id, plan_amount, daily_return, duration_days, start_at, end_at, projected_payout, roi_percent, status, payment_source, deposit_id)
    VALUES (NEW.user_id, NEW.plan_id, NEW.amount, p_daily, p_days, now(), now() + (p_days || ' days')::interval, projected, p_roi, 'active', 'mpesa', NEW.id)
    RETURNING id INTO inv_id;

    INSERT INTO public.transactions (user_id, type, amount, status, reference, description)
    VALUES (NEW.user_id, 'deposit', NEW.amount, 'completed', NEW.mpesa_code, 'Deposit approved');

    INSERT INTO public.transactions (user_id, type, amount, status, reference, description, metadata)
    VALUES (NEW.user_id, 'investment', NEW.amount, 'active', inv_id::text, 'Mining cycle started', jsonb_build_object('plan_id', NEW.plan_id, 'projected', projected));

    INSERT INTO public.notifications (user_id, type, title, body, link)
    VALUES (NEW.user_id, 'success', 'Deposit approved',
            'Your deposit of KSh ' || NEW.amount || ' has been approved. Projected payout KSh ' || projected || '.', '/dashboard');

    SELECT referred_by INTO referrer FROM public.profiles WHERE id = NEW.user_id;
    IF referrer IS NOT NULL THEN
      SELECT COUNT(*) INTO prior_approved_count FROM public.deposits
        WHERE user_id = NEW.user_id AND status = 'approved' AND id <> NEW.id;
      IF prior_approved_count = 0 THEN
        SELECT referral_percent INTO ref_pct FROM public.app_settings WHERE id = 1;
        ref_pct := COALESCE(ref_pct, 10);
        ref_amt := FLOOR(NEW.amount * ref_pct / 100.0);
        IF ref_amt > 0 THEN
          INSERT INTO public.referral_earnings (referrer_id, referred_id, deposit_id, amount, percent, status, created_at)
            VALUES (referrer, NEW.user_id, NEW.id, ref_amt, ref_pct, 'pending', now());

          INSERT INTO public.transactions (user_id, type, amount, status, description, metadata)
            VALUES (referrer, 'referral', ref_amt, 'pending', 'Referral commission pending (' || ref_pct || '% of KSh ' || NEW.amount || ')', jsonb_build_object('referred_id', NEW.user_id, 'deposit_id', NEW.id));

          INSERT INTO public.notifications (user_id, type, title, body, link)
            VALUES (referrer, 'info', 'Referral bonus pending', 'You have a pending referral bonus of KSh ' || ref_amt || ' to review.', '/_authenticated/admin?tab=referrals');
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

DROP TRIGGER IF EXISTS activate_deposit ON public.deposits;
DROP TRIGGER IF EXISTS deposit_status_update ON public.deposits;
CREATE TRIGGER activate_deposit
  BEFORE UPDATE OF status ON public.deposits
  FOR EACH ROW WHEN (OLD.status IS DISTINCT FROM NEW.status)
  EXECUTE FUNCTION public.activate_deposit();

CREATE OR REPLACE FUNCTION public.validate_withdrawal_request()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  min_w numeric;
  open_over boolean;
  is_sunday boolean;
  available_balance numeric;
BEGIN
  SELECT min_withdrawal, withdrawals_open_override INTO min_w, open_over FROM public.app_settings WHERE id = 1;
  IF NEW.amount < COALESCE(min_w, 20) THEN
    RAISE EXCEPTION 'Minimum withdrawal is KSh %', COALESCE(min_w, 20);
  END IF;

  SELECT COALESCE(balance, 0) INTO available_balance FROM public.profiles WHERE id = NEW.user_id;

  IF COALESCE(available_balance, 0) < NEW.amount THEN
    RAISE EXCEPTION 'Your available balance is not enough for this withdrawal.';
  END IF;

  is_sunday := (EXTRACT(ISODOW FROM (now() AT TIME ZONE 'Africa/Nairobi')) = 7);

  IF open_over IS FALSE THEN
    RAISE EXCEPTION 'Withdrawals are currently closed by admin.';
  ELSIF open_over IS NULL AND is_sunday THEN
    RAISE EXCEPTION 'Withdrawals are closed on Sundays. Please request withdrawal from Monday to Saturday.';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS validate_withdrawal ON public.withdrawals;
CREATE TRIGGER validate_withdrawal BEFORE INSERT ON public.withdrawals
  FOR EACH ROW EXECUTE FUNCTION public.validate_withdrawal_request();
