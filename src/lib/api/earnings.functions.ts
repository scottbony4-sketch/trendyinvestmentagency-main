import { supabase } from "@/integrations/supabase/client";

export async function generateDailyEarnings() {
  const { data, error } = await supabase.rpc("generate_daily_earnings");
  if (error) throw error;
  return Number(data ?? 0);
}

export async function releaseUnlockedEarnings() {
  const { data, error } = await supabase.rpc("release_unlocked_daily_earnings");
  if (error) throw error;
  return Number(data ?? 0);
}
