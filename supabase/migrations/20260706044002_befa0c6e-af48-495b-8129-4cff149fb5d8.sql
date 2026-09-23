
-- 1. Plans: switch to time-based ROI (7d/20%, 17d/50%, 28d/100%)
ALTER TABLE public.investment_plans ADD COLUMN IF NOT EXISTS roi_percent numeric(6,2);

UPDATE public.investment_plans SET
  name='Starter', description='7 days mining cycle · 20% total return.',
  duration_days=7, roi_percent=20, daily_return_percent=ROUND(20.0/7, 2),
  min_amount=250, max_amount=10000, color='#22C55E', icon='sprout', sort_order=1, is_active=true
WHERE slug='starter';

UPDATE public.investment_plans SET
  name='Growth', description='17 days mining cycle · 50% total return.',
  duration_days=17, roi_percent=50, daily_return_percent=ROUND(50.0/17, 2),
  min_amount=250, max_amount=10000, color='#3B82F6', icon='trending-up', sort_order=2, is_active=true
WHERE slug='growth';

UPDATE public.investment_plans SET
  name='Premium', description='28 days mining cycle · 100% total return.',
  duration_days=28, roi_percent=100, daily_return_percent=ROUND(100.0/28, 2),
  min_amount=250, max_amount=10000, color='#EAB308', icon='crown', sort_order=3, is_active=true
WHERE slug='premium';

ALTER TABLE public.investment_plans ALTER COLUMN roi_percent SET DEFAULT 20;
UPDATE public.investment_plans SET roi_percent = COALESCE(roi_percent, daily_return_percent * duration_days);
ALTER TABLE public.investment_plans ALTER COLUMN roi_percent SET NOT NULL;

-- 2. Investments: time-based cycle
ALTER TABLE public.investments
  ADD COLUMN IF NOT EXISTS start_at timestamptz NOT NULL DEFAULT now(),
  ADD COLUMN IF NOT EXISTS end_at timestamptz,
  ADD COLUMN IF NOT EXISTS projected_payout numeric(14,2),
  ADD COLUMN IF NOT EXISTS roi_percent numeric(6,2);

UPDATE public.investments SET
  end_at = COALESCE(end_at, start_at + (duration_days || ' days')::interval),
  projected_payout = COALESCE(projected_payout, plan_amount + daily_return * duration_days),
  roi_percent = COALESCE(roi_percent, CASE WHEN plan_amount>0 THEN (daily_return*duration_days/plan_amount)*100 ELSE 20 END);

ALTER TABLE public.investments DROP CONSTRAINT IF EXISTS investments_status_check;
ALTER TABLE public.investments ADD CONSTRAINT investments_status_check
  CHECK (status IN ('pending','active','completed','paused','cancelled'));

-- 3. Withdrawals: add 'paid' status
ALTER TABLE public.withdrawals DROP CONSTRAINT IF EXISTS withdrawals_status_check;
ALTER TABLE public.withdrawals ADD CONSTRAINT withdrawals_status_check
  CHECK (status IN ('pending','approved','rejected','paid'));

-- 4. app_settings: withdrawal fee toggle, weekend override, site name, whatsapp defaults
ALTER TABLE public.app_settings
  ADD COLUMN IF NOT EXISTS withdrawal_fee_enabled boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS withdrawals_open_override boolean,
  ADD COLUMN IF NOT EXISTS site_name text NOT NULL DEFAULT 'TRENDY INVESTMENT AGENCY',
  ADD COLUMN IF NOT EXISTS whatsapp_default_msg text NOT NULL DEFAULT 'Hello TRENDY INVESTMENT AGENCY, I need help with my account.';

UPDATE public.app_settings SET
  min_withdrawal = 20,
  withdrawal_fee_percent = 20,
  withdrawal_fee_enabled = true,
  whatsapp = COALESCE(NULLIF(whatsapp,''), '0718757621'),
  site_name = 'TRENDY INVESTMENT AGENCY'
WHERE id = 1;

-- 5. profiles: soft delete
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS deleted_at timestamptz;

-- 6. referral_earnings: reward workflow
ALTER TABLE public.referral_earnings ADD COLUMN IF NOT EXISTS status text NOT NULL DEFAULT 'pending';
ALTER TABLE public.referral_earnings DROP CONSTRAINT IF EXISTS referral_earnings_status_check;
ALTER TABLE public.referral_earnings ADD CONSTRAINT referral_earnings_status_check
  CHECK (status IN ('pending','approved','rejected','paid'));

