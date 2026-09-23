-- Referral commissions are derived exclusively from confirmed USD deposits.
-- The deposit trigger is the only path that credits referral commissions.

ALTER TABLE public.referral_earnings
  ADD COLUMN IF NOT EXISTS deposit_amount numeric(14,6),
  ADD COLUMN IF NOT EXISTS currency text NOT NULL DEFAULT 'USD',
  ADD COLUMN IF NOT EXISTS investment_id uuid REFERENCES public.investments(id) ON DELETE SET NULL;

UPDATE public.referral_earnings AS re
SET deposit_amount = d.amount,
    currency = 'USD'
FROM public.deposits AS d
WHERE d.id = re.deposit_id
  AND re.deposit_amount IS NULL;

CREATE OR REPLACE FUNCTION public.activate_deposit()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  snapshot RECORD;
  investment_id uuid;
  start_day date;
  maturity_day date;
  level_one uuid;
  level_two uuid;
  commission numeric(14,6);
  inserted_count integer;
  commission_id uuid;
BEGIN
  IF NEW.status = 'approved' AND OLD.status = 'pending' THEN
    SELECT id INTO investment_id FROM public.investments WHERE deposit_id = NEW.id LIMIT 1;
    IF investment_id IS NOT NULL THEN
      NEW.processed_at := COALESCE(NEW.processed_at, now());
      RETURN NEW;
    END IF;

    SELECT * INTO snapshot FROM public.usd_plan_snapshot(NEW.plan_id, NEW.amount);
    start_day := (now() AT TIME ZONE 'Africa/Nairobi')::date;
    maturity_day := start_day + snapshot.term_days - 1;
    INSERT INTO public.investments (
      user_id, plan_id, plan_amount, principal_amount, plan_name, currency,
      daily_return, daily_profit, weekly_profit, duration_days, term_days,
      cycle_days, start_at, end_at, start_date, maturity_date, current_cycle_start,
      current_cycle_end, projected_payout, roi_percent, profit_rate, status,
      payment_source, deposit_id
    ) VALUES (
      NEW.user_id, NEW.plan_id, snapshot.principal, snapshot.principal, snapshot.plan_name,
      'USD', snapshot.daily_profit, snapshot.daily_profit, snapshot.weekly_profit,
      snapshot.term_days, snapshot.term_days, snapshot.cycle_days, now(),
      now() + interval '90 days', start_day, maturity_day, start_day, start_day + 6,
      snapshot.principal + (snapshot.weekly_profit * snapshot.term_days / snapshot.cycle_days),
      snapshot.profit_rate, snapshot.profit_rate, 'active', 'mpesa', NEW.id
    ) RETURNING id INTO investment_id;

    NEW.processed_at := now();
    INSERT INTO public.transactions (user_id, type, amount, status, reference, description, metadata)
    VALUES (NEW.user_id, 'deposit', NEW.amount, 'completed', NEW.mpesa_code,
      'USD deposit approved', jsonb_build_object('currency', 'USD'));
    INSERT INTO public.transactions (user_id, type, amount, status, reference, description, metadata)
    VALUES (NEW.user_id, 'investment', NEW.amount, 'active', investment_id::text,
      'USD investment started', jsonb_build_object('plan_id', NEW.plan_id, 'term_days', 90, 'cycle_days', 7));

    SELECT referred_by INTO level_one FROM public.profiles WHERE id = NEW.user_id;
    IF level_one IS NOT NULL AND level_one <> NEW.user_id THEN
      commission := ROUND(NEW.amount * 0.20, 6);
      INSERT INTO public.referral_earnings
        (referrer_id, referred_id, deposit_id, investment_id, amount, deposit_amount, percent, level, currency, status)
      VALUES (level_one, NEW.user_id, NEW.id, investment_id, commission, NEW.amount, 20, 1, 'USD', 'paid')
      ON CONFLICT (deposit_id, referrer_id, level) DO NOTHING;
      GET DIAGNOSTICS inserted_count = ROW_COUNT;
      IF inserted_count = 1 THEN
        SELECT id INTO commission_id FROM public.referral_earnings
        WHERE deposit_id = NEW.id AND referrer_id = level_one AND level = 1;
        UPDATE public.profiles SET balance = COALESCE(balance, 0) + commission WHERE id = level_one;
        INSERT INTO public.transactions (user_id, type, amount, status, reference, description, metadata)
        VALUES (level_one, 'referral', commission, 'completed', NEW.id::text,
          'Level 1 referral commission', jsonb_build_object(
            'commission_id', commission_id, 'beneficiary_user_id', level_one,
            'referred_user_id', NEW.user_id, 'deposit_transaction_id', NEW.id,
            'investment_id', investment_id, 'referral_level', 1,
            'commission_percentage', 20, 'deposit_amount', NEW.amount,
            'commission_amount', commission, 'currency', 'USD'));
      END IF;

      SELECT referred_by INTO level_two FROM public.profiles WHERE id = level_one;
      IF level_two IS NOT NULL AND level_two <> NEW.user_id AND level_two <> level_one THEN
        commission := ROUND(NEW.amount * 0.03, 6);
        INSERT INTO public.referral_earnings
          (referrer_id, referred_id, deposit_id, investment_id, amount, deposit_amount, percent, level, currency, status)
        VALUES (level_two, NEW.user_id, NEW.id, investment_id, commission, NEW.amount, 3, 2, 'USD', 'paid')
        ON CONFLICT (deposit_id, referrer_id, level) DO NOTHING;
        GET DIAGNOSTICS inserted_count = ROW_COUNT;
        IF inserted_count = 1 THEN
          SELECT id INTO commission_id FROM public.referral_earnings
          WHERE deposit_id = NEW.id AND referrer_id = level_two AND level = 2;
          UPDATE public.profiles SET balance = COALESCE(balance, 0) + commission WHERE id = level_two;
          INSERT INTO public.transactions (user_id, type, amount, status, reference, description, metadata)
          VALUES (level_two, 'referral', commission, 'completed', NEW.id::text,
            'Level 2 referral commission', jsonb_build_object(
              'commission_id', commission_id, 'beneficiary_user_id', level_two,
              'referred_user_id', NEW.user_id, 'deposit_transaction_id', NEW.id,
              'investment_id', investment_id, 'referral_level', 2,
              'commission_percentage', 3, 'deposit_amount', NEW.amount,
              'commission_amount', commission, 'currency', 'USD'));
        END IF;
      END IF;
    END IF;
  ELSIF NEW.status IN ('rejected', 'cancelled', 'reversed') AND OLD.status = 'pending' THEN
    NEW.processed_at := now();
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS activate_deposit ON public.deposits;
CREATE TRIGGER activate_deposit
  AFTER UPDATE OF status ON public.deposits
  FOR EACH ROW WHEN (OLD.status IS DISTINCT FROM NEW.status)
  EXECUTE FUNCTION public.activate_deposit();-- Referral commissions are derived exclusively from confirmed USD deposits.
-- The deposit trigger is the only path that credits referral commissions.

ALTER TABLE public.referral_earnings
  ADD COLUMN IF NOT EXISTS deposit_amount numeric(14,6),
  ADD COLUMN IF NOT EXISTS currency text NOT NULL DEFAULT 'USD',
  ADD COLUMN IF NOT EXISTS investment_id uuid REFERENCES public.investments(id) ON DELETE SET NULL;

UPDATE public.referral_earnings AS re
SET deposit_amount = d.amount,
    currency = 'USD'
FROM public.deposits AS d
WHERE d.id = re.deposit_id
  AND re.deposit_amount IS NULL;

