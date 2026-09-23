CREATE OR REPLACE FUNCTION public.delete_deposit_with_related_data(p_deposit_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  deposit_row public.deposits%ROWTYPE;
BEGIN
  IF NOT public.has_role(auth.uid(), 'admin') THEN
    RAISE EXCEPTION 'Only administrators can delete deposits';
  END IF;

  SELECT * INTO deposit_row
  FROM public.deposits
  WHERE id = p_deposit_id
  FOR UPDATE;

  IF deposit_row.id IS NULL THEN
    RAISE EXCEPTION 'Deposit not found';
  END IF;

  DELETE FROM public.daily_earnings
  WHERE investment_id IN (SELECT id FROM public.investments WHERE deposit_id = p_deposit_id);

  DELETE FROM public.referral_earnings WHERE deposit_id = p_deposit_id;
  DELETE FROM public.transactions
  WHERE metadata->>'deposit_id' = p_deposit_id::text;
  DELETE FROM public.investments WHERE deposit_id = p_deposit_id;
  DELETE FROM public.deposits WHERE id = p_deposit_id;
END;
$$;

REVOKE ALL ON FUNCTION public.delete_deposit_with_related_data(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.delete_deposit_with_related_data(uuid) TO authenticated;
