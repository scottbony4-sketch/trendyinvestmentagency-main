CREATE OR REPLACE FUNCTION public.generate_daily_earnings()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  inv RECORD;
  day_no integer;
  earning_day date;
  amount numeric(14,6);
  inserted_count integer := 0;
  row_count integer;
BEGIN
  FOR inv IN
    SELECT
      id,
      user_id,
      COALESCE(start_at, start_date::timestamptz) AS started_at,
      COALESCE(term_days, duration_days, 90) AS duration_days,
      COALESCE(daily_profit, daily_return, weekly_profit / NULLIF(cycle_days, 0), (plan_amount * COALESCE(roi_percent, 20) / 100.0) / 7.0) AS daily_amount
    FROM public.investments
    WHERE status = 'active'
      AND (start_at IS NOT NULL OR start_date IS NOT NULL)
  LOOP
    FOR day_no IN 1..GREATEST(inv.duration_days, 1) LOOP
      EXIT WHEN now() < inv.started_at + (day_no * interval '1 day');
      amount := inv.daily_amount;
      IF amount IS NULL OR amount <= 0 THEN CONTINUE; END IF;

      earning_day := (inv.started_at + ((day_no - 1) * interval '1 day') AT TIME ZONE 'Africa/Nairobi')::date;
      INSERT INTO public.daily_earnings (investment_id, user_id, earning_date, amount, status, added_to_balance)
      VALUES (inv.id, inv.user_id, earning_day, amount, 'pending', false)
      ON CONFLICT (investment_id, earning_date) DO NOTHING;
      GET DIAGNOSTICS row_count = ROW_COUNT;
      inserted_count := inserted_count + row_count;
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
  earning RECORD;
  released_count integer := 0;
BEGIN
  PERFORM public.generate_daily_earnings();

  FOR earning IN
    SELECT de.id, de.investment_id, de.user_id, de.earning_date, de.amount,
           inv.start_at, inv.start_date
    FROM public.daily_earnings AS de
    JOIN public.investments AS inv ON inv.id = de.investment_id
    WHERE de.added_to_balance = false
      AND inv.status IN ('active', 'completed', 'matured')
      AND now() >= COALESCE(inv.start_at, inv.start_date::timestamptz)
        + ((de.earning_date - COALESCE(inv.start_date, (inv.start_at AT TIME ZONE 'Africa/Nairobi')::date) + 1) * interval '1 day')
    ORDER BY de.earning_date, de.id
    FOR UPDATE OF de
  LOOP
    UPDATE public.daily_earnings
    SET added_to_balance = true, status = 'released'
    WHERE id = earning.id AND added_to_balance = false;

    IF FOUND THEN
      UPDATE public.profiles SET balance = COALESCE(balance, 0) + earning.amount WHERE id = earning.user_id;
      UPDATE public.investments
      SET total_accrued_profit = COALESCE(total_accrued_profit, 0) + earning.amount,
          total_paid_profit = COALESCE(total_paid_profit, 0) + earning.amount
      WHERE id = earning.investment_id;
      INSERT INTO public.transactions (user_id, type, amount, status, reference, description, metadata)
      VALUES (earning.user_id, 'daily_earning', earning.amount, 'completed', earning.investment_id::text,
        'Daily investment earning credited to balance',
        jsonb_build_object('earning_id', earning.id, 'investment_id', earning.investment_id, 'earning_date', earning.earning_date));
      released_count := released_count + 1;
    END IF;
  END LOOP;

  RETURN released_count;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.generate_daily_earnings() FROM anon;
REVOKE EXECUTE ON FUNCTION public.release_unlocked_daily_earnings() FROM anon;
GRANT EXECUTE ON FUNCTION public.generate_daily_earnings() TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.release_unlocked_daily_earnings() TO authenticated, service_role;