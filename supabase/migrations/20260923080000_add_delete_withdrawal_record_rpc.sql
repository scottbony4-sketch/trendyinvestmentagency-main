CREATE OR REPLACE FUNCTION public.delete_withdrawal_record(p_withdrawal_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT public.has_role(auth.uid(), 'admin') THEN
    RAISE EXCEPTION 'Only administrators can delete withdrawals';
  END IF;

  IF NOT EXISTS (SELECT 1 FROM public.withdrawals WHERE id = p_withdrawal_id) THEN
    RAISE EXCEPTION 'Withdrawal not found';
  END IF;

  DELETE FROM public.transactions
  WHERE metadata->>'withdrawal_id' = p_withdrawal_id::text;

  DELETE FROM public.withdrawals
  WHERE id = p_withdrawal_id;
END;
$$;

REVOKE ALL ON FUNCTION public.delete_withdrawal_record(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.delete_withdrawal_record(uuid) TO authenticated;