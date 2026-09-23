-- Backfill and release daily earnings for active investments created before
-- the USD start_date/daily_profit columns were populated.

CREATE OR REPLACE FUNCTION public.generate_daily_earnings()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  inv RECORD;
  day_no integer;
  today_day date;
  amount numeric(14,6);
  inserted_count integer := 0;
  row_count integer;
BEGIN
  today_day := (now() AT TIME ZONE 'Africa/Nairobi')::date;

  FOR inv IN
    SELECT
      id,
      user_id,
      COALESCE(start_date, (start_at AT TIME ZONE 'Africa/Nairobi')::date) AS start_day,
      GREATEST(COALESCE(term_days, duration_days, 90), 1) AS duration_days,
      COALESCE(
        daily_profit,
        daily_return,
        weekly_profit / NULLIF(cycle_days, 0),
        (plan_amount * COALESCE(roi_percent, 20) / 100.0) / 7.0
      ) AS daily_amount
    FROM public.investments
    WHERE status = 'active'
      AND (start_date IS NOT NULL OR start_at IS NOT NULL)
  LOOP
    FOR day_no IN 1..inv.duration_days LOOP
      IF inv.start_day + (day_no - 1) > today_day THEN
        EXIT;
      END IF;

      amount := inv.daily_amount;
      IF amount IS NULL OR amount <= 0 THEN
        CONTINUE;
      END IF;

      INSERT INTO public.daily_earnings (
        investment_id, user_id, earning_date, amount, status, added_to_balance
      )
      VALUES (
        inv.id, inv.user_id, inv.start_day + (day_no - 1), amount, 'pending', false
      )
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
  row_record RECORD;
  today_day date;
  released_count integer := 0;
BEGIN
  today_day := (now() AT TIME ZONE 'Africa/Nairobi')::date;
  PERFORM public.generate_daily_earnings();

  FOR row_record IN
    SELECT de.id, de.investment_id, de.user_id, de.earning_date, de.amount
    FROM public.daily_earnings AS de
    JOIN public.investments AS inv ON inv.id = de.investment_id
    WHERE de.added_to_balance = false
      AND de.earning_date <= today_day
      AND inv.status IN ('active', 'completed', 'matured')
    ORDER BY de.earning_date, de.id
    FOR UPDATE OF de
  LOOP
    UPDATE public.daily_earnings
    SET added_to_balance = true,
        status = 'released'
    WHERE id = row_record.id
      AND added_to_balance = false;

    IF FOUND THEN
      UPDATE public.profiles
      SET balance = COALESCE(balance, 0) + row_record.amount
      WHERE id = row_record.user_id;

      UPDATE public.investments
      SET total_accrued_profit = COALESCE(total_accrued_profit, 0) + row_record.amount,
          total_paid_profit = COALESCE(total_paid_profit, 0) + row_record.amount
      WHERE id = row_record.investment_id;

      INSERT INTO public.transactions (
        user_id, type, amount, status, reference, description, metadata
      )
      VALUES (
        row_record.user_id,
        'daily_earning',
        row_record.amount,
        'completed',
        row_record.investment_id::text,
        'Daily investment earning credited to balance',
        jsonb_build_object(
          'earning_id', row_record.id,
          'investment_id', row_record.investment_id,
          'earning_date', row_record.earning_date
        )
      );

      released_count := released_count + 1;
    END IF;
  END LOOP;

  RETURN released_count;
END;
$$;

-- Repair balances created by the legacy cycle-payout functions. Those functions
-- could record a released earning without leaving profiles.balance in sync.
CREATE OR REPLACE FUNCTION public.reconcile_available_balance()
RETURNS numeric
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  uid uuid := auth.uid();
  calculated_balance numeric;
BEGIN
  IF uid IS NULL THEN
    RAISE EXCEPTION 'Authentication required';
  END IF;

  SELECT COALESCE(SUM(
    CASE
      WHEN type IN ('deposit', 'daily_earning', 'referral', 'investment_maturity') THEN amount
      WHEN type IN ('investment', 'withdrawal') THEN -amount
      ELSE 0
    END
  ), 0)
  INTO calculated_balance
  FROM public.transactions
  WHERE user_id = uid
    AND status IN ('completed', 'active', 'paid');

  calculated_balance := calculated_balance - COALESCE((
    SELECT SUM(amount)
    FROM public.withdrawals
    WHERE user_id = uid
      AND status IN ('pending', 'approved', 'paid')
  ), 0);

  UPDATE public.profiles
  SET balance = calculated_balance
  WHERE id = uid;

  RETURN calculated_balance;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.generate_daily_earnings() FROM anon;
REVOKE EXECUTE ON FUNCTION public.release_unlocked_daily_earnings() FROM anon;
REVOKE EXECUTE ON FUNCTION public.reconcile_available_balance() FROM anon;
GRANT EXECUTE ON FUNCTION public.generate_daily_earnings() TO authenticated;
GRANT EXECUTE ON FUNCTION public.release_unlocked_daily_earnings() TO authenticated;
GRANT EXECUTE ON FUNCTION public.reconcile_available_balance() TO authenticated;
GRANT EXECUTE ON FUNCTION public.generate_daily_earnings() TO service_role;
GRANT EXECUTE ON FUNCTION public.release_unlocked_daily_earnings() TO service_role;
GRANT EXECUTE ON FUNCTION public.reconcile_available_balance() TO service_role;
