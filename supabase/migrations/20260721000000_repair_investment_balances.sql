-- Reconcile investment earnings, balances, and withdrawals for existing users.
-- This migration is idempotent and records every correction instead of deleting history.

ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS overpayment_balance numeric(14,2) NOT NULL DEFAULT 0;

CREATE TABLE IF NOT EXISTS public.balance_corrections (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  investment_id uuid REFERENCES public.investments(id) ON DELETE SET NULL,
  amount numeric(14,2) NOT NULL,
  correction_type text NOT NULL DEFAULT 'earnings',
  status text NOT NULL DEFAULT 'applied',
  reason text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb
);

CREATE INDEX IF NOT EXISTS idx_balance_corrections_user_created
  ON public.balance_corrections (user_id, created_at DESC);

CREATE OR REPLACE FUNCTION public.reconcile_investment_balances(_preview boolean DEFAULT true, _user_id uuid DEFAULT NULL)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  prof RECORD;
  inv RECORD;
  plan_rec RECORD;
  duration_days integer;
  plan_roi numeric(14,2);
  total_profit numeric(14,2);
  total_return numeric(14,2);
  base_daily numeric(14,2);
  remainder numeric(14,2);
  completed_days integer;
  expected_earnings numeric(14,2);
  actual_credited numeric(14,2);
  correction_amount numeric(14,2);
  stored_balance numeric(14,2);
  current_overpayment numeric(14,2);
  correction_reason text;
  correction_type text;
  start_date date;
  today_date date;
  day_index integer;
  day_amount numeric(14,2);
  correction_count integer := 0;
BEGIN
  today_date := (now() AT TIME ZONE 'Africa/Nairobi')::date;

  PERFORM public.generate_daily_earnings();

  FOR prof IN
    SELECT id, balance, overpayment_balance
    FROM public.profiles
    WHERE _user_id IS NULL OR id = _user_id
  LOOP
    stored_balance := COALESCE(prof.balance, 0);
    current_overpayment := COALESCE(prof.overpayment_balance, 0);

    FOR inv IN
      SELECT i.id, i.user_id, i.plan_id, i.plan_amount, i.duration_days, i.start_at, i.roi_percent, i.status
      FROM public.investments i
      WHERE i.user_id = prof.id
        AND i.status IN ('active', 'completed')
        AND i.start_at IS NOT NULL
    LOOP
      WITH ranked AS (
        SELECT id, row_number() OVER (
          PARTITION BY investment_id, earning_date
          ORDER BY created_at, id
        ) AS rn
        FROM public.daily_earnings
        WHERE investment_id = inv.id
      )
      UPDATE public.daily_earnings de
      SET status = CASE WHEN ranked.rn = 1 THEN de.status ELSE 'corrected' END,
          added_to_balance = FALSE
      FROM ranked
      WHERE de.id = ranked.id
        AND ranked.rn > 1;

      SELECT * INTO plan_rec
      FROM public.investment_plans
      WHERE id = inv.plan_id;

      duration_days := GREATEST(COALESCE(inv.duration_days, COALESCE(plan_rec.duration_days, 1), 1), 1);
      start_date := (inv.start_at AT TIME ZONE 'Africa/Nairobi')::date;

      plan_roi := COALESCE(
        inv.roi_percent,
        (SELECT p.roi_percent FROM public.investment_plans p WHERE p.id = inv.plan_id),
        CASE
          WHEN duration_days <= 7 THEN 40
          WHEN duration_days <= 17 THEN 80
          ELSE 130
        END
      );

      total_profit := ROUND(COALESCE(inv.plan_amount, 0) * (plan_roi / 100.0), 2);
      total_return := COALESCE(inv.plan_amount, 0) + total_profit;
      base_daily := FLOOR(total_return / duration_days);
      remainder := total_return - (base_daily * duration_days);

      completed_days := 0;
      IF today_date >= start_date THEN
        completed_days := LEAST(duration_days, (today_date - start_date) + 1);
      END IF;

      expected_earnings := 0;
      FOR day_index IN 1..completed_days LOOP
        day_amount := base_daily;
        IF day_index = duration_days THEN
          day_amount := base_daily + remainder;
        END IF;
        expected_earnings := expected_earnings + day_amount;
      END LOOP;

      SELECT COALESCE(SUM(amount), 0) INTO actual_credited
      FROM public.daily_earnings
      WHERE investment_id = inv.id
        AND added_to_balance = TRUE
        AND status IN ('released', 'completed');

      correction_amount := ROUND(expected_earnings - actual_credited, 2);

      IF correction_amount > 0 THEN
        correction_type := 'credit';
        correction_reason := 'underpaid investment earnings';
      ELSIF correction_amount < 0 THEN
        correction_type := 'debit';
        correction_reason := 'overpaid investment earnings';
      ELSE
        correction_type := NULL;
        correction_reason := NULL;
      END IF;

      IF correction_amount <> 0
         AND NOT EXISTS (
           SELECT 1
           FROM public.balance_corrections bc
           WHERE bc.user_id = prof.id
             AND bc.investment_id = inv.id
             AND bc.reason = correction_reason
             AND bc.status = 'applied'
         )
      THEN
        IF _preview IS FALSE THEN
          IF correction_type = 'credit' THEN
            IF current_overpayment > 0 THEN
              IF current_overpayment >= correction_amount THEN
                current_overpayment := current_overpayment - correction_amount;
                correction_amount := 0;
              ELSE
                correction_amount := correction_amount - current_overpayment;
                current_overpayment := 0;
              END IF;
            END IF;
            IF correction_amount > 0 THEN
              stored_balance := stored_balance + correction_amount;
            END IF;
          ELSE
            IF stored_balance >= ABS(correction_amount) THEN
              stored_balance := stored_balance - ABS(correction_amount);
            ELSE
              correction_amount := ABS(correction_amount) - stored_balance;
              stored_balance := 0;
              current_overpayment := current_overpayment + correction_amount;
            END IF;
          END IF;

          UPDATE public.profiles
          SET balance = stored_balance,
              overpayment_balance = current_overpayment
          WHERE id = prof.id;

          INSERT INTO public.transactions (
            user_id,
            type,
            amount,
            status,
            description,
            metadata
          )
          VALUES (
            prof.id,
            'balance_correction',
            ABS(correction_amount),
            'completed',
            'Balance correction following an automated earnings audit',
            jsonb_build_object(
              'investment_id', inv.id,
              'reason', correction_reason,
              'expected_earnings', expected_earnings,
              'actual_credited', actual_credited
            )
          );
        END IF;

        INSERT INTO public.balance_corrections (
          user_id,
          investment_id,
          amount,
          correction_type,
          status,
          reason,
          created_by,
          metadata
        )
        VALUES (
          prof.id,
          inv.id,
          ABS(correction_amount),
          COALESCE(correction_type, 'earnings'),
          'applied',
          COALESCE(correction_reason, 'investment earnings reconciliation'),
          NULL,
          jsonb_build_object(
            'expected_earnings', expected_earnings,
            'actual_credited', actual_credited,
            'preview', _preview
          )
        );

        correction_count := correction_count + 1;
      END IF;
    END LOOP;
  END LOOP;

  RETURN correction_count;
