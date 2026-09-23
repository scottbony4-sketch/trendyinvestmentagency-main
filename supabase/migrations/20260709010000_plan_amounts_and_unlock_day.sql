-- Add plan-level amount presets and unlock day support for dynamic admin-managed mining plans.

ALTER TABLE public.investment_plans
  ADD COLUMN IF NOT EXISTS unlock_day integer DEFAULT 1,
  ADD COLUMN IF NOT EXISTS amount_presets jsonb DEFAULT '[]'::jsonb;

UPDATE public.investment_plans
SET unlock_day = COALESCE(unlock_day, CASE
  WHEN duration_days <= 7 THEN 1
  WHEN duration_days <= 17 THEN 10
  WHEN duration_days <= 28 THEN 21
  ELSE 1
END),
    amount_presets = COALESCE(amount_presets, jsonb_build_array(250, 500, 1000, 5000, 10000));

ALTER TABLE public.investment_plans
  ALTER COLUMN unlock_day SET DEFAULT 1,
  ALTER COLUMN amount_presets SET DEFAULT '[]'::jsonb;

ALTER TABLE public.investments
  ADD COLUMN IF NOT EXISTS unlock_day integer;

UPDATE public.investments i
SET unlock_day = COALESCE(i.unlock_day, p.unlock_day)
FROM public.investment_plans p
WHERE i.plan_id = p.id AND i.unlock_day IS NULL;

CREATE OR REPLACE FUNCTION public.admin_grant_plan(_target uuid, _amount numeric, _note text DEFAULT NULL, _plan_id uuid DEFAULT NULL)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  new_id uuid;
  plan_rec public.investment_plans%ROWTYPE;
  roi numeric;
  projected numeric;
  daily_return numeric;
  duration_days integer;
BEGIN
  IF NOT public.has_role(auth.uid(), 'admin') THEN
    RAISE EXCEPTION 'Not authorized';
  END IF;
  IF _amount <= 0 THEN
    RAISE EXCEPTION 'Amount must be positive';
  END IF;

  duration_days := 7;
  roi := 40;
  projected := FLOOR(_amount * (1 + roi / 100.0));
  daily_return := FLOOR((projected - _amount) / GREATEST(duration_days, 1));

  IF _plan_id IS NOT NULL THEN
    SELECT * INTO plan_rec FROM public.investment_plans WHERE id = _plan_id AND is_active;
    IF plan_rec.id IS NOT NULL THEN
      duration_days := COALESCE(plan_rec.duration_days, 7);
      roi := COALESCE(plan_rec.roi_percent, CASE WHEN duration_days <= 7 THEN 40 WHEN duration_days <= 17 THEN 80 ELSE 130 END);
      projected := FLOOR(_amount * (1 + roi / 100.0));
      daily_return := FLOOR((projected - _amount) / GREATEST(duration_days, 1));
    END IF;
  END IF;

  INSERT INTO public.investments (
    user_id, plan_id, plan_amount, daily_return, duration_days, projected_payout, roi_percent, status, payment_source, unlock_day
  )
  VALUES (
    _target, _plan_id, _amount, daily_return, duration_days, projected, roi, 'active', 'balance', COALESCE((SELECT unlock_day FROM public.investment_plans WHERE id = _plan_id), 1)
  ) RETURNING id INTO new_id;

  INSERT INTO public.admin_actions (admin_id, target_user_id, action, amount, note)
    VALUES (auth.uid(), _target, 'grant_plan', _amount, _note);

  RETURN new_id;
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
  released_count integer := 0;
BEGIN
  today_date := (now() AT TIME ZONE 'Africa/Nairobi')::date;

  FOR row_record IN
    SELECT de.id, de.investment_id, de.user_id, de.earning_date, de.amount, i.start_at, i.plan_id, i.unlock_day
    FROM public.daily_earnings de
    JOIN public.investments i ON i.id = de.investment_id
    WHERE de.added_to_balance = FALSE
      AND de.status = 'pending'
      AND de.earning_date <= today_date
      AND i.status IN ('active', 'completed')
  LOOP
    start_date := (row_record.start_at AT TIME ZONE 'Africa/Nairobi')::date;
    unlock_day := COALESCE(row_record.unlock_day, (SELECT unlock_day FROM public.investment_plans WHERE id = row_record.plan_id), 1);

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

GRANT EXECUTE ON FUNCTION public.admin_grant_plan(uuid, numeric, text, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.release_unlocked_daily_earnings() TO authenticated, anon;
