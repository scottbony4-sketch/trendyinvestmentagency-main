-- Return the exact users who joined through a referrer's code or link.
-- This is a security-definer RPC so the authenticated referrer can read only their invited users.

CREATE OR REPLACE FUNCTION public.get_referred_profiles_for_referrer(p_referrer_id uuid)
RETURNS TABLE (
  id uuid,
  full_name text,
  phone text,
  created_at timestamptz
)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT p.id, p.full_name, p.phone, p.created_at
  FROM public.profiles AS p
  WHERE p.referred_by = p_referrer_id
  ORDER BY p.created_at DESC;
$$;

GRANT EXECUTE ON FUNCTION public.get_referred_profiles_for_referrer(uuid) TO authenticated;
