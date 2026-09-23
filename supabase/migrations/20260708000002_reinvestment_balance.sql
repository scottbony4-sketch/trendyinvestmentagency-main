-- Add support for reinvestment from available balance without admin deposit approval.
-- This migration is focused and preserves existing deposits and account flows.

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
    start_at, end_at, projected_payout, roi_percent, status, payment_source
  ) VALUES (
    uid, plan.id, _amount, daily_return, plan.duration_days,
    now(), now() + plan.duration_days * interval '1 day', projected, roi, 'active', 'balance'
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

GRANT EXECUTE ON FUNCTION public.create_balance_investment TO authenticated;

CREATE INDEX IF NOT EXISTS idx_investments_payment_source ON public.investments (payment_source);
