-- Add admin RLS policy for user_roles so admins can insert/update/delete roles

-- Drop existing policy if present, then create an admin policy
DROP POLICY IF EXISTS "Admins manage roles" ON public.user_roles;

CREATE POLICY "Admins manage roles" ON public.user_roles
  FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'admin'))
  WITH CHECK (public.has_role(auth.uid(), 'admin'));

-- Ensure service_role retains full access (already granted in earlier migrations)
GRANT ALL ON public.user_roles TO service_role;
