-- Credit the first daily earning immediately when an investment starts,
-- then allow later daily earnings to unlock on their own earning dates.

CREATE OR REPLACE FUNCTION public.generate_daily_earnings()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  inv RECORD;
  plan_roi numeric(14, 2);
  total_profit numeric(14, 2);
  total_return numeric(14, 2);
  base_daily numeric(14, 2);
  remainder numeric(14, 2);
  duration_days integer;
  start_date date;
  today_date date;
  earning_date_value date;
  day_index integer;
  inserted_count integer := 0;
  inserted_row_count integer := 0;
  amount numeric(14, 2);
  initial_release_exists boolean;
  release_status text;
  release_to_balance boolean;
BEGIN
  today_date := (now() AT TIME ZONE 'Africa/Nairobi')::date;

  UPDATE public.investments AS i
  SET roi_percent = COALESCE(
        i.roi_percent,
        p.roi_percent,
        CASE
          WHEN COALESCE(i.duration_days, p.duration_days, 7) <= 7 THEN 40
          WHEN COALESCE(i.duration_days, p.duration_days, 17) <= 17 THEN 80
          ELSE 130
        END
      ),
      projected_payout = ROUND(
        COALESCE(i.plan_amount, 0) * (1 + COALESCE(
          i.roi_percent,
          p.roi_percent,
          CASE
            WHEN COALESCE(i.duration_days, p.duration_days, 7) <= 7 THEN 40
            WHEN COALESCE(i.duration_days, p.duration_days, 17) <= 17 THEN 80
            ELSE 130
          END
        ) / 100.0),
        2
      ),
      daily_return = FLOOR(
        ROUND(
          COALESCE(i.plan_amount, 0) * (1 + COALESCE(
            i.roi_percent,
            p.roi_percent,
            CASE
              WHEN COALESCE(i.duration_days, p.duration_days, 7) <= 7 THEN 40
              WHEN COALESCE(i.duration_days, p.duration_days, 17) <= 17 THEN 80
              ELSE 130
            END
          ) / 100.0),
          2
        ) / GREATEST(COALESCE(i.duration_days, p.duration_days, 1), 1)
      )
  FROM public.investment_plans AS p
  WHERE i.status = 'active'
    AND i.plan_id = p.id;

  FOR inv IN
    SELECT
      i.id,
      i.user_id,
      i.plan_id,
      i.plan_amount,
      i.duration_days,
      i.start_at,
      i.end_at,
      i.roi_percent,
      i.status
    FROM public.investments AS i
    WHERE i.status = 'active'
      AND i.start_at IS NOT NULL
      AND (i.end_at IS NULL OR i.end_at >= now())
  LOOP
    duration_days := GREATEST(COALESCE(inv.duration_days, 1), 1);
    start_date := (inv.start_at AT TIME ZONE 'Africa/Nairobi')::date;

    plan_roi := COALESCE(
      inv.roi_percent,
      (SELECT p.roi_percent FROM public.investment_plans AS p WHERE p.id = inv.plan_id),
      0
    );
    total_profit := ROUND(COALESCE(inv.plan_amount, 0) * (plan_roi / 100.0), 2);
    total_return := COALESCE(inv.plan_amount, 0) + total_profit;
    base_daily := FLOOR(total_return / duration_days);
    remainder := total_return - (base_daily * duration_days);

    FOR day_index IN 1..duration_days LOOP
      earning_date_value := start_date + (day_index - 1) * INTERVAL '1 day';
      IF earning_date_value > today_date THEN
        EXIT;
      END IF;

      amount := base_daily;
      IF day_index = duration_days THEN
        amount := base_daily + remainder;
      END IF;

      IF amount <= 0 THEN
        CONTINUE;
      END IF;

      release_status := 'pending';
      release_to_balance := FALSE;
      initial_release_exists := EXISTS (
        SELECT 1
        FROM public.daily_earnings AS de
        WHERE de.investment_id = inv.id
          AND de.earning_date = earning_date_value
          AND de.added_to_balance = TRUE
          AND de.status = 'released'
      );

      IF day_index = 1 THEN
        release_status := 'released';
        release_to_balance := TRUE;
      END IF;

      INSERT INTO public.daily_earnings (
        investment_id,
        user_id,
        earning_date,
        amount,
        status,
        added_to_balance
      )
      VALUES (
        inv.id,
        inv.user_id,
        earning_date_value,
        amount,
        release_status,
        release_to_balance
      )
      ON CONFLICT (investment_id, earning_date) DO UPDATE
      SET amount = EXCLUDED.amount,
          status = EXCLUDED.status,
          added_to_balance = EXCLUDED.added_to_balance
      WHERE public.daily_earnings.added_to_balance = FALSE
        OR public.daily_earnings.status <> 'released';

      GET DIAGNOSTICS inserted_row_count = ROW_COUNT;
      IF inserted_row_count > 0 THEN
        inserted_count := inserted_count + 1;
      END IF;

      IF day_index = 1 AND NOT initial_release_exists THEN
        UPDATE public.profiles
        SET balance = COALESCE(balance, 0) + amount
        WHERE id = inv.user_id;

        INSERT INTO public.transactions (
          user_id,
          type,
          amount,
          status,
          description,
          metadata
        )
        VALUES (
          inv.user_id,
          'daily_earning',
          amount,
          'completed',
          'Initial daily mining earning credited',
          jsonb_build_object(
            'earning_id',
            (
              SELECT de.id
              FROM public.daily_earnings AS de
              WHERE de.investment_id = inv.id
                AND de.earning_date = earning_date_value
              ORDER BY de.earning_date DESC
              LIMIT 1
            ),
            'earning_date',
            earning_date_value
          )
        );
      END IF;
    END LOOP;
  END LOOP;

  RETURN inserted_count;