-- 7. Referral code generator based on first name
CREATE OR REPLACE FUNCTION public.gen_referral_code_from_name(_full_name text)
RETURNS text LANGUAGE plpgsql AS $$
DECLARE base text; suffix text; code text; tries int := 0;
BEGIN
  base := upper(regexp_replace(COALESCE(split_part(COALESCE(_full_name,''),' ',1), 'USER'), '[^A-Za-z]', '', 'g'));
  IF base = '' OR length(base) < 3 THEN base := 'USER'; END IF;
  IF length(base) > 8 THEN base := substr(base, 1, 8); END IF;
  LOOP
    suffix := lpad((floor(random()*9000)+1000)::int::text, 4, '0');
    code := base || suffix;
    EXIT WHEN NOT EXISTS (SELECT 1 FROM public.profiles WHERE referral_code = code);
    tries := tries + 1;
    IF tries > 25 THEN base := 'USER'; tries := 0; END IF;
  END LOOP;
  RETURN code;
END;
$$;

-- 8. handle_new_user: use firstname-based code, block self-referral, validate ref
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE ref_code text; referrer uuid; full_nm text;
BEGIN
  full_nm := COALESCE(NEW.raw_user_meta_data->>'full_name','');
  ref_code := public.gen_referral_code_from_name(full_nm);
  referrer := NULL;
  IF NEW.raw_user_meta_data ? 'referral_code' AND length(COALESCE(NEW.raw_user_meta_data->>'referral_code','')) > 0 THEN
    SELECT id INTO referrer FROM public.profiles
      WHERE referral_code = upper(NEW.raw_user_meta_data->>'referral_code')
        AND deleted_at IS NULL AND id <> NEW.id
      LIMIT 1;
  END IF;
  INSERT INTO public.profiles (id, full_name, phone, referral_code, referred_by)
  VALUES (NEW.id, full_nm,
    COALESCE(NEW.raw_user_meta_data->>'phone',''),
    ref_code, referrer);
  INSERT INTO public.user_roles (user_id, role) VALUES (NEW.id, 'user');
  IF referrer IS NOT NULL THEN
    INSERT INTO public.referrals (referrer_id, referred_id) VALUES (referrer, NEW.id)
      ON CONFLICT (referred_id) DO NOTHING;
    INSERT INTO public.notifications (user_id, type, title, body, link)
      VALUES (referrer, 'success', 'New referral joined',
              'Someone signed up using your referral code.', '/referrals');
  END IF;
  RETURN NEW;
END;
$$;

-- 9. Backfill existing profiles to firstname-format codes
UPDATE public.profiles
SET referral_code = public.gen_referral_code_from_name(full_name)
WHERE referral_code IS NULL OR referral_code !~ '^[A-Z]+[0-9]{4}$';

-- 10. activate_deposit: use total roi_percent, populate cycle timestamps
CREATE OR REPLACE FUNCTION public.activate_deposit()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE
  inv_id uuid; plan_rec RECORD;
  p_roi numeric(6,2); p_days integer; p_daily numeric(14,2); projected numeric(14,2);
  referrer uuid; ref_pct numeric(5,2); ref_amt numeric(14,2);
