
-- Ensure pgcrypto available
CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- Admin audit log
CREATE TABLE IF NOT EXISTS public.admin_actions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  admin_id uuid NOT NULL,
  target_user_id uuid NOT NULL,
  action text NOT NULL,
  amount numeric,
  note text,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT ON public.admin_actions TO authenticated;
GRANT ALL ON public.admin_actions TO service_role;
ALTER TABLE public.admin_actions ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Admins can view actions" ON public.admin_actions FOR SELECT TO authenticated USING (public.has_role(auth.uid(), 'admin'));
CREATE POLICY "Admins can insert actions" ON public.admin_actions FOR INSERT TO authenticated WITH CHECK (public.has_role(auth.uid(), 'admin') AND admin_id = auth.uid());

-- Admin credit user balance (positive or negative delta)
CREATE OR REPLACE FUNCTION public.admin_adjust_balance(_target uuid, _delta numeric, _note text DEFAULT NULL)
RETURNS numeric
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE new_bal numeric;
BEGIN
  IF NOT public.has_role(auth.uid(), 'admin') THEN RAISE EXCEPTION 'Not authorized'; END IF;
  IF _delta = 0 THEN RAISE EXCEPTION 'Delta must be non-zero'; END IF;
  UPDATE public.profiles SET balance = balance + _delta WHERE id = _target
    RETURNING balance INTO new_bal;
  IF new_bal IS NULL THEN RAISE EXCEPTION 'User not found'; END IF;
  IF new_bal < 0 THEN RAISE EXCEPTION 'Resulting balance would be negative'; END IF;
  INSERT INTO public.admin_actions (admin_id, target_user_id, action, amount, note)
    VALUES (auth.uid(), _target, CASE WHEN _delta > 0 THEN 'credit' ELSE 'debit' END, _delta, _note);
  RETURN new_bal;
END;
$$;

-- Admin creates a mining plan for a user (gift)
CREATE OR REPLACE FUNCTION public.admin_grant_plan(_target uuid, _amount numeric, _note text DEFAULT NULL)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE new_id uuid;
BEGIN
  IF NOT public.has_role(auth.uid(), 'admin') THEN RAISE EXCEPTION 'Not authorized'; END IF;
  IF _amount <= 0 THEN RAISE EXCEPTION 'Amount must be positive'; END IF;
  INSERT INTO public.investments (user_id, plan_amount, daily_return, duration_days)
    VALUES (_target, _amount, ROUND(_amount * 0.10, 2), 30) RETURNING id INTO new_id;
  INSERT INTO public.admin_actions (admin_id, target_user_id, action, amount, note)
    VALUES (auth.uid(), _target, 'grant_plan', _amount, _note);
  RETURN new_id;
END;
$$;

-- Allow admins to view all profiles
CREATE POLICY "Admins view all profiles" ON public.profiles FOR SELECT TO authenticated USING (public.has_role(auth.uid(), 'admin'));

-- Seed admin user (email: admin@trendx.app / password: Admin@12345)
DO $$
DECLARE new_uid uuid;
BEGIN
  SELECT id INTO new_uid FROM auth.users WHERE email = 'admin@trendx.app';
  IF new_uid IS NULL THEN
    new_uid := gen_random_uuid();
    INSERT INTO auth.users (
      instance_id, id, aud, role, email, encrypted_password,
      email_confirmed_at, created_at, updated_at,
      raw_app_meta_data, raw_user_meta_data,
      is_super_admin, confirmation_token, email_change, email_change_token_new, recovery_token
    ) VALUES (
      '00000000-0000-0000-0000-000000000000', new_uid, 'authenticated', 'authenticated',
      'admin@trendx.app', crypt('Admin@12345', gen_salt('bf')),
      now(), now(), now(),
      '{"provider":"email","providers":["email"]}'::jsonb,
      '{"full_name":"Administrator"}'::jsonb,
      false, '', '', '', ''
    );
    INSERT INTO auth.identities (id, user_id, identity_data, provider, provider_id, last_sign_in_at, created_at, updated_at)
      VALUES (gen_random_uuid(), new_uid, jsonb_build_object('sub', new_uid::text, 'email', 'admin@trendx.app'), 'email', new_uid::text, now(), now(), now());
  END IF;
  INSERT INTO public.user_roles (user_id, role) VALUES (new_uid, 'admin')
    ON CONFLICT (user_id, role) DO NOTHING;
END $$;