END;
$$;

CREATE OR REPLACE FUNCTION public.release_unlocked_daily_earnings()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  row_record RECORD;
  today_date date;
  released_count integer := 0;
BEGIN
  today_date := (now() AT TIME ZONE 'Africa/Nairobi')::date;

  FOR row_record IN
    SELECT
      de.id,
      de.investment_id,
      de.user_id,
      de.earning_date,
      de.amount
    FROM public.daily_earnings AS de
    JOIN public.investments AS i ON i.id = de.investment_id
    WHERE de.added_to_balance = FALSE
      AND de.status = 'pending'
      AND de.earning_date <= today_date
      AND i.status IN ('active', 'completed')
  LOOP
    UPDATE public.daily_earnings
    SET added_to_balance = TRUE,
        status = 'released'
    WHERE id = row_record.id
      AND added_to_balance = FALSE
      AND status = 'pending';

    IF FOUND THEN
      UPDATE public.profiles
      SET balance = COALESCE(balance, 0) + row_record.amount
      WHERE id = row_record.user_id;

      INSERT INTO public.transactions (
        user_id,
        type,
        amount,
        status,
        description,
        metadata
      )
      VALUES (
        row_record.user_id,
        'daily_earning',
        row_record.amount,
        'completed',
        'Daily mining earning released',
        jsonb_build_object('earning_id', row_record.id, 'earning_date', row_record.earning_date)
      );

      released_count := released_count + 1;
    END IF;
  END LOOP;

  RETURN released_count;
END;
$$;

CREATE OR REPLACE FUNCTION public.activate_deposit()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  inv_id uuid;
  plan_rec RECORD;
  p_roi numeric(6, 2);
  p_days integer;
  total_profit numeric(14, 2);
  projected numeric(14, 2);
  p_daily numeric(14, 2);
  existing_inv_id uuid;
  earning_id uuid;
  earning_date_value date;
  inserted_row_count integer := 0;
