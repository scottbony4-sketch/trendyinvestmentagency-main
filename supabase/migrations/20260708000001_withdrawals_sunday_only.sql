-- Enforce no withdrawals on Sundays in Africa/Nairobi.
-- This is a focused migration that does not recreate the database or remove existing features.

CREATE OR REPLACE FUNCTION public.validate_withdrawal_request()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  min_w numeric;
  open_over boolean;
  is_sunday boolean;
BEGIN
  SELECT min_withdrawal, withdrawals_open_override INTO min_w, open_over FROM public.app_settings WHERE id = 1;
  IF NEW.amount < COALESCE(min_w, 20) THEN
    RAISE EXCEPTION 'Minimum withdrawal is KSh %', COALESCE(min_w, 20);
  END IF;

  is_sunday := (EXTRACT(ISODOW FROM (now() AT TIME ZONE 'Africa/Nairobi')) = 7);

  IF open_over IS FALSE THEN
    RAISE EXCEPTION 'Withdrawals are currently closed by admin.';
  ELSIF open_over IS NULL AND is_sunday THEN
    RAISE EXCEPTION 'Withdrawals are closed on Sundays. Please request withdrawal from Monday to Saturday.';
  END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS validate_withdrawal ON public.withdrawals;
CREATE TRIGGER validate_withdrawal BEFORE INSERT ON public.withdrawals
  FOR EACH ROW EXECUTE FUNCTION public.validate_withdrawal_request();
