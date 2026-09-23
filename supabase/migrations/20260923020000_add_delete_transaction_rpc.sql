CREATE OR REPLACE FUNCTION public.delete_transaction(p_transaction_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  DELETE FROM public.transactions
  WHERE id = p_transaction_id
    AND (user_id = auth.uid() OR public.has_role(auth.uid(), 'admin'));
END;
$$;

REVOKE ALL ON FUNCTION public.delete_transaction(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.delete_transaction(uuid) TO authenticated;