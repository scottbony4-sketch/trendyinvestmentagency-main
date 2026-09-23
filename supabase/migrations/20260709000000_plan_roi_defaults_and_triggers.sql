-- Align mining plan ROI defaults and investment payout logic with the 40/80/130 rule.

ALTER TABLE public.investment_plans
  ALTER COLUMN roi_percent SET DEFAULT 40;

UPDATE public.investment_plans
SET
  name = CASE slug
    WHEN 'starter' THEN 'Starter'
    WHEN 'growth' THEN 'Growth'
    WHEN 'premium' THEN 'Premium'
    ELSE name
  END,
  description = CASE slug
    WHEN 'starter' THEN '7 days mining cycle · 40% total return.'
    WHEN 'growth' THEN '17 days mining cycle · 80% total return.'
    WHEN 'premium' THEN '28 days mining cycle · 130% total return.'
    ELSE description
  END,
  duration_days = CASE slug
    WHEN 'starter' THEN 7
    WHEN 'growth' THEN 17
    WHEN 'premium' THEN 28
    ELSE duration_days
  END,
  roi_percent = CASE slug
    WHEN 'starter' THEN 40
    WHEN 'growth' THEN 80
    WHEN 'premium' THEN 130
    ELSE COALESCE(roi_percent, CASE WHEN duration_days <= 7 THEN 40 WHEN duration_days <= 17 THEN 80 ELSE 130 END)
  END,
  daily_return_percent = CASE slug
    WHEN 'starter' THEN ROUND(40.0 / 7.0, 2)
    WHEN 'growth' THEN ROUND(80.0 / 17.0, 2)
    WHEN 'premium' THEN ROUND(130.0 / 28.0, 2)
    ELSE ROUND(COALESCE(roi_percent, CASE WHEN duration_days <= 7 THEN 40 WHEN duration_days <= 17 THEN 80 ELSE 130 END) / GREATEST(duration_days, 1), 2)
  END
WHERE slug IN ('starter', 'growth', 'premium');

UPDATE public.investment_plans
SET roi_percent = COALESCE(roi_percent, CASE WHEN duration_days <= 7 THEN 40 WHEN duration_days <= 17 THEN 80 ELSE 130 END),
    daily_return_percent = ROUND(COALESCE(roi_percent, CASE WHEN duration_days <= 7 THEN 40 WHEN duration_days <= 17 THEN 80 ELSE 130 END) / GREATEST(duration_days, 1), 2)
WHERE roi_percent IS NULL OR daily_return_percent IS NULL;

CREATE OR REPLACE FUNCTION public.activate_deposit()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  inv_id uuid;
  plan_rec RECORD;
  p_roi numeric(6,2);
  p_days integer;
  projected numeric(14,0);
  p_daily numeric(14,0);
  existing_inv_id uuid;
BEGIN
  IF NEW.status = 'approved' AND OLD.status = 'pending' THEN
    SELECT id INTO existing_inv_id
    FROM public.investments
    WHERE deposit_id = NEW.id
    LIMIT 1;

    IF existing_inv_id IS NOT NULL THEN
      NEW.processed_at = COALESCE(NEW.processed_at, now());
      RETURN NEW;
    END IF;

    IF NEW.plan_id IS NOT NULL THEN
      SELECT * INTO plan_rec FROM public.investment_plans WHERE id = NEW.plan_id;
      p_days := COALESCE(plan_rec.duration_days, 7);
      p_roi := COALESCE(plan_rec.roi_percent, CASE WHEN p_days <= 7 THEN 40 WHEN p_days <= 17 THEN 80 ELSE 130 END);
    ELSE
      p_days := 7;
      p_roi := 40;
    END IF;

    projected := FLOOR(NEW.amount * (1 + p_roi / 100.0));
    p_daily := FLOOR((projected - NEW.amount) / GREATEST(p_days, 1));
    IF p_daily < 0 THEN p_daily := 0; END IF;

    INSERT INTO public.investments (
      user_id, plan_id, plan_amount, daily_return, duration_days,
      start_at, end_at, projected_payout, roi_percent, status, payment_source, deposit_id
    )
    VALUES (
      NEW.user_id, NEW.plan_id, NEW.amount, p_daily, p_days,
      now(), now() + (p_days || ' days')::interval, projected, p_roi, 'active', 'mpesa', NEW.id
    )
    RETURNING id INTO inv_id;

    NEW.processed_at = now();

    INSERT INTO public.transactions (user_id, type, amount, status, reference, description)
    VALUES (NEW.user_id, 'deposit', NEW.amount, 'completed', NEW.mpesa_code, 'Deposit approved');

    INSERT INTO public.transactions (user_id, type, amount, status, reference, description, metadata)
    VALUES (
      NEW.user_id, 'investment', NEW.amount, 'active', inv_id::text,
      'Mining cycle started',
      jsonb_build_object('plan_id', NEW.plan_id, 'projected', projected)
    );

    INSERT INTO public.notifications (user_id, type, title, body, link)
    VALUES (
      NEW.user_id, 'success', 'Deposit approved',
      'Your deposit of KSh ' || NEW.amount || ' has been approved. Projected payout KSh ' || projected || '.', '/dashboard'
    );
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

CREATE OR REPLACE FUNCTION public.create_balance_investment(_plan_id uuid, _amount numeric)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
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

  roi := COALESCE(plan.roi_percent, CASE WHEN plan.duration_days <= 7 THEN 40 WHEN plan.duration_days <= 17 THEN 80 ELSE 130 END);
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
