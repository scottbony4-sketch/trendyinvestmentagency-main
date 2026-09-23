-- USD Bronze/Silver/Gold investment model.
-- Historical rows are preserved; only new plan activations use this model.

ALTER TABLE public.investments
  ADD COLUMN IF NOT EXISTS principal_amount numeric(14,6),
  ADD COLUMN IF NOT EXISTS plan_name text,
  ADD COLUMN IF NOT EXISTS currency text NOT NULL DEFAULT 'USD',
  ADD COLUMN IF NOT EXISTS profit_rate numeric(8,6),
  ADD COLUMN IF NOT EXISTS cycle_days integer,
  ADD COLUMN IF NOT EXISTS term_days integer,
  ADD COLUMN IF NOT EXISTS daily_profit numeric(14,6),
  ADD COLUMN IF NOT EXISTS weekly_profit numeric(14,6),
  ADD COLUMN IF NOT EXISTS total_accrued_profit numeric(14,6) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS total_paid_profit numeric(14,6) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS start_date date,
  ADD COLUMN IF NOT EXISTS maturity_date date,
  ADD COLUMN IF NOT EXISTS current_cycle_start date,
  ADD COLUMN IF NOT EXISTS current_cycle_end date;

ALTER TABLE public.withdrawals
  ADD COLUMN IF NOT EXISTS fee_amount numeric(14,6),
  ADD COLUMN IF NOT EXISTS net_amount numeric(14,6);

DROP VIEW IF EXISTS public.investment_repair_audit;

ALTER TABLE public.daily_earnings
  ALTER COLUMN amount TYPE numeric(14,6) USING amount::numeric(14,6);

ALTER TABLE public.investments DROP CONSTRAINT IF EXISTS investments_status_check;
ALTER TABLE public.investments ADD CONSTRAINT investments_status_check
  CHECK (status IN ('pending', 'active', 'completed', 'matured', 'paused', 'cancelled'));

ALTER TABLE public.app_settings
  ALTER COLUMN withdrawal_fee_percent SET DEFAULT 1;
UPDATE public.app_settings
SET withdrawal_fee_percent = 1,
    withdrawal_fee_enabled = true
WHERE id = 1;

ALTER TABLE public.referral_earnings DROP CONSTRAINT IF EXISTS referral_earnings_referred_unique;
ALTER TABLE public.referral_earnings
  ADD COLUMN IF NOT EXISTS level integer NOT NULL DEFAULT 1;
