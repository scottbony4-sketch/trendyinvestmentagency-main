CREATE OR REPLACE FUNCTION public.delete_daily_earning(p_earning_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  earning public.daily_earnings%ROWTYPE;
BEGIN
  IF NOT public.has_role(auth.uid(), 'admin') THEN
    RAISE EXCEPTION 'Only administrators can delete daily earnings';
  END IF;

  SELECT * INTO earning
  FROM public.daily_earnings
  WHERE id = p_earning_id
  FOR UPDATE;

  IF earning.id IS NULL THEN
    RAISE EXCEPTION 'Daily earning not found';
  END IF;

  IF earning.added_to_balance THEN
    UPDATE public.profiles
    SET balance = COALESCE(balance, 0) - earning.amount
    WHERE id = earning.user_id;

    UPDATE public.investments
    SET total_accrued_profit = GREATEST(COALESCE(total_accrued_profit, 0) - earning.amount, 0),
        total_paid_profit = GREATEST(COALESCE(total_paid_profit, 0) - earning.amount, 0)
    WHERE id = earning.investment_id;

    DELETE FROM public.transactions
    WHERE metadata->>'earning_id' = earning.id::text;
  END IF;

  DELETE FROM public.daily_earnings WHERE id = earning.id;
END;
$$;

REVOKE ALL ON FUNCTION public.delete_daily_earning(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.delete_daily_earning(uuid) TO authenticated;