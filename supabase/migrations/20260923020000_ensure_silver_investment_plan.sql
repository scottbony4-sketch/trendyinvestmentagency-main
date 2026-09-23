INSERT INTO public.investment_plans
  (name, slug, description, duration_days, daily_return_percent, roi_percent, min_amount, max_amount, amount_presets, color, icon, sort_order, is_active)
VALUES
  ('Silver', 'silver', '90-day USD investment with 20% weekly profit.', 90, 20.0 / 7.0, 20, 250, 250, '[250]'::jsonb, '#94A3B8', 'trending-up', 2, true)
ON CONFLICT (slug) DO UPDATE SET
  name = EXCLUDED.name,
  description = EXCLUDED.description,
  duration_days = EXCLUDED.duration_days,
  daily_return_percent = EXCLUDED.daily_return_percent,
  roi_percent = EXCLUDED.roi_percent,
  min_amount = EXCLUDED.min_amount,
  max_amount = EXCLUDED.max_amount,
  amount_presets = EXCLUDED.amount_presets,
  color = EXCLUDED.color,
  icon = EXCLUDED.icon,
  sort_order = EXCLUDED.sort_order,
  is_active = true,
  updated_at = now();