BEGIN
  IF NEW.status = 'approved' AND OLD.status = 'pending' THEN
    SELECT id INTO existing_inv_id
    FROM public.investments
    WHERE deposit_id = NEW.id
    LIMIT 1;

    IF existing_inv_id IS NOT NULL THEN
      NEW.processed_at = COALESCE(NEW.processed_at, now());
      RETURN NEW;
    END IF;

    IF NEW.plan_id IS NOT NULL THEN
      SELECT * INTO plan_rec FROM public.investment_plans WHERE id = NEW.plan_id;
      p_days := COALESCE(plan_rec.duration_days, 7);
      p_roi := COALESCE(plan_rec.roi_percent, CASE WHEN p_days <= 7 THEN 40 WHEN p_days <= 17 THEN 80 ELSE 130 END);
    ELSE
      p_days := 7;
      p_roi := 40;
    END IF;

    total_profit := ROUND(NEW.amount * (p_roi / 100.0), 2);
    projected := NEW.amount + total_profit;
    p_daily := FLOOR(projected / GREATEST(p_days, 1));
    IF p_daily < 0 THEN
      p_daily := 0;
    END IF;

    INSERT INTO public.investments (
      user_id,
      plan_id,
      plan_amount,
      daily_return,
      duration_days,
      start_at,
      end_at,
      projected_payout,
      roi_percent,
      status,
      payment_source,
      deposit_id
    )
    VALUES (
      NEW.user_id,
      NEW.plan_id,
      NEW.amount,
      p_daily,
      p_days,
      now(),
      now() + (p_days || ' days')::interval,
      projected,
      p_roi,
      'active',
      'mpesa',
      NEW.id
    )
    RETURNING id INTO inv_id;

    earning_date_value := (now() AT TIME ZONE 'Africa/Nairobi')::date;
    IF p_daily > 0 THEN
      INSERT INTO public.daily_earnings (
        investment_id,
        user_id,
        earning_date,
        amount,
        status,
        added_to_balance
      )
      VALUES (inv_id, NEW.user_id, earning_date_value, p_daily, 'released', TRUE)
      ON CONFLICT (investment_id, earning_date) DO UPDATE
      SET amount = EXCLUDED.amount,
          status = 'released',
          added_to_balance = TRUE
      WHERE public.daily_earnings.added_to_balance = FALSE
        OR public.daily_earnings.status <> 'released'
      RETURNING id INTO earning_id;

      GET DIAGNOSTICS inserted_row_count = ROW_COUNT;
      IF inserted_row_count > 0 THEN
        UPDATE public.profiles
        SET balance = COALESCE(balance, 0) + p_daily
        WHERE id = NEW.user_id;

        INSERT INTO public.transactions (
          user_id,
          type,
          amount,
          status,
          description,
          metadata
        )
        VALUES (
          NEW.user_id,
          'daily_earning',
          p_daily,
          'completed',
          'Initial daily mining earning credited',
          jsonb_build_object('earning_id', earning_id, 'earning_date', earning_date_value)
        );
      END IF;
    END IF;

    NEW.processed_at = now();

    INSERT INTO public.transactions (
      user_id,
      type,
      amount,
      status,
      reference,
      description
    )
    VALUES (NEW.user_id, 'deposit', NEW.amount, 'completed', NULL, 'Deposit approved');

    INSERT INTO public.transactions (
      user_id,
      type,
      amount,
      status,
      reference,
      description,
      metadata
    )
    VALUES (
      NEW.user_id,
      'investment',
      NEW.amount,
      'active',
      NULL,
      'Mining cycle started',
      jsonb_build_object('plan_id', NEW.plan_id, 'projected', projected)
    );

    INSERT INTO public.notifications (
      user_id,
      type,
      title,
      body,
      link
    )
    VALUES (
      NEW.user_id,
      'success',
      'Deposit approved',
      'Your deposit of KSh ' || NEW.amount || ' has been approved. Projected payout KSh ' || projected || '.',
      '/dashboard'
    );
  ELSIF NEW.status = 'rejected' AND OLD.status = 'pending' THEN
    NEW.processed_at = now();
    INSERT INTO public.transactions (
      user_id,
      type,
      amount,
      status,
      reference,
      description
    )
    VALUES (NEW.user_id, 'deposit', NEW.amount, 'rejected', NULL, 'Deposit rejected');

    INSERT INTO public.notifications (
      user_id,
      type,
      title,
      body,
      link
    )
    VALUES (
      NEW.user_id,
      'warning',
      'Deposit rejected',
      COALESCE(NEW.admin_note, 'Your deposit was not approved.'),
      '/deposit'
    );
  END IF;

  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.create_balance_investment(_plan_id uuid, _amount numeric)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  uid uuid := auth.uid();
  prof public.profiles%ROWTYPE;
  plan public.investment_plans%ROWTYPE;
  roi numeric;
  total_profit numeric(14, 2);
  projected numeric(14, 2);
  daily_return numeric(14, 2);
  inv_id uuid;
  earning_id uuid;
  earning_date_value date;
  inserted_row_count integer := 0;
