import { useEffect, useState } from "react";
import type { User } from "@supabase/supabase-js";
import { supabase } from "@/integrations/supabase/client";

export function useAuth() {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const { data: sub } = supabase.auth.onAuthStateChange((_e, session) => {
      setUser(session?.user ?? null);
    });
    supabase.auth.getSession().then(({ data }) => {
      setUser(data.session?.user ?? null);
      setLoading(false);
    });
    return () => sub.subscription.unsubscribe();
  }, []);

  return { user, loading };
}

export const USD_PLAN_CONFIG = {
  bronze: { name: "BRONZE", minAmount: 100, profitRate: 20, cycleDays: 7, durationDays: 90, currency: "USD", symbol: "$", code: "USD" },
  silver: { name: "SILVER", minAmount: 250, profitRate: 20, cycleDays: 7, durationDays: 90, currency: "USD", symbol: "$", code: "USD" },
  gold: { name: "GOLD", minAmount: 500, profitRate: 20, cycleDays: 7, durationDays: 90, currency: "USD", symbol: "$", code: "USD" },
};

export const PLANS = [100, 250, 500];
export const USD_TO_KES_RATE = Number(import.meta.env.VITE_USD_TO_KES_RATE || 130);
export const formatCurrency = (n: number | string, digits = 2) =>
  new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", minimumFractionDigits: digits, maximumFractionDigits: digits }).format(Number(n || 0));
export const fmt = (n: number | string) => formatCurrency(n, 2);
export const fmtKes = (n: number | string) =>
  new Intl.NumberFormat("en-KE", { style: "currency", currency: "KES", minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(Number(n || 0));

export function useIsAdmin(userId: string | undefined) {
  const [isAdmin, setIsAdmin] = useState(false);
  useEffect(() => {
    if (!userId) return;
    supabase.from("user_roles").select("role").eq("user_id", userId).eq("role", "admin").maybeSingle()
      .then(({ data }) => setIsAdmin(!!data));
  }, [userId]);
  return isAdmin;
}