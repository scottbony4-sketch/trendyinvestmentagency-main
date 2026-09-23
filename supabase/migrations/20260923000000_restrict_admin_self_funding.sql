-- Prevent administrators from funding or investing in their own account.
DROP POLICY IF EXISTS "Insert own deposits" ON public.deposits;
CREATE POLICY "Insert own deposits"
  ON public.deposits
  FOR INSERT
  TO authenticated
  WITH CHECK (
    auth.uid() = user_id
    AND status = 'pending'
    AND NOT public.has_role(auth.uid(), 'admin')
  );

CREATE OR REPLACE FUNCTION public.create_balance_investment(_plan_id uuid, _amount numeric)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  uid uuid := auth.uid();
  prof public.profiles%ROWTYPE;
  s RECORD;
  inv_id uuid;
  start_day date;
BEGIN
  IF uid IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;
  IF public.has_role(uid, 'admin') THEN
    RAISE EXCEPTION 'Administrators cannot invest in their own account.';
  END IF;

  SELECT * INTO prof FROM public.profiles WHERE id = uid FOR UPDATE;
  IF prof.balance < _amount THEN RAISE EXCEPTION 'Available USD balance is not enough'; END IF;
  SELECT * INTO s FROM public.usd_plan_snapshot(_plan_id, _amount);
  start_day := (now() AT TIME ZONE 'Africa/Nairobi')::date;
  UPDATE public.profiles SET balance = balance - _amount WHERE id = uid;
  INSERT INTO public.investments (user_id, plan_id, plan_amount, principal_amount, plan_name, currency, daily_return, daily_profit, weekly_profit, duration_days, term_days, cycle_days, start_at, end_at, start_date, maturity_date, current_cycle_start, current_cycle_end, projected_payout, roi_percent, profit_rate, status, payment_source)
  VALUES (uid, _plan_id, s.principal, s.principal, s.plan_name, 'USD', s.daily_profit, s.daily_profit, s.weekly_profit, 90, 90, 7, now(), now() + interval '90 days', start_day, start_day + 89, start_day, start_day + 6, s.principal + (s.weekly_profit * 90 / 7), 20, 20, 'active', 'balance')
  RETURNING id INTO inv_id;
  INSERT INTO public.transactions (user_id, type, amount, status, reference, description)
  VALUES (uid, 'investment', _amount, 'active', inv_id::text, 'USD reinvestment started');
  RETURN inv_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.create_balance_investment(uuid, numeric) TO authenticated;
