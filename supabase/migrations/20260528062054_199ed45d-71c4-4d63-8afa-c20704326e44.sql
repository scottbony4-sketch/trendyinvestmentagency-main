
-- Roles
CREATE TYPE public.app_role AS ENUM ('admin', 'user');

CREATE TABLE public.user_roles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  role public.app_role NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, role)
);
GRANT SELECT ON public.user_roles TO authenticated;
GRANT ALL ON public.user_roles TO service_role;
ALTER TABLE public.user_roles ENABLE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION public.has_role(_user_id uuid, _role public.app_role)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = _user_id AND role = _role)
$$;

CREATE POLICY "Users view own roles" ON public.user_roles FOR SELECT TO authenticated
  USING (auth.uid() = user_id OR public.has_role(auth.uid(), 'admin'));

-- Profiles
CREATE TABLE public.profiles (
  id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  full_name text NOT NULL DEFAULT '',
  phone text NOT NULL DEFAULT '',
  balance numeric(14,2) NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE ON public.profiles TO authenticated;
GRANT ALL ON public.profiles TO service_role;
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;

CREATE POLICY "View own profile or admin" ON public.profiles FOR SELECT TO authenticated
  USING (auth.uid() = id OR public.has_role(auth.uid(), 'admin'));
CREATE POLICY "Update own profile name/phone" ON public.profiles FOR UPDATE TO authenticated
  USING (auth.uid() = id) WITH CHECK (auth.uid() = id);
CREATE POLICY "Admin update any profile" ON public.profiles FOR UPDATE TO authenticated
  USING (public.has_role(auth.uid(), 'admin')) WITH CHECK (public.has_role(auth.uid(), 'admin'));

-- Deposits
CREATE TABLE public.deposits (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  amount numeric(14,2) NOT NULL,
  mpesa_code text NOT NULL,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','approved','rejected')),
  admin_note text,
  created_at timestamptz NOT NULL DEFAULT now(),
  processed_at timestamptz
);
GRANT SELECT, INSERT, UPDATE ON public.deposits TO authenticated;
GRANT ALL ON public.deposits TO service_role;
ALTER TABLE public.deposits ENABLE ROW LEVEL SECURITY;

CREATE POLICY "View own deposits or admin" ON public.deposits FOR SELECT TO authenticated
  USING (auth.uid() = user_id OR public.has_role(auth.uid(), 'admin'));
CREATE POLICY "Insert own deposits" ON public.deposits FOR INSERT TO authenticated
  WITH CHECK (auth.uid() = user_id AND status = 'pending');
CREATE POLICY "Admin update deposits" ON public.deposits FOR UPDATE TO authenticated
  USING (public.has_role(auth.uid(), 'admin')) WITH CHECK (public.has_role(auth.uid(), 'admin'));

-- Investments
CREATE TABLE public.investments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  plan_amount numeric(14,2) NOT NULL,
  daily_return numeric(14,2) NOT NULL,
  duration_days int NOT NULL DEFAULT 30,
  days_paid int NOT NULL DEFAULT 0,
  last_claim_at timestamptz,
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active','completed')),
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE ON public.investments TO authenticated;
GRANT ALL ON public.investments TO service_role;
ALTER TABLE public.investments ENABLE ROW LEVEL SECURITY;

CREATE POLICY "View own investments or admin" ON public.investments FOR SELECT TO authenticated
  USING (auth.uid() = user_id OR public.has_role(auth.uid(), 'admin'));

-- Withdrawals
CREATE TABLE public.withdrawals (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  amount numeric(14,2) NOT NULL CHECK (amount > 0),
  mpesa_phone text NOT NULL,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','approved','rejected')),
  admin_note text,
  created_at timestamptz NOT NULL DEFAULT now(),
  processed_at timestamptz
);
GRANT SELECT, INSERT, UPDATE ON public.withdrawals TO authenticated;
GRANT ALL ON public.withdrawals TO service_role;
ALTER TABLE public.withdrawals ENABLE ROW LEVEL SECURITY;

CREATE POLICY "View own withdrawals or admin" ON public.withdrawals FOR SELECT TO authenticated
  USING (auth.uid() = user_id OR public.has_role(auth.uid(), 'admin'));
CREATE POLICY "Admin update withdrawals" ON public.withdrawals FOR UPDATE TO authenticated
  USING (public.has_role(auth.uid(), 'admin')) WITH CHECK (public.has_role(auth.uid(), 'admin'));

-- Insert own withdrawal with balance check via trigger
CREATE POLICY "Insert own withdrawals" ON public.withdrawals FOR INSERT TO authenticated
  WITH CHECK (auth.uid() = user_id AND status = 'pending');

-- Trigger: create profile + default role on signup
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  INSERT INTO public.profiles (id, full_name, phone)
  VALUES (NEW.id, COALESCE(NEW.raw_user_meta_data->>'full_name',''), COALESCE(NEW.raw_user_meta_data->>'phone',''));
  INSERT INTO public.user_roles (user_id, role) VALUES (NEW.id, 'user');
  RETURN NEW;
END;
$$;

CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- Trigger: when withdrawal inserted, deduct from balance immediately (hold)
CREATE OR REPLACE FUNCTION public.hold_withdrawal_balance()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  bal numeric;
BEGIN
  SELECT balance INTO bal FROM public.profiles WHERE id = NEW.user_id FOR UPDATE;
  IF bal IS NULL OR bal < NEW.amount THEN
    RAISE EXCEPTION 'Insufficient balance';
  END IF;
  UPDATE public.profiles SET balance = balance - NEW.amount WHERE id = NEW.user_id;
  RETURN NEW;
END;
$$;
CREATE TRIGGER withdrawal_hold BEFORE INSERT ON public.withdrawals
  FOR EACH ROW EXECUTE FUNCTION public.hold_withdrawal_balance();

-- Trigger: if withdrawal rejected, refund balance
CREATE OR REPLACE FUNCTION public.refund_rejected_withdrawal()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NEW.status = 'rejected' AND OLD.status = 'pending' THEN
    UPDATE public.profiles SET balance = balance + NEW.amount WHERE id = NEW.user_id;
    NEW.processed_at = now();
  ELSIF NEW.status = 'approved' AND OLD.status = 'pending' THEN
    NEW.processed_at = now();
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER withdrawal_status_update BEFORE UPDATE ON public.withdrawals
  FOR EACH ROW EXECUTE FUNCTION public.refund_rejected_withdrawal();

-- Trigger: on deposit approval, create investment (10% daily for 30 days)
CREATE OR REPLACE FUNCTION public.activate_deposit()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NEW.status = 'approved' AND OLD.status = 'pending' THEN
    INSERT INTO public.investments (user_id, plan_amount, daily_return, duration_days)
    VALUES (NEW.user_id, NEW.amount, ROUND(NEW.amount * 0.10, 2), 30);
    NEW.processed_at = now();
  ELSIF NEW.status = 'rejected' AND OLD.status = 'pending' THEN
    NEW.processed_at = now();
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER deposit_status_update BEFORE UPDATE ON public.deposits
  FOR EACH ROW EXECUTE FUNCTION public.activate_deposit();

-- RPC: claim daily earnings (atomic)
CREATE OR REPLACE FUNCTION public.claim_earnings()
RETURNS numeric LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  uid uuid := auth.uid();
  total_claimed numeric := 0;
  inv RECORD;
BEGIN
  IF uid IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;
  FOR inv IN
    SELECT * FROM public.investments
    WHERE user_id = uid AND status = 'active'
      AND (last_claim_at IS NULL OR last_claim_at < now() - interval '24 hours')
    FOR UPDATE
  LOOP
    UPDATE public.investments
      SET days_paid = days_paid + 1,
          last_claim_at = now(),
          status = CASE WHEN days_paid + 1 >= duration_days THEN 'completed' ELSE 'active' END
      WHERE id = inv.id;
    UPDATE public.profiles SET balance = balance + inv.daily_return WHERE id = uid;
    total_claimed := total_claimed + inv.daily_return;
  END LOOP;
  RETURN total_claimed;
END;
$$;
GRANT EXECUTE ON FUNCTION public.claim_earnings() TO authenticated;
