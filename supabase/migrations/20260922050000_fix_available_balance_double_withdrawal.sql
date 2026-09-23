-- Fix available balance being reduced twice for approved withdrawals.
-- Withdrawal transactions are audit records; withdrawals is the balance hold source.

CREATE OR REPLACE FUNCTION public.reconcile_available_balance()
RETURNS numeric
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  uid uuid := auth.uid();
  calculated_balance numeric;
BEGIN
  IF uid IS NULL THEN
    RAISE EXCEPTION 'Authentication required';
  END IF;

  SELECT COALESCE(SUM(
    CASE
      WHEN type IN ('deposit', 'daily_earning', 'referral', 'investment_maturity') THEN amount
      WHEN type = 'investment' THEN -amount
      ELSE 0
    END
  ), 0)
  INTO calculated_balance
  FROM public.transactions
  WHERE user_id = uid
    AND status IN ('completed', 'active', 'paid');

  calculated_balance := calculated_balance
    + COALESCE((
      SELECT SUM(amount)
      FROM public.referral_earnings AS re
      WHERE re.referrer_id = uid
        AND re.status IN ('paid', 'completed')
        AND NOT EXISTS (
          SELECT 1
          FROM public.transactions AS tx
          WHERE tx.user_id = uid
            AND tx.type = 'referral'
            AND tx.status IN ('completed', 'active', 'paid')
            AND tx.metadata ->> 'commission_id' = re.id::text
        )
    ), 0)
    - COALESCE((
      SELECT SUM(amount)
      FROM public.withdrawals
      WHERE user_id = uid
        AND status IN ('pending', 'approved', 'paid')
    ), 0);

  calculated_balance := GREATEST(calculated_balance, 0);

  UPDATE public.profiles
  SET balance = calculated_balance
  WHERE id = uid;

  RETURN calculated_balance;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.reconcile_available_balance() FROM anon;
GRANT EXECUTE ON FUNCTION public.reconcile_available_balance() TO authenticated;
GRANT EXECUTE ON FUNCTION public.reconcile_available_balance() TO service_role;
