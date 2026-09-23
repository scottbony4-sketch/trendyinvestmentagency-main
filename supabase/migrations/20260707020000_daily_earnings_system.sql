-- Daily earning system for active mining cycles
-- Uses Africa/Nairobi timezone, whole shillings, and prevents duplicates per investment/day.

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
CREATE INDEX IF NOT EXISTS idx_daily_earnings_user_date ON public.daily_earnings (user_id, earning_date);

ALTER TABLE public.daily_earnings ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Users can view own daily earnings" ON public.daily_earnings;
CREATE POLICY "Users can view own daily earnings" ON public.daily_earnings
  FOR SELECT TO authenticated
  USING (auth.uid() = user_id OR public.has_role(auth.uid(), 'admin'));
DROP POLICY IF EXISTS "Users can insert own daily earnings" ON public.daily_earnings;
CREATE POLICY "Users can insert own daily earnings" ON public.daily_earnings
  FOR INSERT TO authenticated
  WITH CHECK (auth.uid() = user_id);
DROP POLICY IF EXISTS "Admins can manage daily earnings" ON public.daily_earnings;
CREATE POLICY "Admins can manage daily earnings" ON public.daily_earnings
  FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'admin'))
  WITH CHECK (public.has_role(auth.uid(), 'admin'));

GRANT SELECT, INSERT, UPDATE ON public.daily_earnings TO authenticated;
GRANT ALL ON public.daily_earnings TO service_role;

CREATE OR REPLACE FUNCTION public.generate_daily_earnings()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  inv RECORD;
  total_profit numeric(14,2);
  base_daily numeric(14,2);
  remainder numeric(14,2);
  duration_days integer;
  start_date date;
  today_date date;
  earning_date date;
  day_index integer;
  inserted_count integer := 0;
  inserted_row_count integer := 0;
  amount numeric(14,2);
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
  day_number integer;
  released_count integer := 0;
  plan_duration integer;
BEGIN
  today_date := (now() AT TIME ZONE 'Africa/Nairobi')::date;

  FOR row_record IN
    SELECT de.id, de.investment_id, de.user_id, de.earning_date, de.amount, i.start_at, i.plan_id
    FROM public.daily_earnings de
    JOIN public.investments i ON i.id = de.investment_id
    WHERE de.added_to_balance = FALSE
      AND de.status = 'pending'
      AND de.earning_date <= today_date
      AND i.status IN ('active', 'completed')
  LOOP
    start_date := (row_record.start_at AT TIME ZONE 'Africa/Nairobi')::date;
    day_number := ((row_record.earning_date - start_date)::integer) + 1;
    plan_duration := COALESCE((SELECT duration_days FROM public.investment_plans WHERE id = row_record.plan_id), 0);

    unlock_day := CASE
      WHEN plan_duration <= 7 THEN 1
      WHEN plan_duration <= 17 THEN 10
      WHEN plan_duration <= 28 THEN 21
      ELSE 1
    END;

    IF day_number <= unlock_day THEN
      UPDATE public.daily_earnings
      SET added_to_balance = TRUE,
          status = 'released'
      WHERE id = row_record.id;

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
  END LOOP;

  RETURN released_count;
END;
$$;

GRANT EXECUTE ON FUNCTION public.generate_daily_earnings() TO authenticated, anon;
GRANT EXECUTE ON FUNCTION public.release_unlocked_daily_earnings() TO authenticated, anon;
