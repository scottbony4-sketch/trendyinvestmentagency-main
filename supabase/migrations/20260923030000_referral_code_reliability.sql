-- Make referral codes reliable for older profiles and invite links pasted into signup.

CREATE OR REPLACE FUNCTION public.validate_referral_code(p_code text)
RETURNS TABLE(id uuid, referral_code text, deleted_at timestamptz)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT p.id, p.referral_code, p.deleted_at
  FROM public.profiles p
  WHERE regexp_replace(upper(COALESCE(p.referral_code, '')), '[^A-Z0-9]', '', 'g') =
        regexp_replace(upper(COALESCE(p_code, '')), '[^A-Z0-9]', '', 'g')
    AND p.deleted_at IS NULL
  ORDER BY p.created_at ASC
  LIMIT 1;
$$;

CREATE OR REPLACE FUNCTION public.get_or_create_referral_code()
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  current_code text;
  profile_name text;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Authentication required';
  END IF;

  SELECT referral_code, full_name
  INTO current_code, profile_name
  FROM public.profiles
  WHERE id = auth.uid();

  current_code := regexp_replace(upper(COALESCE(current_code, '')), '[^A-Z0-9]', '', 'g');
  IF current_code <> '' THEN
    RETURN current_code;
  END IF;

  current_code := public.gen_referral_code_from_name(profile_name);
  UPDATE public.profiles
  SET referral_code = current_code
  WHERE id = auth.uid();

  RETURN current_code;
END;
$$;

GRANT EXECUTE ON FUNCTION public.validate_referral_code(text) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_or_create_referral_code() TO authenticated;