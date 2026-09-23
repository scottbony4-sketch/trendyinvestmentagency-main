-- Ensure the plan deletion RPC exists in deployed environments and avoids
-- ambiguity between its argument and the plan_id columns it filters.
DROP FUNCTION IF EXISTS public.delete_mining_plan_with_related_data(uuid);

CREATE OR REPLACE FUNCTION public.delete_mining_plan_with_related_data(plan_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  plan_exists boolean;
  investment_count integer;
  deposit_count integer;
  earning_count integer;
  referral_count integer;
  transaction_count integer;
<<delete_plan>>
BEGIN
  IF NOT public.has_role(auth.uid(), 'admin') THEN
    RAISE EXCEPTION 'Not authorized';
  END IF;

  SELECT EXISTS (
    SELECT 1 FROM public.investment_plans AS p WHERE p.id = delete_plan.plan_id
  ) INTO plan_exists;
  IF NOT plan_exists THEN
    RAISE EXCEPTION 'Plan not found';
  END IF;

  SELECT COUNT(*) INTO investment_count
  FROM public.investments AS i
  WHERE i.plan_id = delete_plan.plan_id;
  SELECT COUNT(*) INTO deposit_count
  FROM public.deposits AS d
  WHERE d.plan_id = delete_plan.plan_id;
  SELECT COUNT(*) INTO earning_count
  FROM public.daily_earnings AS de
  JOIN public.investments AS i ON i.id = de.investment_id
  WHERE i.plan_id = delete_plan.plan_id;
  SELECT COUNT(*) INTO referral_count
  FROM public.referral_earnings AS re
  JOIN public.deposits AS d ON d.id = re.deposit_id
  WHERE d.plan_id = delete_plan.plan_id;
  SELECT COUNT(*) INTO transaction_count
  FROM public.transactions AS t
      WHERE t.metadata->>'plan_id' = delete_plan.plan_id::text
        OR t.metadata->>'planId' = delete_plan.plan_id::text;

  DELETE FROM public.daily_earnings AS de
  USING public.investments AS i
  WHERE de.investment_id = i.id
    AND i.plan_id = delete_plan.plan_id;

  DELETE FROM public.referral_earnings AS re
  USING public.deposits AS d
  WHERE re.deposit_id = d.id
    AND d.plan_id = delete_plan.plan_id;

  DELETE FROM public.transactions AS t
      WHERE t.metadata->>'plan_id' = delete_plan.plan_id::text
        OR t.metadata->>'planId' = delete_plan.plan_id::text;

  DELETE FROM public.deposits AS d WHERE d.plan_id = delete_plan.plan_id;
  DELETE FROM public.investments AS i WHERE i.plan_id = delete_plan.plan_id;
  DELETE FROM public.investment_plans AS p WHERE p.id = delete_plan.plan_id;

  RETURN jsonb_build_object(
    'message', 'Plan and related data deleted.',
    'plan_id', delete_plan.plan_id,
    'investment_count', investment_count,
    'deposit_count', deposit_count,
    'earning_count', earning_count,
    'referral_count', referral_count,
    'transaction_count', transaction_count
  );
END;
$$;

REVOKE ALL ON FUNCTION public.delete_mining_plan_with_related_data(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.delete_mining_plan_with_related_data(uuid) TO authenticated;