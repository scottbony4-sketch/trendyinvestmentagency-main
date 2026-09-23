-- Permanent deletion of a mining plan and related financial activity.
-- This function is intentionally guarded so it can only be run by an authenticated admin.
-- It removes linked rows from deposits, investments, daily_earnings, referral_earnings,
-- transactions, and the plan itself in a single transaction.

CREATE OR REPLACE FUNCTION public.delete_mining_plan_with_related_data(plan_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  plan_exists boolean;
  investment_count integer;
  deposit_count integer;
  earning_count integer;
  referral_count integer;
  transaction_count integer;
BEGIN
  IF NOT public.has_role(auth.uid(), 'admin') THEN
    RAISE EXCEPTION 'Not authorized';
  END IF;

  SELECT EXISTS (SELECT 1 FROM public.investment_plans WHERE id = plan_id) INTO plan_exists;
  IF NOT plan_exists THEN
    RAISE EXCEPTION 'Plan not found';
  END IF;

  SELECT COUNT(*) INTO investment_count FROM public.investments WHERE plan_id = plan_id;
  SELECT COUNT(*) INTO deposit_count FROM public.deposits WHERE plan_id = plan_id;
  SELECT COUNT(*) INTO earning_count FROM public.daily_earnings de
  JOIN public.investments i ON i.id = de.investment_id
  WHERE i.plan_id = plan_id;
  SELECT COUNT(*) INTO referral_count FROM public.referral_earnings re
  JOIN public.deposits d ON d.id = re.deposit_id
  WHERE d.plan_id = plan_id;
  SELECT COUNT(*) INTO transaction_count FROM public.transactions t
  WHERE t.metadata->>'plan_id' = plan_id::text
     OR t.metadata->>'planId' = plan_id::text;

  DELETE FROM public.daily_earnings de
  USING public.investments i
  WHERE de.investment_id = i.id
    AND i.plan_id = plan_id;

  DELETE FROM public.referral_earnings re
  USING public.deposits d
  WHERE re.deposit_id = d.id
    AND d.plan_id = plan_id;

  DELETE FROM public.transactions t
  WHERE t.metadata->>'plan_id' = plan_id::text
     OR t.metadata->>'planId' = plan_id::text;

  DELETE FROM public.deposits WHERE plan_id = plan_id;
  DELETE FROM public.investments WHERE plan_id = plan_id;
  DELETE FROM public.investment_plans WHERE id = plan_id;

  RETURN jsonb_build_object(
    'message', 'Plan and related data deleted.',
    'plan_id', plan_id,
    'investment_count', investment_count,
    'deposit_count', deposit_count,
    'earning_count', earning_count,
    'referral_count', referral_count,
    'transaction_count', transaction_count
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.delete_mining_plan_with_related_data(uuid) TO authenticated;
