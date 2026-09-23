CREATE OR REPLACE FUNCTION public.get_investment_owner_contacts(_user_ids uuid[])
RETURNS TABLE(user_id uuid, full_name text, phone text, email text)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public, auth
AS $$
  SELECT p.id, p.full_name, p.phone, u.email
  FROM public.profiles p
  JOIN auth.users u ON u.id = p.id
  WHERE p.id = ANY(COALESCE(_user_ids, ARRAY[]::uuid[]))
    AND (p.id = auth.uid() OR public.has_role(auth.uid(), 'admin'));
$$;

GRANT EXECUTE ON FUNCTION public.get_investment_owner_contacts(uuid[]) TO authenticated;
