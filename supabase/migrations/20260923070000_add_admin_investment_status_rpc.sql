CREATE OR REPLACE FUNCTION public.set_investment_status(p_investment_id uuid, p_status text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT public.has_role(auth.uid(), 'admin') THEN
    RAISE EXCEPTION 'Only administrators can change investment status';
  END IF;

  IF p_status NOT IN ('active', 'paused') THEN
    RAISE EXCEPTION 'Investment status must be active or paused';
  END IF;

  UPDATE public.investments
  SET status = p_status
  WHERE id = p_investment_id
    AND status IN ('active', 'paused');

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Active or paused investment not found';
  END IF;
END;
$$;

REVOKE ALL ON FUNCTION public.set_investment_status(uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.set_investment_status(uuid, text) TO authenticated;