CREATE UNIQUE INDEX IF NOT EXISTS referral_earnings_deposit_referrer_level
  ON public.referral_earnings (deposit_id, referrer_id, level)
  WHERE deposit_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS public.investment_cycle_payouts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  investment_id uuid NOT NULL REFERENCES public.investments(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  cycle_number integer NOT NULL CHECK (cycle_number > 0),
  cycle_start date NOT NULL,
  cycle_end date NOT NULL,
  amount numeric(14,6) NOT NULL CHECK (amount >= 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (investment_id, cycle_number)
);
ALTER TABLE public.investment_cycle_payouts ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Users view own cycle payouts" ON public.investment_cycle_payouts;
CREATE POLICY "Users view own cycle payouts" ON public.investment_cycle_payouts
  FOR SELECT TO authenticated
  USING (auth.uid() = user_id OR public.has_role(auth.uid(), 'admin'));
GRANT SELECT ON public.investment_cycle_payouts TO authenticated;
GRANT ALL ON public.investment_cycle_payouts TO service_role;

INSERT INTO public.investment_plans
  (name, slug, description, duration_days, daily_return_percent, roi_percent, min_amount, max_amount, amount_presets, color, icon, sort_order, is_active)
VALUES
  ('Bronze', 'bronze', '90-day USD investment with 20% weekly profit.', 90, 20.0/7.0, 20, 100, 100, '[100]'::jsonb, '#CD7F32', 'sprout', 1, true),
  ('Silver', 'silver', '90-day USD investment with 20% weekly profit.', 90, 20.0/7.0, 20, 250, 250, '[250]'::jsonb, '#94A3B8', 'trending-up', 2, true),
  ('Gold', 'gold', '90-day USD investment with 20% weekly profit.', 90, 20.0/7.0, 20, 500, 500, '[500]'::jsonb, '#EAB308', 'crown', 3, true)
ON CONFLICT (slug) DO UPDATE SET
  name = EXCLUDED.name,
  description = EXCLUDED.description,
  duration_days = EXCLUDED.duration_days,
  daily_return_percent = EXCLUDED.daily_return_percent,
  roi_percent = EXCLUDED.roi_percent,
  min_amount = EXCLUDED.min_amount,
  max_amount = EXCLUDED.max_amount,
  amount_presets = EXCLUDED.amount_presets,
  sort_order = EXCLUDED.sort_order,
  is_active = true,
  updated_at = now();
UPDATE public.investment_plans SET is_active = false WHERE slug NOT IN ('bronze', 'silver', 'gold');

CREATE OR REPLACE FUNCTION public.usd_plan_snapshot(_plan_id uuid, _amount numeric)
RETURNS TABLE(plan_name text, principal numeric, profit_rate numeric, cycle_days integer, term_days integer, daily_profit numeric, weekly_profit numeric)
LANGUAGE plpgsql
STABLE
SET search_path = public
AS $$
DECLARE p public.investment_plans%ROWTYPE;
BEGIN
  SELECT * INTO p FROM public.investment_plans WHERE id = _plan_id AND slug IN ('bronze', 'silver', 'gold') AND is_active;
  IF p.id IS NULL THEN RAISE EXCEPTION 'USD investment plan not found'; END IF;
  IF _amount <> p.min_amount OR (_amount < p.min_amount) OR (p.max_amount IS NOT NULL AND _amount > p.max_amount) THEN
    RAISE EXCEPTION 'Investment amount must be exactly $%', p.min_amount;
  END IF;
  RETURN QUERY SELECT p.name, _amount, 20::numeric, 7, 90,
    (_amount * 0.20 / 7)::numeric(14,6), (_amount * 0.20)::numeric(14,6);
END;
$$;

CREATE OR REPLACE FUNCTION public.generate_daily_earnings()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE inv RECORD; day_no integer; start_day date; today_day date; amount numeric(14,6); inserted_count integer := 0; row_count integer;
BEGIN
  today_day := (now() AT TIME ZONE 'Africa/Nairobi')::date;
  FOR inv IN SELECT id, user_id, start_date, term_days, daily_profit FROM public.investments WHERE status = 'active' AND currency = 'USD' AND start_date IS NOT NULL LOOP
    FOR day_no IN 1..GREATEST(inv.term_days, 1) LOOP
      start_day := inv.start_date;
      IF start_day + (day_no - 1) > today_day THEN EXIT; END IF;
      amount := inv.daily_profit;
      INSERT INTO public.daily_earnings (investment_id, user_id, earning_date, amount, status, added_to_balance)
      VALUES (inv.id, inv.user_id, start_day + (day_no - 1), amount, 'pending', false)
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
DECLARE inv RECORD; cycle_no integer; cycle_start date; cycle_end date; payout numeric(14,6); inserted_count integer := 0; row_count integer; today_day date; elapsed_days integer;
BEGIN
  today_day := (now() AT TIME ZONE 'Africa/Nairobi')::date;
  PERFORM public.generate_daily_earnings();
  FOR inv IN SELECT * FROM public.investments WHERE status = 'active' AND currency = 'USD' AND start_date IS NOT NULL LOOP
    elapsed_days := today_day - inv.start_date + 1;
    FOR cycle_no IN 1..GREATEST(1, CEIL(elapsed_days / 7.0)::integer) LOOP
      cycle_start := inv.start_date + ((cycle_no - 1) * 7);
      cycle_end := LEAST(inv.start_date + inv.term_days - 1, cycle_start + 6);
      IF cycle_end > today_day OR cycle_start > inv.start_date + inv.term_days - 1 THEN EXIT; END IF;
      SELECT COALESCE(SUM(amount), 0) INTO payout FROM public.daily_earnings WHERE investment_id = inv.id AND earning_date BETWEEN cycle_start AND cycle_end;
      IF payout <= 0 THEN CONTINUE; END IF;
      INSERT INTO public.investment_cycle_payouts (investment_id, user_id, cycle_number, cycle_start, cycle_end, amount)
      VALUES (inv.id, inv.user_id, cycle_no, cycle_start, cycle_end, payout)
      ON CONFLICT (investment_id, cycle_number) DO NOTHING;
      GET DIAGNOSTICS row_count = ROW_COUNT;
      IF row_count = 1 THEN
        UPDATE public.daily_earnings SET added_to_balance = true, status = 'released'
        WHERE investment_id = inv.id AND earning_date BETWEEN cycle_start AND cycle_end AND added_to_balance = false;
        UPDATE public.profiles SET balance = COALESCE(balance, 0) + payout WHERE id = inv.user_id;
        UPDATE public.investments SET total_accrued_profit = COALESCE(total_accrued_profit, 0) + payout, total_paid_profit = COALESCE(total_paid_profit, 0) + payout WHERE id = inv.id;
        INSERT INTO public.transactions (user_id, type, amount, status, reference, description, metadata)
        VALUES (inv.user_id, 'daily_earning', payout, 'completed', inv.id::text, '7-day investment profit paid', jsonb_build_object('investment_id', inv.id, 'cycle_number', cycle_no, 'cycle_start', cycle_start, 'cycle_end', cycle_end));
        inserted_count := inserted_count + 1;
      END IF;
    END LOOP;
  END LOOP;
  RETURN inserted_count;
END;
$$;

CREATE OR REPLACE FUNCTION public.mature_investments()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE inv RECORD; today_day date; maturity_profit numeric(14,6); inserted_count integer := 0;
BEGIN
  today_day := (now() AT TIME ZONE 'Africa/Nairobi')::date;
  PERFORM public.release_unlocked_daily_earnings();
  FOR inv IN SELECT * FROM public.investments WHERE status = 'active' AND currency = 'USD' AND maturity_date <= today_day FOR UPDATE LOOP
    UPDATE public.investments SET status = 'matured' WHERE id = inv.id AND status = 'active';
    IF FOUND THEN
      UPDATE public.profiles SET balance = COALESCE(balance, 0) + inv.principal_amount WHERE id = inv.user_id;
      INSERT INTO public.transactions (user_id, type, amount, status, reference, description, metadata)
      VALUES (inv.user_id, 'investment_maturity', inv.principal_amount, 'completed', inv.id::text, 'Investment principal unlocked at maturity', jsonb_build_object('investment_id', inv.id, 'maturity_date', inv.maturity_date));
      inserted_count := inserted_count + 1;
    END IF;
  END LOOP;
  RETURN inserted_count;
END;
$$;

CREATE OR REPLACE FUNCTION public.activate_deposit()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE s RECORD; inv_id uuid; start_day date; maturity_day date; referrer uuid; level_two uuid; ref_amt numeric(14,6); existing uuid; referral_inserted integer;
BEGIN
  IF NEW.status = 'approved' AND OLD.status = 'pending' THEN
    SELECT id INTO existing FROM public.investments WHERE deposit_id = NEW.id LIMIT 1;
    IF existing IS NOT NULL THEN NEW.processed_at = COALESCE(NEW.processed_at, now()); RETURN NEW; END IF;
    SELECT * INTO s FROM public.usd_plan_snapshot(NEW.plan_id, NEW.amount);
    start_day := (now() AT TIME ZONE 'Africa/Nairobi')::date;
    maturity_day := start_day + s.term_days - 1;
    INSERT INTO public.investments (user_id, plan_id, plan_amount, principal_amount, plan_name, currency, daily_return, daily_profit, weekly_profit, duration_days, term_days, cycle_days, start_at, end_at, start_date, maturity_date, current_cycle_start, current_cycle_end, projected_payout, roi_percent, profit_rate, status, payment_source, deposit_id)
    VALUES (NEW.user_id, NEW.plan_id, s.principal, s.principal, s.plan_name, 'USD', s.daily_profit, s.daily_profit, s.weekly_profit, s.term_days, s.term_days, s.cycle_days, now(), now() + interval '90 days', start_day, maturity_day, start_day, start_day + 6, s.principal + (s.weekly_profit * s.term_days / s.cycle_days), s.profit_rate, s.profit_rate, 'active', 'mpesa', NEW.id)
    RETURNING id INTO inv_id;
    NEW.processed_at := now();
    INSERT INTO public.transactions (user_id, type, amount, status, reference, description, metadata) VALUES (NEW.user_id, 'deposit', NEW.amount, 'completed', NEW.mpesa_code, 'USD deposit approved', jsonb_build_object('currency','USD'));
    INSERT INTO public.transactions (user_id, type, amount, status, reference, description, metadata) VALUES (NEW.user_id, 'investment', NEW.amount, 'active', inv_id::text, 'USD investment started', jsonb_build_object('plan_id', NEW.plan_id, 'term_days', 90, 'cycle_days', 7));
    SELECT referred_by INTO referrer FROM public.profiles WHERE id = NEW.user_id;
    IF referrer IS NOT NULL AND referrer <> NEW.user_id THEN
      ref_amt := ROUND(NEW.amount * 0.20, 6);
      INSERT INTO public.referral_earnings (referrer_id, referred_id, deposit_id, amount, percent, level, status) VALUES (referrer, NEW.user_id, NEW.id, ref_amt, 20, 1, 'paid') ON CONFLICT DO NOTHING;
      GET DIAGNOSTICS referral_inserted = ROW_COUNT;
      IF referral_inserted = 1 THEN
        UPDATE public.profiles SET balance = COALESCE(balance, 0) + ref_amt WHERE id = referrer;
        INSERT INTO public.transactions (user_id, type, amount, status, description, metadata) VALUES (referrer, 'referral', ref_amt, 'completed', 'Level 1 referral commission', jsonb_build_object('deposit_id', NEW.id, 'level', 1, 'percent', 20));
      END IF;
      SELECT referred_by INTO level_two FROM public.profiles WHERE id = referrer;
      IF level_two IS NOT NULL AND level_two <> NEW.user_id AND level_two <> referrer THEN
        ref_amt := ROUND(NEW.amount * 0.03, 6);
        INSERT INTO public.referral_earnings (referrer_id, referred_id, deposit_id, amount, percent, level, status) VALUES (level_two, NEW.user_id, NEW.id, ref_amt, 3, 2, 'paid') ON CONFLICT DO NOTHING;
        GET DIAGNOSTICS referral_inserted = ROW_COUNT;
        IF referral_inserted = 1 THEN
          UPDATE public.profiles SET balance = COALESCE(balance, 0) + ref_amt WHERE id = level_two;
          INSERT INTO public.transactions (user_id, type, amount, status, description, metadata) VALUES (level_two, 'referral', ref_amt, 'completed', 'Level 2 referral commission', jsonb_build_object('deposit_id', NEW.id, 'level', 2, 'percent', 3));
        END IF;
      END IF;
    END IF;
  ELSIF NEW.status = 'rejected' AND OLD.status = 'pending' THEN
    NEW.processed_at := now();
  END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS activate_deposit ON public.deposits;
CREATE TRIGGER activate_deposit AFTER UPDATE OF status ON public.deposits FOR EACH ROW WHEN (OLD.status IS DISTINCT FROM NEW.status) EXECUTE FUNCTION public.activate_deposit();

CREATE OR REPLACE FUNCTION public.create_balance_investment(_plan_id uuid, _amount numeric)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE uid uuid := auth.uid(); prof public.profiles%ROWTYPE; s RECORD; inv_id uuid; start_day date;
BEGIN
  IF uid IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;
  SELECT * INTO prof FROM public.profiles WHERE id = uid FOR UPDATE;
  IF prof.balance < _amount THEN RAISE EXCEPTION 'Available USD balance is not enough'; END IF;
  SELECT * INTO s FROM public.usd_plan_snapshot(_plan_id, _amount);
  start_day := (now() AT TIME ZONE 'Africa/Nairobi')::date;
  UPDATE public.profiles SET balance = balance - _amount WHERE id = uid;
  INSERT INTO public.investments (user_id, plan_id, plan_amount, principal_amount, plan_name, currency, daily_return, daily_profit, weekly_profit, duration_days, term_days, cycle_days, start_at, end_at, start_date, maturity_date, current_cycle_start, current_cycle_end, projected_payout, roi_percent, profit_rate, status, payment_source)
  VALUES (uid, _plan_id, s.principal, s.principal, s.plan_name, 'USD', s.daily_profit, s.daily_profit, s.weekly_profit, 90, 90, 7, now(), now() + interval '90 days', start_day, start_day + 89, start_day, start_day + 6, s.principal + (s.weekly_profit * 90 / 7), 20, 20, 'active', 'balance') RETURNING id INTO inv_id;
  INSERT INTO public.transactions (user_id, type, amount, status, reference, description) VALUES (uid, 'investment', _amount, 'active', inv_id::text, 'USD reinvestment started');
  RETURN inv_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.validate_withdrawal_request()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE min_w numeric; open_over boolean; is_sunday boolean; available_balance numeric; pending_total numeric;
BEGIN
  NEW.fee_amount := ROUND(NEW.amount * 0.01, 6);
  NEW.net_amount := ROUND(NEW.amount - NEW.fee_amount, 6);
  SELECT min_withdrawal, withdrawals_open_override INTO min_w, open_over FROM public.app_settings WHERE id = 1;
  IF NEW.amount < COALESCE(min_w, 20) THEN RAISE EXCEPTION 'Minimum withdrawal is $%', COALESCE(min_w, 20); END IF;
  SELECT COALESCE(balance, 0) INTO available_balance FROM public.profiles WHERE id = NEW.user_id;
  SELECT COALESCE(SUM(amount), 0) INTO pending_total FROM public.withdrawals WHERE user_id = NEW.user_id AND status IN ('pending', 'approved');
  IF available_balance - pending_total < NEW.amount THEN RAISE EXCEPTION 'Your available USD balance is not enough for this withdrawal.'; END IF;
  is_sunday := EXTRACT(ISODOW FROM (now() AT TIME ZONE 'Africa/Nairobi')) = 7;
  IF open_over IS FALSE THEN RAISE EXCEPTION 'Withdrawals are currently closed by admin.'; ELSIF open_over IS NULL AND is_sunday THEN RAISE EXCEPTION 'Withdrawals are closed on Sundays.'; END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS validate_withdrawal ON public.withdrawals;
CREATE TRIGGER validate_withdrawal BEFORE INSERT ON public.withdrawals FOR EACH ROW EXECUTE FUNCTION public.validate_withdrawal_request();

GRANT EXECUTE ON FUNCTION public.usd_plan_snapshot(uuid, numeric) TO service_role;
GRANT EXECUTE ON FUNCTION public.generate_daily_earnings() TO service_role;
GRANT EXECUTE ON FUNCTION public.release_unlocked_daily_earnings() TO service_role;
GRANT EXECUTE ON FUNCTION public.mature_investments() TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.create_balance_investment(uuid, numeric) TO authenticated;

CREATE OR REPLACE VIEW public.investment_repair_audit AS
SELECT
  p.id AS user_id,
  p.full_name AS user_name,
  i.id AS investment_id,
  COALESCE(i.plan_name, pl.name) AS plan_name,
  COALESCE(i.principal_amount, i.plan_amount) AS investment_amount,
  COALESCE(i.profit_rate, i.roi_percent, pl.roi_percent, 0) AS plan_percentage,
  COALESCE(i.term_days, i.duration_days, pl.duration_days, 1) AS plan_duration,
  COALESCE(i.start_date, (i.start_at AT TIME ZONE 'Africa/Nairobi')::date) AS investment_start_date,
  CASE
    WHEN i.start_date IS NULL OR ((now() AT TIME ZONE 'Africa/Nairobi')::date) < i.start_date THEN 0
    ELSE LEAST(COALESCE(i.term_days, i.duration_days, 1), ((now() AT TIME ZONE 'Africa/Nairobi')::date - i.start_date) + 1)
  END AS completed_earning_days,
  COALESCE((SELECT SUM(de.amount) FROM public.daily_earnings de WHERE de.investment_id = i.id AND de.added_to_balance = TRUE AND de.status IN ('released', 'completed')), 0) AS actual_earnings_credited,
  COALESCE((SELECT SUM(w.amount) FROM public.withdrawals w WHERE w.user_id = p.id AND w.status IN ('approved', 'paid', 'completed')), 0) AS amount_withdrawn,
  p.balance AS current_stored_balance,
  p.balance AS correct_calculated_balance
FROM public.profiles p
JOIN public.investments i ON i.user_id = p.id
LEFT JOIN public.investment_plans pl ON pl.id = i.plan_id;
