-- Allow withdrawals of any positive amount up to the user's available balance.
-- Percentage withdrawal fees remain unchanged.

CREATE OR REPLACE FUNCTION public.validate_withdrawal_request()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  open_over boolean;
  is_sunday boolean;
  available_balance numeric;
  pending_total numeric;
BEGIN
  NEW.fee_amount := ROUND(NEW.amount * 0.01, 6);
  NEW.net_amount := ROUND(NEW.amount - NEW.fee_amount, 6);

  IF NEW.amount IS NULL OR NEW.amount <= 0 THEN
    RAISE EXCEPTION 'Withdrawal amount must be greater than zero.';
  END IF;

  SELECT withdrawals_open_override
  INTO open_over
  FROM public.app_settings
  WHERE id = 1;

  SELECT COALESCE(balance, 0)
  INTO available_balance
  FROM public.profiles
  WHERE id = NEW.user_id;

  SELECT COALESCE(SUM(amount), 0)
  INTO pending_total
  FROM public.withdrawals
  WHERE user_id = NEW.user_id
    AND status IN ('pending', 'approved');

  IF available_balance - pending_total < NEW.amount THEN
    RAISE EXCEPTION 'Your available USD balance is not enough for this withdrawal.';
  END IF;

  is_sunday := EXTRACT(ISODOW FROM (now() AT TIME ZONE 'Africa/Nairobi')) = 7;
  IF open_over IS FALSE THEN
    RAISE EXCEPTION 'Withdrawals are currently closed by admin.';
  ELSIF open_over IS NULL AND is_sunday THEN
    RAISE EXCEPTION 'Withdrawals are closed on Sundays.';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS validate_withdrawal ON public.withdrawals;
CREATE TRIGGER validate_withdrawal
BEFORE INSERT ON public.withdrawals
FOR EACH ROW
EXECUTE FUNCTION public.validate_withdrawal_request();

GRANT EXECUTE ON FUNCTION public.validate_withdrawal_request() TO authenticated;
GRANT EXECUTE ON FUNCTION public.validate_withdrawal_request() TO service_role;
