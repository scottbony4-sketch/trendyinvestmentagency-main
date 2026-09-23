-- Ensure referral commissions are only created (pending) on the referred user's first approved deposit.
-- Do NOT credit referrer balance until admin marks the referral as paid.

CREATE OR REPLACE FUNCTION public.activate_deposit()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  inv_id uuid; plan_rec RECORD;
  p_roi numeric(6,2); p_days integer; projected numeric(14,2); p_daily numeric(14,2);
  referrer uuid; ref_pct numeric(5,2); ref_amt numeric(14,2);
  prior_approved_count int;
BEGIN
  IF NEW.status = 'approved' AND OLD.status = 'pending' THEN
    IF NEW.plan_id IS NOT NULL THEN
      SELECT * INTO plan_rec FROM public.investment_plans WHERE id = NEW.plan_id;
      p_roi := COALESCE(plan_rec.roi_percent, 20);
      p_days := COALESCE(plan_rec.duration_days, 7);
    ELSE
      p_roi := 20; p_days := 7;
    END IF;

    projected := FLOOR(NEW.amount * (1 + p_roi/100.0));
    p_daily := FLOOR((projected - NEW.amount) / GREATEST(p_days,1));
    IF p_daily < 0 THEN p_daily := 0; END IF;

    INSERT INTO public.investments (user_id, plan_id, plan_amount, daily_return, duration_days, start_at, end_at, projected_payout, roi_percent, status, payment_source)
    VALUES (NEW.user_id, NEW.plan_id, NEW.amount, p_daily, p_days, now(), now() + (p_days || ' days')::interval, projected, p_roi, 'active', 'mpesa')
    RETURNING id INTO inv_id;

    NEW.processed_at = now();

    INSERT INTO public.transactions (user_id, type, amount, status, reference, description)
    VALUES (NEW.user_id, 'deposit', NEW.amount, 'completed', NEW.mpesa_code, 'Deposit approved');

    INSERT INTO public.transactions (user_id, type, amount, status, reference, description, metadata)
    VALUES (NEW.user_id, 'investment', NEW.amount, 'active', inv_id::text, 'Mining cycle started', jsonb_build_object('plan_id', NEW.plan_id, 'projected', projected));

    INSERT INTO public.notifications (user_id, type, title, body, link)
    VALUES (NEW.user_id, 'success', 'Deposit approved',
            'Your deposit of KSh ' || NEW.amount || ' has been approved. Projected payout KSh ' || projected || '.', '/dashboard');

    -- Create referral commission only if this is the referred user's first approved deposit
    SELECT referred_by INTO referrer FROM public.profiles WHERE id = NEW.user_id;
    IF referrer IS NOT NULL THEN
      SELECT COUNT(*) INTO prior_approved_count FROM public.deposits
        WHERE user_id = NEW.user_id AND status = 'approved' AND id <> NEW.id;
      IF prior_approved_count = 0 THEN
        SELECT referral_percent INTO ref_pct FROM public.app_settings WHERE id = 1;
        ref_pct := COALESCE(ref_pct, 10);
        ref_amt := FLOOR(NEW.amount * ref_pct / 100.0);
        IF ref_amt > 0 THEN
          -- Do NOT credit balance yet. Create a pending referral_earnings record for admin review.
          INSERT INTO public.referral_earnings (referrer_id, referred_id, deposit_id, amount, percent, status, created_at)
            VALUES (referrer, NEW.user_id, NEW.id, ref_amt, ref_pct, 'pending', now());

          -- Record a pending transaction for audit. Will be set to 'completed' when admin marks paid.
          INSERT INTO public.transactions (user_id, type, amount, status, description, metadata)
            VALUES (referrer, 'referral', ref_amt, 'pending', 'Referral commission pending (' || ref_pct || '% of KSh ' || NEW.amount || ')', jsonb_build_object('referred_id', NEW.user_id, 'deposit_id', NEW.id));

          INSERT INTO public.notifications (user_id, type, title, body, link)
            VALUES (referrer, 'info', 'Referral bonus pending', 'You have a pending referral bonus of KSh ' || ref_amt || ' to review.', '/_authenticated/admin?tab=referrals');
        END IF;
      END IF;
    END IF;

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

-- Recreate trigger to use updated function
DROP TRIGGER IF EXISTS activate_deposit ON public.deposits;
DROP TRIGGER IF EXISTS deposit_status_update ON public.deposits;
CREATE TRIGGER activate_deposit
  AFTER UPDATE OF status ON public.deposits
  FOR EACH ROW WHEN (OLD.status IS DISTINCT FROM NEW.status)
  EXECUTE FUNCTION public.activate_deposit();
