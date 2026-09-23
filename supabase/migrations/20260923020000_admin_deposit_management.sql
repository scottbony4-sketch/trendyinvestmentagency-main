CREATE OR REPLACE FUNCTION public.admin_create_deposit_for_user(_user_id uuid, _plan_id uuid, _amount numeric)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  admin_id uuid := auth.uid();
  deposit_id uuid;
BEGIN
  IF admin_id IS NULL OR NOT public.has_role(admin_id, 'admin') THEN
    RAISE EXCEPTION 'Only administrators can create deposits for users.';
  END IF;

  IF _user_id IS NULL OR _user_id = admin_id THEN
    RAISE EXCEPTION 'Administrators cannot create deposits for their own account.';
  END IF;

  IF NOT EXISTS (SELECT 1 FROM public.profiles WHERE id = _user_id) THEN
    RAISE EXCEPTION 'The selected user does not exist.';
  END IF;

  PERFORM public.usd_plan_snapshot(_plan_id, _amount);

  INSERT INTO public.deposits (user_id, amount, mpesa_code, status, plan_id, payer_name)
  VALUES (
    _user_id,
    _amount,
    'ADMIN-' || upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 12)),
    'pending',
    _plan_id,
    'Admin deposit'
  )
  RETURNING id INTO deposit_id;

  UPDATE public.deposits
  SET status = 'approved'
  WHERE id = deposit_id;

  RETURN deposit_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.admin_create_deposit_for_user(uuid, uuid, numeric) TO authenticated;
