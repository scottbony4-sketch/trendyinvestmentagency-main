-- Apply plan-based withdrawal unlock rules for daily earnings and withdrawals.
-- Unlock dates are derived from the investment activation date, not maturity.

ALTER TABLE public.investments
  ADD COLUMN IF NOT EXISTS unlock_day integer;

UPDATE public.investments i
SET unlock_day = COALESCE(i.unlock_day, p.unlock_day)
FROM public.investment_plans p
WHERE i.plan_id = p.id
  AND i.unlock_day IS NULL;

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

CREATE OR REPLACE FUNCTION public.create_balance_investment(_plan_id uuid, _amount numeric)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  uid uuid := auth.uid();
  prof public.profiles%ROWTYPE;
  plan public.investment_plans%ROWTYPE;
  roi numeric;
  projected numeric;
  daily_return numeric;
  inv_id uuid;
BEGIN
  IF uid IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  SELECT * INTO prof FROM public.profiles WHERE id = uid FOR UPDATE;
  IF prof IS NULL THEN
    RAISE EXCEPTION 'User profile not found';
  END IF;
  IF prof.deleted_at IS NOT NULL OR prof.status = 'suspended' THEN
    RAISE EXCEPTION 'Your account is not eligible to reinvest.';
  END IF;
  IF prof.balance < _amount THEN
    RAISE EXCEPTION 'Your available balance is not enough for this mining plan.';
  END IF;

  SELECT * INTO plan FROM public.investment_plans WHERE id = _plan_id AND is_active;
  IF plan IS NULL THEN
    RAISE EXCEPTION 'Mining plan not found';
  END IF;
  IF _amount < plan.min_amount THEN
    RAISE EXCEPTION 'Minimum investment is KSh %', plan.min_amount;
  END IF;
  IF plan.max_amount IS NOT NULL AND _amount > plan.max_amount THEN
    RAISE EXCEPTION 'Maximum investment is KSh %', plan.max_amount;
  END IF;

  roi := COALESCE(plan.roi_percent, plan.daily_return_percent * plan.duration_days);
  projected := FLOOR(_amount * (1 + roi / 100));
  daily_return := FLOOR((projected - _amount) / GREATEST(plan.duration_days, 1));
  IF daily_return < 0 THEN
    daily_return := 0;
  END IF;

  UPDATE public.profiles
  SET balance = balance - _amount
  WHERE id = uid;

  INSERT INTO public.investments (
    user_id, plan_id, plan_amount, daily_return, duration_days,
    start_at, end_at, projected_payout, roi_percent, status, payment_source, unlock_day
  ) VALUES (
    uid, plan.id, _amount, daily_return, plan.duration_days,
    now(), now() + plan.duration_days * interval '1 day', projected, roi, 'active', 'balance', COALESCE(plan.unlock_day, CASE WHEN plan.duration_days <= 7 THEN 1 WHEN plan.duration_days <= 17 THEN 8 WHEN plan.duration_days <= 28 THEN 22 ELSE 1 END)
  ) RETURNING id INTO inv_id;

  INSERT INTO public.transactions (user_id, type, amount, status, reference, description, metadata)
  VALUES (
    uid, 'investment', _amount, 'active', inv_id::text,
    'Reinvestment from account balance',
    jsonb_build_object(
      'plan_id', plan.id,
      'payment_source', 'balance',
      'duration_days', plan.duration_days,
      'projected_payout', projected,
      'roi_percent', roi
    )
  );

  RETURN inv_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.validate_withdrawal_request()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  min_w numeric;
  open_over boolean;
  is_sunday boolean;
  available_balance numeric;
  pending_withdrawal_total numeric;
BEGIN
  SELECT min_withdrawal, withdrawals_open_override INTO min_w, open_over FROM public.app_settings WHERE id = 1;
  IF NEW.amount < COALESCE(min_w, 20) THEN
    RAISE EXCEPTION 'Minimum withdrawal is KSh %', COALESCE(min_w, 20);
  END IF;

  SELECT COALESCE(balance, 0) INTO available_balance FROM public.profiles WHERE id = NEW.user_id;

  SELECT COALESCE(SUM(amount), 0) INTO pending_withdrawal_total
  FROM public.withdrawals
  WHERE user_id = NEW.user_id
    AND status IN ('pending', 'approved');

  available_balance := available_balance - COALESCE(pending_withdrawal_total, 0);

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
