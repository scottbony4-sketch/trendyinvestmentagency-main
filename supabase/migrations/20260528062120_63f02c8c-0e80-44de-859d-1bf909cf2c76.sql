
REVOKE ALL ON FUNCTION public.handle_new_user() FROM PUBLIC, authenticated, anon;
REVOKE ALL ON FUNCTION public.hold_withdrawal_balance() FROM PUBLIC, authenticated, anon;
REVOKE ALL ON FUNCTION public.refund_rejected_withdrawal() FROM PUBLIC, authenticated, anon;
REVOKE ALL ON FUNCTION public.activate_deposit() FROM PUBLIC, authenticated, anon;
REVOKE ALL ON FUNCTION public.has_role(uuid, public.app_role) FROM anon;
REVOKE EXECUTE ON FUNCTION public.claim_earnings() FROM anon, PUBLIC;
