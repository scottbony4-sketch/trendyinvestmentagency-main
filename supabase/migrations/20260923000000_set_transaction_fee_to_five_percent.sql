ALTER TABLE public.app_settings
  ALTER COLUMN withdrawal_fee_percent SET DEFAULT 5;

UPDATE public.app_settings
SET withdrawal_fee_percent = 5,
    withdrawal_fee_enabled = true
WHERE id = 1;