END;
$$;

GRANT EXECUTE ON FUNCTION public.reconcile_investment_balances(boolean, uuid) TO service_role;

CREATE OR REPLACE VIEW public.investment_repair_audit AS
SELECT
  p.id AS user_id,
  p.full_name AS user_name,
  i.id AS investment_id,
  pl.name AS plan_name,
  i.plan_amount AS investment_amount,
  COALESCE(i.roi_percent, pl.roi_percent, CASE
    WHEN GREATEST(COALESCE(i.duration_days, pl.duration_days, 7), 1) <= 7 THEN 40
    WHEN GREATEST(COALESCE(i.duration_days, pl.duration_days, 7), 1) <= 17 THEN 80
    ELSE 130
  END) AS plan_percentage,
  GREATEST(COALESCE(i.duration_days, pl.duration_days, 1), 1) AS plan_duration,
  i.start_at AS investment_start_date,
  CASE
    WHEN ((now() AT TIME ZONE 'Africa/Nairobi')::date) < (i.start_at AT TIME ZONE 'Africa/Nairobi')::date THEN 0
    ELSE LEAST(GREATEST(COALESCE(i.duration_days, pl.duration_days, 1), 1), (((now() AT TIME ZONE 'Africa/Nairobi')::date) - ((i.start_at AT TIME ZONE 'Africa/Nairobi')::date)) + 1)
  END AS completed_earning_days,
  ROUND(
    CASE
      WHEN GREATEST(COALESCE(i.duration_days, pl.duration_days, 1), 1) <= 0 THEN 0
      WHEN ((now() AT TIME ZONE 'Africa/Nairobi')::date) < (i.start_at AT TIME ZONE 'Africa/Nairobi')::date THEN 0
      ELSE (
        ROUND(COALESCE(i.plan_amount, 0) * (COALESCE(i.roi_percent, pl.roi_percent, CASE
          WHEN GREATEST(COALESCE(i.duration_days, pl.duration_days, 7), 1) <= 7 THEN 40
          WHEN GREATEST(COALESCE(i.duration_days, pl.duration_days, 7), 1) <= 17 THEN 80
          ELSE 130
        END) / 100.0), 2)
      )
    END,
    2
  ) AS expected_earnings_to_date,
  COALESCE((
    SELECT SUM(de.amount)
    FROM public.daily_earnings de
    WHERE de.investment_id = i.id
      AND de.added_to_balance = TRUE
      AND de.status IN ('released', 'completed')
  ), 0) AS actual_earnings_credited,
  COALESCE((
    SELECT SUM(w.amount)
    FROM public.withdrawals w
    WHERE w.user_id = p.id
      AND w.status IN ('approved', 'paid', 'completed')
  ), 0) AS amount_withdrawn,
  p.balance AS current_stored_balance,
  p.balance AS correct_calculated_balance
FROM public.profiles p
JOIN public.investments i ON i.user_id = p.id
LEFT JOIN public.investment_plans pl ON pl.id = i.plan_id;