BEGIN
  IF NEW.status = 'approved' AND OLD.status = 'pending' THEN
    IF NEW.plan_id IS NOT NULL THEN
      SELECT * INTO plan_rec FROM public.investment_plans WHERE id = NEW.plan_id;
      p_roi := COALESCE(plan_rec.roi_percent, 20);
      p_days := COALESCE(plan_rec.duration_days, 7);
    ELSE
      p_roi := 20; p_days := 7;
    END IF;
    projected := ROUND(NEW.amount * (1 + p_roi/100.0));
    p_daily := ROUND(projected / GREATEST(p_days,1));

    INSERT INTO public.investments (user_id, plan_id, plan_amount, daily_return, duration_days,
      start_at, end_at, projected_payout, roi_percent, status)
    VALUES (NEW.user_id, NEW.plan_id, NEW.amount, p_daily, p_days,
      now(), now() + (p_days || ' days')::interval, projected, p_roi, 'active')
    RETURNING id INTO inv_id;

    NEW.processed_at = now();

    INSERT INTO public.transactions (user_id, type, amount, status, reference, description)
    VALUES (NEW.user_id, 'deposit', NEW.amount, 'completed', NEW.mpesa_code, 'Deposit approved');
    INSERT INTO public.transactions (user_id, type, amount, status, reference, description, metadata)
    VALUES (NEW.user_id, 'investment', NEW.amount, 'active', inv_id::text,
            'Mining cycle started', jsonb_build_object('plan_id', NEW.plan_id, 'projected', projected));
    INSERT INTO public.notifications (user_id, type, title, body, link)
    VALUES (NEW.user_id, 'success', 'Deposit approved',
            'Your KSh ' || NEW.amount || ' is now mining. Projected payout KSh ' || projected || '.', '/dashboard');

    SELECT referred_by INTO referrer FROM public.profiles WHERE id = NEW.user_id;
    IF referrer IS NOT NULL THEN
      SELECT referral_percent INTO ref_pct FROM public.app_settings WHERE id = 1;
      ref_pct := COALESCE(ref_pct, 10);
      ref_amt := ROUND(NEW.amount * ref_pct / 100.0);
      IF ref_amt > 0 THEN
        UPDATE public.profiles SET balance = balance + ref_amt WHERE id = referrer;
        INSERT INTO public.referral_earnings (referrer_id, referred_id, deposit_id, amount, percent, status)
        VALUES (referrer, NEW.user_id, NEW.id, ref_amt, ref_pct, 'approved');
        INSERT INTO public.transactions (user_id, type, amount, status, description, metadata)
        VALUES (referrer, 'referral', ref_amt, 'completed',
                'Referral bonus (' || ref_pct || '% of KSh ' || NEW.amount || ')',
                jsonb_build_object('referred_id', NEW.user_id, 'deposit_id', NEW.id));
        INSERT INTO public.notifications (user_id, type, title, body, link)
        VALUES (referrer, 'success', 'Referral bonus earned',
                'You earned KSh ' || ref_amt || ' from a referral deposit.', '/referrals');
      END IF;
    END IF;
  ELSIF NEW.status = 'rejected' AND OLD.status = 'pending' THEN
    NEW.processed_at = now();
    INSERT INTO public.transactions (user_id, type, amount, status, reference, description)
    VALUES (NEW.user_id, 'deposit', NEW.amount, 'rejected', NEW.mpesa_code, 'Deposit rejected');
    INSERT INTO public.notifications (user_id, type, title, body, link)
    VALUES (NEW.user_id, 'warning', 'Deposit rejected',
            COALESCE(NEW.admin_note, 'Your deposit was not approved.'), '/deposit');
  END IF;
  RETURN NEW;
END;
$$;

-- 11. Mature investments — auto-credit balance when cycle end date passes
CREATE OR REPLACE FUNCTION public.mature_investments()
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE inv RECORD; matured int := 0;
BEGIN
  FOR inv IN
    SELECT * FROM public.investments
    WHERE status='active' AND end_at IS NOT NULL AND end_at <= now()
    FOR UPDATE
  LOOP
    UPDATE public.investments
      SET status='completed', days_paid = duration_days, last_claim_at = now()
      WHERE id = inv.id;
    UPDATE public.profiles SET balance = balance + inv.projected_payout WHERE id = inv.user_id;
    INSERT INTO public.transactions (user_id, type, amount, status, reference, description)
    VALUES (inv.user_id, 'claim', inv.projected_payout, 'completed', inv.id::text, 'Mining cycle matured');
    INSERT INTO public.notifications (user_id, type, title, body, link)
    VALUES (inv.user_id, 'success', 'Mining cycle completed',
            'Your projected mining payout of KSh ' || inv.projected_payout || ' was added to your balance.', '/dashboard');
    matured := matured + 1;
  END LOOP;
  RETURN matured;
END;
$$;
GRANT EXECUTE ON FUNCTION public.mature_investments() TO authenticated, anon;

