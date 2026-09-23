
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS username text UNIQUE,
  ADD COLUMN IF NOT EXISTS country text DEFAULT '',
  ADD COLUMN IF NOT EXISTS address text DEFAULT '',
  ADD COLUMN IF NOT EXISTS avatar_url text,
  ADD COLUMN IF NOT EXISTS referral_code text UNIQUE,
  ADD COLUMN IF NOT EXISTS referred_by uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS last_login_at timestamptz,
  ADD COLUMN IF NOT EXISTS status text NOT NULL DEFAULT 'active';

CREATE OR REPLACE FUNCTION public.gen_referral_code()
RETURNS text LANGUAGE plpgsql AS $$
DECLARE code text;
BEGIN
  LOOP
    code := upper(substring(md5(random()::text || clock_timestamp()::text) from 1 for 8));
    EXIT WHEN NOT EXISTS (SELECT 1 FROM public.profiles WHERE referral_code = code);
  END LOOP;
  RETURN code;
END;
$$;

UPDATE public.profiles SET referral_code = public.gen_referral_code() WHERE referral_code IS NULL;

CREATE TABLE IF NOT EXISTS public.investment_plans (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  slug text NOT NULL UNIQUE,
  description text DEFAULT '',
  duration_days integer NOT NULL,
  daily_return_percent numeric(6,2) NOT NULL,
  min_amount numeric(14,2) NOT NULL DEFAULT 0,
  max_amount numeric(14,2),
  color text DEFAULT '#EAB308',
  icon text DEFAULT 'sparkles',
  sort_order integer NOT NULL DEFAULT 0,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT ON public.investment_plans TO anon, authenticated;
GRANT INSERT, UPDATE, DELETE ON public.investment_plans TO authenticated;
GRANT ALL ON public.investment_plans TO service_role;
ALTER TABLE public.investment_plans ENABLE ROW LEVEL SECURITY;
CREATE POLICY "plans public read active" ON public.investment_plans FOR SELECT USING (is_active OR public.has_role(auth.uid(),'admin'));
CREATE POLICY "plans admin write" ON public.investment_plans FOR ALL TO authenticated USING (public.has_role(auth.uid(),'admin')) WITH CHECK (public.has_role(auth.uid(),'admin'));

INSERT INTO public.investment_plans (name, slug, description, duration_days, daily_return_percent, min_amount, max_amount, color, icon, sort_order)
VALUES
  ('Starter', 'starter', 'Entry mining plan for new investors.', 7, 10, 250, 5000, '#22C55E', 'sprout', 1),
  ('Growth',  'growth',  'Balanced growth over 17 days.',        17, 10, 5000, 30000, '#3B82F6', 'trending-up', 2),
  ('Premium', 'premium', 'Maximum returns over 28 days.',        28, 10, 30000, 500000, '#EAB308', 'crown', 3)
ON CONFLICT (slug) DO NOTHING;

ALTER TABLE public.deposits ADD COLUMN IF NOT EXISTS plan_id uuid REFERENCES public.investment_plans(id);
ALTER TABLE public.investments ADD COLUMN IF NOT EXISTS plan_id uuid REFERENCES public.investment_plans(id);

CREATE TABLE IF NOT EXISTS public.app_settings (
  id integer PRIMARY KEY DEFAULT 1,
  referral_percent numeric(5,2) NOT NULL DEFAULT 10,
  min_deposit numeric(14,2) NOT NULL DEFAULT 250,
  min_withdrawal numeric(14,2) NOT NULL DEFAULT 100,
  max_withdrawal numeric(14,2) NOT NULL DEFAULT 1000000,
  withdrawal_fee_percent numeric(5,2) NOT NULL DEFAULT 0,
  contact_email text DEFAULT '',
  whatsapp text DEFAULT '',
  mpesa_till text DEFAULT '',
  maintenance_mode boolean NOT NULL DEFAULT false,
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT app_settings_singleton CHECK (id = 1)
);
INSERT INTO public.app_settings (id) VALUES (1) ON CONFLICT DO NOTHING;
GRANT SELECT ON public.app_settings TO anon, authenticated;
GRANT UPDATE ON public.app_settings TO authenticated;
GRANT ALL ON public.app_settings TO service_role;
ALTER TABLE public.app_settings ENABLE ROW LEVEL SECURITY;
CREATE POLICY "settings public read" ON public.app_settings FOR SELECT USING (true);
CREATE POLICY "settings admin write" ON public.app_settings FOR UPDATE TO authenticated USING (public.has_role(auth.uid(),'admin')) WITH CHECK (public.has_role(auth.uid(),'admin'));

CREATE TABLE IF NOT EXISTS public.notifications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  type text NOT NULL DEFAULT 'info',
  title text NOT NULL,
  body text DEFAULT '',
  link text,
  read_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS notifications_user_idx ON public.notifications(user_id, created_at DESC);
GRANT SELECT, UPDATE, DELETE ON public.notifications TO authenticated;
GRANT ALL ON public.notifications TO service_role;
ALTER TABLE public.notifications ENABLE ROW LEVEL SECURITY;
CREATE POLICY "notif own read" ON public.notifications FOR SELECT TO authenticated USING (auth.uid() = user_id OR public.has_role(auth.uid(),'admin'));
CREATE POLICY "notif own update" ON public.notifications FOR UPDATE TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
CREATE POLICY "notif own delete" ON public.notifications FOR DELETE TO authenticated USING (auth.uid() = user_id);
CREATE POLICY "notif admin insert" ON public.notifications FOR INSERT TO authenticated WITH CHECK (public.has_role(auth.uid(),'admin'));

CREATE TABLE IF NOT EXISTS public.referrals (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  referrer_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  referred_id uuid NOT NULL UNIQUE REFERENCES auth.users(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS referrals_referrer_idx ON public.referrals(referrer_id);
GRANT SELECT ON public.referrals TO authenticated;
GRANT ALL ON public.referrals TO service_role;
ALTER TABLE public.referrals ENABLE ROW LEVEL SECURITY;
CREATE POLICY "referrals own" ON public.referrals FOR SELECT TO authenticated USING (auth.uid() = referrer_id OR auth.uid() = referred_id OR public.has_role(auth.uid(),'admin'));

CREATE TABLE IF NOT EXISTS public.referral_earnings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  referrer_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  referred_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  deposit_id uuid REFERENCES public.deposits(id) ON DELETE SET NULL,
  amount numeric(14,2) NOT NULL,
  percent numeric(5,2) NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS ref_earn_referrer_idx ON public.referral_earnings(referrer_id, created_at DESC);
GRANT SELECT ON public.referral_earnings TO authenticated;
GRANT ALL ON public.referral_earnings TO service_role;
ALTER TABLE public.referral_earnings ENABLE ROW LEVEL SECURITY;
CREATE POLICY "ref earn own" ON public.referral_earnings FOR SELECT TO authenticated USING (auth.uid() = referrer_id OR public.has_role(auth.uid(),'admin'));
CREATE POLICY "ref earn admin update" ON public.referral_earnings FOR UPDATE TO authenticated
  USING (public.has_role(auth.uid(), 'admin')) WITH CHECK (public.has_role(auth.uid(), 'admin'));

CREATE TABLE IF NOT EXISTS public.transactions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  type text NOT NULL,
  amount numeric(14,2) NOT NULL,
  status text NOT NULL DEFAULT 'completed',
  reference text,
  description text DEFAULT '',
  metadata jsonb DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS tx_user_idx ON public.transactions(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS tx_type_idx ON public.transactions(type);
GRANT SELECT ON public.transactions TO authenticated;
GRANT ALL ON public.transactions TO service_role;
ALTER TABLE public.transactions ENABLE ROW LEVEL SECURITY;
CREATE POLICY "tx own" ON public.transactions FOR SELECT TO authenticated USING (auth.uid() = user_id OR public.has_role(auth.uid(),'admin'));

CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  ref_code text;
  referrer uuid;
BEGIN
  ref_code := public.gen_referral_code();
  referrer := NULL;
  IF NEW.raw_user_meta_data ? 'referral_code' THEN
    SELECT id INTO referrer FROM public.profiles
      WHERE referral_code = upper(NEW.raw_user_meta_data->>'referral_code') LIMIT 1;
  END IF;
  INSERT INTO public.profiles (id, full_name, phone, referral_code, referred_by)
  VALUES (NEW.id,
    COALESCE(NEW.raw_user_meta_data->>'full_name',''),
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

CREATE OR REPLACE FUNCTION public.activate_deposit()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  inv_id uuid; plan_rec RECORD;
  plan_daily numeric(6,2); plan_days integer;
  referrer uuid; ref_pct numeric(5,2); ref_amt numeric(14,2);
BEGIN
  IF NEW.status = 'approved' AND OLD.status = 'pending' THEN
    IF NEW.plan_id IS NOT NULL THEN
      SELECT * INTO plan_rec FROM public.investment_plans WHERE id = NEW.plan_id;
      plan_daily := COALESCE(plan_rec.daily_return_percent, 10);
      plan_days := COALESCE(plan_rec.duration_days, 30);
    ELSE plan_daily := 10; plan_days := 30; END IF;

    INSERT INTO public.investments (user_id, plan_id, plan_amount, daily_return, duration_days)
    VALUES (NEW.user_id, NEW.plan_id, NEW.amount,
            ROUND(NEW.amount * plan_daily / 100.0, 2), plan_days)
    RETURNING id INTO inv_id;

    NEW.processed_at = now();

    INSERT INTO public.transactions (user_id, type, amount, status, reference, description)
    VALUES (NEW.user_id, 'deposit', NEW.amount, 'completed', NEW.mpesa_code, 'Deposit approved');
    INSERT INTO public.transactions (user_id, type, amount, status, reference, description, metadata)
    VALUES (NEW.user_id, 'investment', NEW.amount, 'active', inv_id::text,
            'Investment started', jsonb_build_object('plan_id', NEW.plan_id));
    INSERT INTO public.notifications (user_id, type, title, body, link)
    VALUES (NEW.user_id, 'success', 'Deposit approved',
            'Your deposit of KES ' || NEW.amount || ' is now earning.', '/dashboard');

    SELECT referred_by INTO referrer FROM public.profiles WHERE id = NEW.user_id;
    IF referrer IS NOT NULL THEN
      SELECT referral_percent INTO ref_pct FROM public.app_settings WHERE id = 1;
      ref_pct := COALESCE(ref_pct, 10);
      ref_amt := ROUND(NEW.amount * ref_pct / 100.0, 2);
      IF ref_amt > 0 THEN
        UPDATE public.profiles SET balance = balance + ref_amt WHERE id = referrer;
        INSERT INTO public.referral_earnings (referrer_id, referred_id, deposit_id, amount, percent)
        VALUES (referrer, NEW.user_id, NEW.id, ref_amt, ref_pct);
        INSERT INTO public.transactions (user_id, type, amount, status, description, metadata)
        VALUES (referrer, 'referral', ref_amt, 'completed',
                'Referral bonus (' || ref_pct || '% of KES ' || NEW.amount || ')',
                jsonb_build_object('referred_id', NEW.user_id, 'deposit_id', NEW.id));
        INSERT INTO public.notifications (user_id, type, title, body, link)
        VALUES (referrer, 'success', 'Referral bonus earned',
                'You earned KES ' || ref_amt || ' from a referral deposit.', '/referrals');
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

CREATE OR REPLACE FUNCTION public.log_withdrawal_change()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    INSERT INTO public.transactions (user_id, type, amount, status, reference, description)
    VALUES (NEW.user_id, 'withdrawal', NEW.amount, 'pending', NEW.mpesa_phone, 'Withdrawal requested');
    RETURN NEW;
  END IF;
  IF NEW.status <> OLD.status THEN
    IF NEW.status = 'approved' THEN
      INSERT INTO public.transactions (user_id, type, amount, status, reference, description)
      VALUES (NEW.user_id, 'withdrawal', NEW.amount, 'completed',
              COALESCE(NEW.payout_mpesa_code, NEW.mpesa_phone), 'Withdrawal paid');
      INSERT INTO public.notifications (user_id, type, title, body, link)
      VALUES (NEW.user_id, 'success', 'Withdrawal paid',
              'Your withdrawal of KES ' || NEW.amount || ' was paid.', '/withdraw');
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

DROP TRIGGER IF EXISTS log_withdrawal_ins ON public.withdrawals;
DROP TRIGGER IF EXISTS log_withdrawal_upd ON public.withdrawals;
CREATE TRIGGER log_withdrawal_ins AFTER INSERT ON public.withdrawals
  FOR EACH ROW EXECUTE FUNCTION public.log_withdrawal_change();
CREATE TRIGGER log_withdrawal_upd AFTER UPDATE ON public.withdrawals
  FOR EACH ROW EXECUTE FUNCTION public.log_withdrawal_change();

CREATE OR REPLACE FUNCTION public.claim_earnings()
RETURNS numeric LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE uid uuid := auth.uid(); total_claimed numeric := 0; inv RECORD; matured boolean;
BEGIN
  IF uid IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;
  FOR inv IN
    SELECT * FROM public.investments
    WHERE user_id = uid AND status = 'active'
      AND (last_claim_at IS NULL OR last_claim_at < now() - interval '24 hours')
    FOR UPDATE
  LOOP
    matured := (inv.days_paid + 1) >= inv.duration_days;
    UPDATE public.investments
      SET days_paid = days_paid + 1, last_claim_at = now(),
          status = CASE WHEN matured THEN 'completed' ELSE 'active' END
      WHERE id = inv.id;
    UPDATE public.profiles SET balance = balance + inv.daily_return WHERE id = uid;
    total_claimed := total_claimed + inv.daily_return;
    INSERT INTO public.transactions (user_id, type, amount, status, reference, description)
    VALUES (uid, 'claim', inv.daily_return, 'completed', inv.id::text, 'Daily mining earnings claimed');
    IF matured THEN
      INSERT INTO public.notifications (user_id, type, title, body, link)
      VALUES (uid, 'success', 'Investment matured',
              'Your plan of KES ' || inv.plan_amount || ' has completed.', '/dashboard');
    END IF;
  END LOOP;
  RETURN total_claimed;
END;
$$;

CREATE OR REPLACE FUNCTION public.admin_set_user_status(_target uuid, _status text, _note text DEFAULT NULL)
RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NOT public.has_role(auth.uid(),'admin') THEN RAISE EXCEPTION 'Not authorized'; END IF;
  IF _status NOT IN ('active','suspended') THEN RAISE EXCEPTION 'Invalid status'; END IF;
  UPDATE public.profiles SET status = _status WHERE id = _target;
  INSERT INTO public.admin_actions (admin_id, target_user_id, action, note)
    VALUES (auth.uid(), _target, 'set_status_' || _status, _note);
  RETURN _status;
END;
$$;
