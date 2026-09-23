CREATE OR REPLACE FUNCTION public.delete_investment_with_related_data(p_investment_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  investment_row public.investments%ROWTYPE;
  released_amount numeric(14,6);
BEGIN
  IF NOT public.has_role(auth.uid(), 'admin') THEN
    RAISE EXCEPTION 'Only administrators can delete investments';
  END IF;

  SELECT * INTO investment_row
  FROM public.investments
  WHERE id = p_investment_id
  FOR UPDATE;

  IF investment_row.id IS NULL THEN
    RAISE EXCEPTION 'Investment not found';
  END IF;

  SELECT COALESCE(SUM(amount), 0) INTO released_amount
  FROM public.daily_earnings
  WHERE investment_id = p_investment_id
    AND added_to_balance = true;

  IF released_amount > 0 THEN
    UPDATE public.profiles
    SET balance = GREATEST(COALESCE(balance, 0) - released_amount, 0)
    WHERE id = investment_row.user_id;

    UPDATE public.investments
    SET total_accrued_profit = GREATEST(COALESCE(total_accrued_profit, 0) - released_amount, 0),
        total_paid_profit = GREATEST(COALESCE(total_paid_profit, 0) - released_amount, 0)
    WHERE id = p_investment_id;
  END IF;

  DELETE FROM public.daily_earnings WHERE investment_id = p_investment_id;
  DELETE FROM public.transactions
  WHERE metadata->>'investment_id' = p_investment_id::text;
  DELETE FROM public.investments WHERE id = p_investment_id;
END;
$$;

REVOKE ALL ON FUNCTION public.delete_investment_with_related_data(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.delete_investment_with_related_data(uuid) TO authenticated;
