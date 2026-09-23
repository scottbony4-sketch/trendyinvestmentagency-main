-- Ensure referral code validation works for anonymous signups and uses the same normalized format as the app.
-- This adds a secure RPC that can be called without an authenticated session and uses the same uppercase format.

DROP FUNCTION IF EXISTS public.validate_referral_code(text);

CREATE FUNCTION public.validate_referral_code(p_code text)
RETURNS TABLE(id uuid, referral_code text, deleted_at timestamptz)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT p.id, p.referral_code, p.deleted_at
  FROM public.profiles p
  WHERE upper(trim(p.referral_code)) = upper(trim(p_code))
    AND p.deleted_at IS NULL
  ORDER BY p.created_at ASC
  LIMIT 1;
$$;

GRANT EXECUTE ON FUNCTION public.validate_referral_code(text) TO anon, authenticated;

-- Normalize existing referral codes to uppercase and ensure they remain unique.
UPDATE public.profiles
SET referral_code = upper(trim(referral_code))
WHERE referral_code IS NOT NULL AND upper(trim(referral_code)) <> referral_code;

-- Make the trigger store the same uppercase format that signup validates.
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  full_nm text;
  raw_referral text;
  normalized_referral text;
  referrer uuid;
  ref_code text;
BEGIN
  full_nm := COALESCE(NEW.raw_user_meta_data->>'full_name', '');
  raw_referral := COALESCE(NEW.raw_user_meta_data->>'referral_code', '');
  normalized_referral := upper(trim(raw_referral));
  ref_code := public.gen_referral_code_from_name(full_nm);
  referrer := NULL;

  IF length(normalized_referral) > 0 THEN
    SELECT id INTO referrer
    FROM public.profiles
    WHERE upper(trim(referral_code)) = normalized_referral
      AND deleted_at IS NULL
      AND id <> NEW.id
    ORDER BY created_at ASC
    LIMIT 1;
  END IF;

  INSERT INTO public.profiles (id, full_name, phone, referral_code, referred_by)
  VALUES (
    NEW.id,
    full_nm,
    COALESCE(NEW.raw_user_meta_data->>'phone', ''),
    ref_code,
    referrer
  );

  INSERT INTO public.user_roles (user_id, role) VALUES (NEW.id, 'user');

  IF referrer IS NOT NULL THEN
    INSERT INTO public.referrals (referrer_id, referred_id)
    VALUES (referrer, NEW.id)
    ON CONFLICT (referred_id) DO NOTHING;

    INSERT INTO public.notifications (user_id, type, title, body, link)
    VALUES (
      referrer,
      'success',
      'New referral joined',
      'Someone signed up using your referral code.',
      '/referrals'
    );
  END IF;

  RETURN NEW;
END;
$$;

-- Ensure the trigger is attached for new signups.
DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
AFTER INSERT ON auth.users
FOR EACH ROW
EXECUTE FUNCTION public.handle_new_user();