-- 12. Weekend / min-amount check for withdrawal requests
CREATE OR REPLACE FUNCTION public.validate_withdrawal_request()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE min_w numeric; open_over boolean; is_weekend boolean;
BEGIN
  SELECT min_withdrawal, withdrawals_open_override INTO min_w, open_over FROM public.app_settings WHERE id = 1;
  IF NEW.amount < COALESCE(min_w, 20) THEN
    RAISE EXCEPTION 'Minimum withdrawal is KSh %', COALESCE(min_w, 20);
  END IF;
  is_weekend := EXTRACT(ISODOW FROM (now() AT TIME ZONE 'Africa/Nairobi')) >= 6;
  IF open_over IS FALSE THEN
    RAISE EXCEPTION 'Withdrawals are currently closed by admin';
  ELSIF open_over IS NULL AND is_weekend THEN
    RAISE EXCEPTION 'Withdrawals are closed on Saturday and Sunday. Please request withdrawal from Monday to Friday.';
  END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS validate_withdrawal ON public.withdrawals;
CREATE TRIGGER validate_withdrawal BEFORE INSERT ON public.withdrawals
  FOR EACH ROW EXECUTE FUNCTION public.validate_withdrawal_request();

-- 13. Extend log_withdrawal_change to handle 'paid'
CREATE OR REPLACE FUNCTION public.log_withdrawal_change()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    INSERT INTO public.transactions (user_id, type, amount, status, reference, description)
    VALUES (NEW.user_id, 'withdrawal', NEW.amount, 'pending', NEW.mpesa_phone, 'Withdrawal requested');
    RETURN NEW;
  END IF;
  IF NEW.status <> OLD.status THEN
    IF NEW.status IN ('approved','paid') THEN
      INSERT INTO public.transactions (user_id, type, amount, status, reference, description)
      VALUES (NEW.user_id, 'withdrawal', NEW.amount, 'completed',
              COALESCE(NEW.payout_mpesa_code, NEW.mpesa_phone),
              CASE WHEN NEW.status='paid' THEN 'Withdrawal paid' ELSE 'Withdrawal approved' END);
      IF NEW.status = 'paid' THEN
        INSERT INTO public.notifications (user_id, type, title, body, link)
        VALUES (NEW.user_id, 'success', 'Withdrawal paid',
                'Your withdrawal of KSh ' || NEW.amount || ' was paid.', '/withdraw');
      END IF;
    ELSIF NEW.status = 'rejected' THEN
      INSERT INTO public.transactions (user_id, type, amount, status, reference, description)
      VALUES (NEW.user_id, 'withdrawal', NEW.amount, 'rejected', NEW.mpesa_phone,
              COALESCE(NEW.admin_note, 'Withdrawal rejected (refunded)'));
      INSERT INTO public.notifications (user_id, type, title, body, link)
      VALUES (NEW.user_id, 'warning', 'Withdrawal rejected',
              COALESCE(NEW.admin_note, 'Your withdrawal was rejected and refunded.'), '/withdraw');
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

-- 14. Ensure refund_rejected_withdrawal covers 'paid'
CREATE OR REPLACE FUNCTION public.refund_rejected_withdrawal()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
BEGIN
  IF NEW.status = 'rejected' AND OLD.status = 'pending' THEN
    UPDATE public.profiles SET balance = balance + NEW.amount WHERE id = NEW.user_id;
    NEW.processed_at = now();
  ELSIF NEW.status IN ('approved','paid') AND OLD.status = 'pending' THEN
    NEW.processed_at = now();
  END IF;
  RETURN NEW;
END;
$$;

-- 15. Admin soft-delete / restore helpers
CREATE OR REPLACE FUNCTION public.admin_soft_delete_user(_target uuid, _note text DEFAULT NULL)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
BEGIN
  IF NOT public.has_role(auth.uid(),'admin') THEN RAISE EXCEPTION 'Not authorized'; END IF;
  UPDATE public.profiles SET deleted_at = now(), status='suspended' WHERE id = _target;
  INSERT INTO public.admin_actions (admin_id, target_user_id, action, note)
  VALUES (auth.uid(), _target, 'soft_delete', _note);
  RETURN true;
END;
$$;

CREATE OR REPLACE FUNCTION public.admin_restore_user(_target uuid, _note text DEFAULT NULL)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
BEGIN
  IF NOT public.has_role(auth.uid(),'admin') THEN RAISE EXCEPTION 'Not authorized'; END IF;
  UPDATE public.profiles SET deleted_at = NULL, status='active' WHERE id = _target;
  INSERT INTO public.admin_actions (admin_id, target_user_id, action, note)
  VALUES (auth.uid(), _target, 'restore', _note);
  RETURN true;
END;
$$;