BEGIN
  IF uid IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  SELECT * INTO prof FROM public.profiles WHERE id = uid FOR UPDATE;
  IF prof IS NULL THEN
    RAISE EXCEPTION 'User profile not found';
  END IF;
  IF prof.deleted_at IS NOT NULL OR prof.status = 'suspended' THEN
    RAISE EXCEPTION 'Your account is not eligible to reinvest.';
  END IF;
  IF prof.balance < _amount THEN
    RAISE EXCEPTION 'Your available balance is not enough for this mining plan.';
  END IF;

  SELECT * INTO plan FROM public.investment_plans WHERE id = _plan_id AND is_active;
  IF plan IS NULL THEN
    RAISE EXCEPTION 'Mining plan not found';
  END IF;
  IF _amount < plan.min_amount THEN
    RAISE EXCEPTION 'Minimum investment is KSh %', plan.min_amount;
  END IF;
  IF plan.max_amount IS NOT NULL AND _amount > plan.max_amount THEN
    RAISE EXCEPTION 'Maximum investment is KSh %', plan.max_amount;
  END IF;

  roi := COALESCE(
    plan.roi_percent,
    CASE
      WHEN plan.duration_days <= 7 THEN 40
      WHEN plan.duration_days <= 17 THEN 80
      ELSE 130
    END
  );
  total_profit := ROUND(_amount * (roi / 100.0), 2);
  projected := _amount + total_profit;
  daily_return := FLOOR(projected / GREATEST(plan.duration_days, 1));
  IF daily_return < 0 THEN
    daily_return := 0;
  END IF;

  UPDATE public.profiles
  SET balance = balance - _amount
  WHERE id = uid;

  INSERT INTO public.investments (
    user_id,
    plan_id,
    plan_amount,
    daily_return,
    duration_days,
    start_at,
    end_at,
    projected_payout,
    roi_percent,
    status,
    payment_source,
    unlock_day
  )
  VALUES (
    uid,
    plan.id,
    _amount,
    daily_return,
    plan.duration_days,
    now(),
    now() + plan.duration_days * interval '1 day',
    projected,
    roi,
    'active',
    'balance',
    COALESCE(
      plan.unlock_day,
      CASE
        WHEN plan.duration_days <= 7 THEN 1
        WHEN plan.duration_days <= 17 THEN 7
        WHEN plan.duration_days <= 28 THEN 21
        ELSE 1
      END
    )
  )
  RETURNING id INTO inv_id;

  earning_date_value := (now() AT TIME ZONE 'Africa/Nairobi')::date;
  IF daily_return > 0 THEN
    INSERT INTO public.daily_earnings (
      investment_id,
      user_id,
      earning_date,
      amount,
      status,
      added_to_balance
    )
    VALUES (inv_id, uid, earning_date_value, daily_return, 'released', TRUE)
    ON CONFLICT (investment_id, earning_date) DO UPDATE
    SET amount = EXCLUDED.amount,
        status = 'released',
        added_to_balance = TRUE
    WHERE public.daily_earnings.added_to_balance = FALSE
      OR public.daily_earnings.status <> 'released'
    RETURNING id INTO earning_id;

    GET DIAGNOSTICS inserted_row_count = ROW_COUNT;
    IF inserted_row_count > 0 THEN
      UPDATE public.profiles
      SET balance = COALESCE(balance, 0) + daily_return
      WHERE id = uid;

      INSERT INTO public.transactions (
        user_id,
        type,
        amount,
        status,
        description,
        metadata
      )
      VALUES (
        uid,
        'daily_earning',
        daily_return,
        'completed',
        'Initial daily mining earning credited',
        jsonb_build_object('earning_id', earning_id, 'earning_date', earning_date_value)
      );
    END IF;
  END IF;

  INSERT INTO public.transactions (
    user_id,
    type,
    amount,
    status,
    reference,
    description,
    metadata
  )
  VALUES (
    uid,
    'investment',
    _amount,
    'active',
    NULL,
    'Reinvestment from account balance',
    jsonb_build_object(
      'plan_id', plan.id,
      'payment_source', 'balance',
      'duration_days', plan.duration_days,
      'projected_payout', projected,
      'roi_percent', roi
    )
  );

  RETURN inv_id;
END;
$$;

SELECT public.generate_daily_earnings();
SELECT public.release_unlocked_daily_earnings();
