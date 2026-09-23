CREATE OR REPLACE FUNCTION public.delete_referral_reward(p_referral_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  reward public.referral_earnings%ROWTYPE;
BEGIN
  IF NOT public.has_role(auth.uid(), 'admin') THEN
    RAISE EXCEPTION 'Only administrators can delete referral rewards';
  END IF;

  SELECT * INTO reward
  FROM public.referral_earnings
  WHERE id = p_referral_id
  FOR UPDATE;

  IF reward.id IS NULL THEN
    RAISE EXCEPTION 'Referral reward not found';
  END IF;

  IF reward.status = 'paid' THEN
    UPDATE public.profiles
    SET balance = GREATEST(COALESCE(balance, 0) - reward.amount, 0)
    WHERE id = reward.referrer_id;

    DELETE FROM public.transactions
    WHERE type = 'referral'
      AND (metadata->>'commission_id' = reward.id::text OR metadata->>'deposit_id' = reward.deposit_id::text);
  END IF;

  DELETE FROM public.referral_earnings
  WHERE id = reward.id;
END;
$$;

REVOKE ALL ON FUNCTION public.delete_referral_reward(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.delete_referral_reward(uuid) TO authenticated;
