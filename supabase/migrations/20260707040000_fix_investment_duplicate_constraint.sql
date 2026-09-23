-- Make deposit approval idempotent so the same deposit cannot create multiple investments.

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

DROP TRIGGER IF EXISTS activate_deposit ON public.deposits;
DROP TRIGGER IF EXISTS deposit_status_update ON public.deposits;
CREATE TRIGGER activate_deposit
  BEFORE UPDATE OF status ON public.deposits
  FOR EACH ROW WHEN (OLD.status IS DISTINCT FROM NEW.status)
  EXECUTE FUNCTION public.activate_deposit();
