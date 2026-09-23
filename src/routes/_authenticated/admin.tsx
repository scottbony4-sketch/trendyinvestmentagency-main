import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState, useCallback, useMemo } from "react";
import { Archive, ArrowDownToLine, ArrowUpFromLine, BadgeCheck, Ban, BarChart3, CircleDollarSign, Clock3, Coins, Eye, Lock, Pencil, Play, Trash2, TrendingUp, Users, Wallet } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { fmt, fmtKes, USD_TO_KES_RATE } from "@/lib/auth";
import { getSiteUrl } from "@/lib/site-url";
import { sendAccountStatusEmail, sendDepositApprovedEmail, sendDepositRejectedEmail, sendWithdrawalApprovedEmail, sendWithdrawalRejectedEmail, sendWithdrawalPaidEmail } from "@/lib/api/email.functions";
import { buildReferralAnalytics } from "@/lib/referral-analytics";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Bar, BarChart, CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";

export const Route = createFileRoute("/_authenticated/admin")({
  head: () => ({ meta: [{ title: "Admin — TRENDY INVESTMENT AGENCY" }] }),
  component: AdminPage,
});

type DepositRow = { id: string; user_id: string; amount: number; mpesa_code: string; status: string; created_at: string };
type WithdrawalRow = { id: string; user_id: string; amount: number; fee_amount?: number | null; net_amount?: number | null; mpesa_phone: string; status: string; created_at: string; processed_at: string | null; admin_note: string | null; payout_mpesa_code: string | null };
type ReferralRow = { id: string; referrer_id: string; referred_id: string; deposit_id: string; amount: number; percent: number; status: string; created_at: string };
type ProfileLite = { id: string; full_name: string | null; phone: string | null; balance: number; created_at: string; referral_code?: string | null; referred_by?: string | null; deleted_at?: string | null; status?: string | null };
type ActionRow = { id: string; admin_id: string; target_user_id: string; action: string; amount: number | null; note: string | null; created_at: string };
type PlanRow = {
  id: string; name: string; slug: string; description: string | null;
  duration_days: number; daily_return_percent: number; roi_percent: number | null;
  min_amount: number; max_amount: number | null; unlock_day: number | null;
  amount_presets: number[] | null; color: string | null; icon: string | null;
  sort_order: number; is_active: boolean; archived_at: string | null;
};
type PlanOption = {
  id: string; name: string; slug: string; duration_days: number; roi_percent: number;
  min_amount: number; max_amount: number | null; unlock_day: number | null; amount_presets: number[] | null;
};
type InvestmentRow = {
  id: string; user_id: string; plan_id: string | null; plan_amount: number;
  daily_return: number; duration_days: number; projected_payout: number | null;
  status: string; payment_source: string; created_at: string;
};
type SettingsRow = {
  id: number; referral_percent: number; min_deposit: number;
  min_withdrawal: number; max_withdrawal: number; withdrawal_fee_percent: number;
  withdrawal_fee_enabled?: boolean | null;
  contact_email: string | null; whatsapp: string | null; mpesa_till: string | null;
  maintenance_mode: boolean;
  email_notifications_enabled?: boolean | null;
  email_notifications_deposits?: boolean | null;
  email_notifications_withdrawals?: boolean | null;
  email_notifications_mining?: boolean | null;
  email_notifications_referrals?: boolean | null;
  email_notifications_account?: boolean | null;
};
type DailyEarningAdminRow = {
  id: string; investment_id: string; user_id: string; earning_date: string; amount: number; added_to_balance: boolean; status: string;
};
type AppSettingsRow = {
  withdrawal_fee_percent: number | null;
  withdrawal_fee_enabled?: boolean | null;
  referral_percent: number | null;
  email_notifications_enabled?: boolean | null;
  email_notifications_deposits?: boolean | null;
  email_notifications_withdrawals?: boolean | null;
  email_notifications_mining?: boolean | null;
  email_notifications_referrals?: boolean | null;
  email_notifications_account?: boolean | null;
};
type DateRangePreset = "today" | "week" | "month" | "year" | "all" | "custom";

function nairobiWeekday(): number {
  const s = new Intl.DateTimeFormat("en-GB", { timeZone: "Africa/Nairobi", weekday: "short" }).format(new Date());
  const map: Record<string, number> = { Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6, Sun: 7 };
  return map[s] ?? 1;
}

function getFriendlyErrorMessage(error: { message?: string } | null, fallback = "The request could not be completed.") {
  if (!error?.message) return fallback;
  const message = error.message.toLowerCase();

  if (message.includes("invalid input syntax for type bigint") || message.includes("type bigint") || message.includes("invalid input syntax")) {
    return "Approval failed because the database transaction reference is misconfigured. Please contact support to fix the database trigger.";
  }

  if (message.includes("permission denied") || message.includes("row level security") || message.includes("policy")) {
    return "You do not have permission to perform this action.";
  }

  return error.message;
}

function AdminPage() {
  const [tab, setTab] = useState<"deposits" | "withdrawals" | "users" | "plans" | "settings" | "log" | "referrals" | "earnings" | "money-flow">("deposits");
  const [deposits, setDeposits] = useState<DepositRow[]>([]);
  const [withdrawals, setWithdrawals] = useState<WithdrawalRow[]>([]);
  const [investments, setInvestments] = useState<InvestmentRow[]>([]);
  const [investmentPlans, setInvestmentPlans] = useState<Record<string, string>>({});
  const [referrals, setReferrals] = useState<ReferralRow[]>([]);
  const [profiles, setProfiles] = useState<Record<string, ProfileLite>>({});
  const [profileList, setProfileList] = useState<ProfileLite[]>([]);
  const [userRoles, setUserRoles] = useState<Record<string, string[]>>({});
  const [dailyEarnings, setDailyEarnings] = useState<DailyEarningAdminRow[]>([]);
  const [actions, setActions] = useState<ActionRow[]>([]);
  const [settings, setSettings] = useState<AppSettingsRow | null>(null);
  const [emailLogs, setEmailLogs] = useState<any[]>([]);
  const [transactions, setTransactions] = useState<any[]>([]);
  const [isAdmin, setIsAdmin] = useState<boolean | null>(null);
  const [isSuperAdmin, setIsSuperAdmin] = useState(false);
  const [currentUserEmail, setCurrentUserEmail] = useState<string | null>(null);
  const [moneyRange, setMoneyRange] = useState<DateRangePreset>("all");
  const [customStart, setCustomStart] = useState("");
  const [customEnd, setCustomEnd] = useState("");
  const [depositsPage, setDepositsPage] = useState(1);
  const [depositsRowsPerPage, setDepositsRowsPerPage] = useState(10);
  const [logPage, setLogPage] = useState(1);
  const [logRowsPerPage, setLogRowsPerPage] = useState(10);
  const [emailLogsPage, setEmailLogsPage] = useState(1);
  const [emailLogsRowsPerPage, setEmailLogsRowsPerPage] = useState(10);
  const [referralAnalyticsPage, setReferralAnalyticsPage] = useState(1);
  const [referralAnalyticsRowsPerPage, setReferralAnalyticsRowsPerPage] = useState(10);
  const [selectedDeposit, setSelectedDeposit] = useState<DepositRow | null>(null);

  const refresh = useCallback(async () => {
    const [d, w, i, p, plans, a, r, de, s, emailLogsResult, tx, ur] = await Promise.all([
      supabase.from("deposits").select("*").order("created_at", { ascending: false }),
      supabase.from("withdrawals").select("*").order("created_at", { ascending: false }),
      supabase.from("investments").select("*").order("created_at", { ascending: false }),
      supabase.from("profiles").select("id, full_name, phone, balance, created_at, referral_code, referred_by, deleted_at, status").order("created_at", { ascending: false }),
      supabase.from("investment_plans").select("id, name"),
      supabase.from("admin_actions").select("*").order("created_at", { ascending: false }).limit(100),
      supabase.from("referral_earnings").select("*").order("created_at", { ascending: false }),
      supabase.from("daily_earnings").select("*").order("earning_date", { ascending: false }),
      supabase.from("app_settings").select("withdrawal_fee_percent, withdrawal_fee_enabled, referral_percent, email_notifications_enabled, email_notifications_deposits, email_notifications_withdrawals, email_notifications_mining, email_notifications_referrals, email_notifications_account").eq("id", 1).maybeSingle(),
      supabase.from("email_logs").select("id, user_id, subject, status, created_at, sent_at, meta").order("sent_at", { ascending: false }).limit(40),
      supabase.from("transactions").select("*").order("created_at", { ascending: false }).limit(500),
      supabase.from("user_roles").select("user_id, role"),
    ]);
    if (d.data) setDeposits(d.data as DepositRow[]);
    if (w.data) setWithdrawals(w.data as WithdrawalRow[]);
    if (i.data) setInvestments(i.data as InvestmentRow[]);
    if (p.data) {
      const map: Record<string, ProfileLite> = {};
      for (const row of p.data as ProfileLite[]) map[row.id] = row;
      setProfiles(map);
      setProfileList(p.data as ProfileLite[]);
    }
    if (plans.data) {
      const map: Record<string, string> = {};
      for (const plan of plans.data as { id: string; name: string }[]) map[plan.id] = plan.name;
      setInvestmentPlans(map);
    }
    if (a.data) setActions(a.data as ActionRow[]);
    if (r.data) setReferrals(r.data as ReferralRow[]);
    if (de.data) setDailyEarnings(de.data as DailyEarningAdminRow[]);
    if (s.data) setSettings(s.data as AppSettingsRow);
    if (emailLogsResult.data) setEmailLogs(emailLogsResult.data as any[]);
    if (tx.data) setTransactions(tx.data as any[]);
    if (ur.data) {
      const roleMap: Record<string, string[]> = {};
      for (const row of ur.data as { user_id: string; role: string }[]) {
        if (!roleMap[row.user_id]) roleMap[row.user_id] = [];
        roleMap[row.user_id].push(row.role);
      }
      setUserRoles(roleMap);
    }
  }, []);

  useEffect(() => {
    (async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) { setIsAdmin(false); return; }
      const { data } = await supabase.from("user_roles").select("role").eq("user_id", user.id).eq("role", "admin").maybeSingle();
      const admin = !!data;
      const configuredSuperAdmins = (import.meta.env.VITE_SUPER_ADMIN_EMAILS || "")
        .split(",")
        .map(value => value.trim().toLowerCase())
        .filter(Boolean);
      const superAdmin = admin && (configuredSuperAdmins.length === 0 ? true : configuredSuperAdmins.includes((user.email || "").toLowerCase()));
      setIsAdmin(admin);
      setIsSuperAdmin(superAdmin);
      setCurrentUserEmail(user.email ?? null);
      if (admin) void refresh();
    })();
  }, [refresh]);

  const updateDeposit = async (id: string, status: "approved" | "rejected") => {
    const { data: current, error: fetchErr } = await supabase.from("deposits").select("status").eq("id", id).maybeSingle();
    if (fetchErr) {
      toast.error(getFriendlyErrorMessage(fetchErr, "Unable to load deposit status."));
      return;
    }
    if (current?.status === status) {
      toast.success(`Deposit already ${status}`);
      return;
    }
    const { error } = await supabase.from("deposits").update({ status }).eq("id", id);
    if (error) {
      toast.error(getFriendlyErrorMessage(error, `Unable to ${status} deposit.`));
      return;
    }
    toast.success(`Deposit ${status}`);
    if (status === "approved") void sendDepositApprovedEmail({ data: { depositId: id } }).catch(() => {});
    if (status === "rejected") void sendDepositRejectedEmail({ data: { depositId: id } }).catch(() => {});
    void refresh();
  };
  const deleteDeposit = async (deposit: DepositRow) => {
    if (!window.confirm("Delete this deposit and its linked investment and referral records?")) return;
    const { error } = await (supabase as any).rpc("delete_deposit_with_related_data", { p_deposit_id: deposit.id });
    if (error) { toast.error(error.message || "Unable to delete deposit"); return; }
    toast.success("Deposit deleted");
    setSelectedDeposit(null);
    await refresh();
  };
  const finalizeWithdrawal = async (id: string, status: "approved" | "rejected", extra: { payout_mpesa_code?: string; admin_note?: string }) => {
    const patch: { status: string; payout_mpesa_code?: string | null; admin_note?: string | null } = { status };
    if (extra.payout_mpesa_code !== undefined) patch.payout_mpesa_code = extra.payout_mpesa_code || null;
    if (extra.admin_note !== undefined) patch.admin_note = extra.admin_note || null;
    const { error } = await supabase.from("withdrawals").update(patch).eq("id", id);
    if (error) { toast.error(error.message); return; }
    toast.success(status === "approved" ? "Payout finalized" : "Withdrawal rejected & refunded");
    if (status === "approved") void sendWithdrawalApprovedEmail({ data: { withdrawalId: id } }).catch(() => {});
    if (status === "rejected") void sendWithdrawalRejectedEmail({ data: { withdrawalId: id } }).catch(() => {});
    if (status === "approved") void sendWithdrawalPaidEmail({ data: { withdrawalId: id } }).catch(() => {});
    void refresh();
  };

  const updateReferral = async (id: string, status: "approved" | "rejected") => {
    const { data: row, error: fetchErr } = await supabase.from("referral_earnings").select("*").eq("id", id).maybeSingle();
    if (fetchErr || !row) { if (fetchErr) toast.error(fetchErr.message); else toast.error("Referral not found"); return; }
    if (row.status === status) { toast.success(`Referral already ${status}`); return; }

    if (status === 'approved') {
      const { error: e2 } = await supabase.from("referral_earnings").update({ status: 'approved' }).eq("id", id);
      if (e2) { toast.error(e2.message); return; }
      toast.success("Referral status updated");
      void refresh();
      return;
    }

    // rejected
    const { error } = await supabase.from("referral_earnings").update({ status }).eq("id", id);
    if (error) { toast.error(error.message); return; }
    toast.success(`Referral ${status}`);
    void refresh();
  };

  const markReferralPaid = async (id: string) => {
    const { data: row, error: fetchErr } = await supabase.from("referral_earnings").select("*").eq("id", id).maybeSingle();
    if (fetchErr || !row) { if (fetchErr) toast.error(fetchErr.message); else toast.error("Referral not found"); return; }
    const ref = row as ReferralRow;
    if (ref.status === 'paid') { toast.success('Referral already marked paid'); return; }

    const { error: e2 } = await supabase.from("referral_earnings").update({ status: 'paid' }).eq("id", id);
    if (e2) { toast.error(e2.message); return; }
    toast.success("Referral marked as paid");
    void refresh();
  };
  const unlinkReferredUser = async (userId: string) => {
    if (!window.confirm("Remove this user's referral link?")) return;
    const { error } = await supabase.from("profiles").update({ referred_by: null }).eq("id", userId);
    if (error) { toast.error(error.message); return; }
    toast.success("Referral link removed");
    void refresh();
  };
  const removeReferralAnalytics = async (referrerId: string | null) => {
    if (!referrerId || !window.confirm("Remove all users linked to this referral code?")) return;
    const { error } = await supabase.from("profiles").update({ referred_by: null }).eq("referred_by", referrerId);
    if (error) { toast.error(error.message); return; }
    toast.success("Referral links removed");
    void refresh();
  };

  const pendingDeposits = deposits.filter(d => d.status === "pending").length;
  const pendingWithdrawals = withdrawals.filter(w => w.status === "pending").length;
  const pendingInvestments = investments.filter(i => i.status === "pending").length;
  const referralAnalytics = useMemo(() => buildReferralAnalytics({
    referrals,
    profiles: profileList,
    investments,
    investmentPlans,
  }), [referrals, profileList, investments, investmentPlans]);
  const referredUsers = useMemo(() => profileList
    .filter((profile) => Boolean(profile.referred_by))
    .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime()), [profileList]);

  const depositsTotalPages = Math.max(1, Math.ceil(deposits.length / depositsRowsPerPage));
  const safeDepositsPage = Math.min(depositsPage, depositsTotalPages);
  const visibleDeposits = deposits.slice((safeDepositsPage - 1) * depositsRowsPerPage, safeDepositsPage * depositsRowsPerPage);
  const logTotalPages = Math.max(1, Math.ceil(actions.length / logRowsPerPage));
  const safeLogPage = Math.min(logPage, logTotalPages);
  const visibleActions = actions.slice((safeLogPage - 1) * logRowsPerPage, safeLogPage * logRowsPerPage);
  const emailLogsTotalPages = Math.max(1, Math.ceil(emailLogs.length / emailLogsRowsPerPage));
  const safeEmailLogsPage = Math.min(emailLogsPage, emailLogsTotalPages);
  const visibleEmailLogs = emailLogs.slice((safeEmailLogsPage - 1) * emailLogsRowsPerPage, safeEmailLogsPage * emailLogsRowsPerPage);
  const referralAnalyticsTotalPages = Math.max(1, Math.ceil(referralAnalytics.length / referralAnalyticsRowsPerPage));
  const safeReferralAnalyticsPage = Math.min(referralAnalyticsPage, referralAnalyticsTotalPages);
  const visibleReferralAnalytics = referralAnalytics.slice(
    (safeReferralAnalyticsPage - 1) * referralAnalyticsRowsPerPage,
    safeReferralAnalyticsPage * referralAnalyticsRowsPerPage,
  );

  useEffect(() => {
    setDepositsPage(1);
  }, [deposits.length]);

  useEffect(() => {
    if (depositsPage > depositsTotalPages) setDepositsPage(depositsTotalPages);
  }, [depositsPage, depositsTotalPages]);

  useEffect(() => {
    setLogPage(1);
  }, [actions.length]);

  useEffect(() => {
    if (logPage > logTotalPages) setLogPage(logTotalPages);
  }, [logPage, logTotalPages]);

  useEffect(() => {
    setEmailLogsPage(1);
  }, [emailLogsRowsPerPage]);

  useEffect(() => {
    if (emailLogsPage > emailLogsTotalPages) setEmailLogsPage(emailLogsTotalPages);
  }, [emailLogsPage, emailLogsTotalPages]);

  useEffect(() => {
    setReferralAnalyticsPage(1);
  }, [referralAnalyticsRowsPerPage]);

  useEffect(() => {
    if (referralAnalyticsPage > referralAnalyticsTotalPages) setReferralAnalyticsPage(referralAnalyticsTotalPages);
  }, [referralAnalyticsPage, referralAnalyticsTotalPages]);

  const formatMoney = (value: number | string | null | undefined) => Number(value ?? 0).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

  const matchesMoneyRange = useCallback((value?: string | null) => {
    if (!value) return true;
    if (moneyRange === "all") return true;

    const input = /^\d{4}-\d{2}-\d{2}$/.test(value) ? `${value}T00:00:00` : value;
    const date = new Date(input);
    if (Number.isNaN(date.getTime())) return true;

    const now = new Date();
    const start = new Date(now);
    const end = new Date(now);

    if (moneyRange === "today") {
      start.setHours(0, 0, 0, 0);
      end.setHours(23, 59, 59, 999);
    } else if (moneyRange === "week") {
      start.setDate(now.getDate() - 6);
      start.setHours(0, 0, 0, 0);
      end.setHours(23, 59, 59, 999);
    } else if (moneyRange === "month") {
      start.setDate(1);
      start.setHours(0, 0, 0, 0);
      end.setMonth(now.getMonth() + 1, 0);
      end.setHours(23, 59, 59, 999);
    } else if (moneyRange === "year") {
      start.setMonth(0, 1);
      start.setHours(0, 0, 0, 0);
      end.setMonth(11, 31);
      end.setHours(23, 59, 59, 999);
    } else if (moneyRange === "custom") {
      const from = customStart ? new Date(`${customStart}T00:00:00`) : null;
      const to = customEnd ? new Date(`${customEnd}T23:59:59`) : null;
      if (from && to) return date >= from && date <= to;
      if (from) return date >= from;
      if (to) return date <= to;
      return true;
    }

    return date >= start && date <= end;
  }, [moneyRange, customStart, customEnd]);

  const moneyData = useMemo(() => {
    const approvedDeposits = deposits.filter(d => d.status === "approved" && matchesMoneyRange(d.created_at));
    const pendingDeposits = deposits.filter(d => d.status === "pending" && matchesMoneyRange(d.created_at));
    const rejectedDeposits = deposits.filter(d => d.status === "rejected" && matchesMoneyRange(d.created_at));
    const paidWithdrawals = withdrawals.filter(w => (w.status === "approved" || w.status === "paid") && matchesMoneyRange(w.created_at));
    const approvedWithdrawals = withdrawals.filter(w => w.status === "approved" && matchesMoneyRange(w.created_at));
    const pendingWithdrawals = withdrawals.filter(w => w.status === "pending" && matchesMoneyRange(w.created_at));
    const investmentsInRange = investments.filter(i => matchesMoneyRange(i.created_at));
    const activeInvestments = investmentsInRange.filter(i => i.status === "active");
    const pendingInvestmentsInRange = investmentsInRange.filter(i => i.status === "pending");
    const completedInvestments = investmentsInRange.filter(i => i.status === "completed" || i.status === "matured");
    const reinvestments = investmentsInRange.filter(i => i.payment_source === "balance");
    const dailyRowsInRange = dailyEarnings.filter(row => matchesMoneyRange(row.earning_date));
    const paidDailyEarnings = dailyRowsInRange.filter(row => row.added_to_balance);
    const lockedDailyEarnings = dailyRowsInRange.filter(row => !row.added_to_balance);
    const paidReferral = referrals.filter(r => r.status === "paid" && matchesMoneyRange(r.created_at));
    const pendingReferral = referrals.filter(r => r.status === "pending" && matchesMoneyRange(r.created_at));
    const feePercent = Number(settings?.withdrawal_fee_percent ?? 0);
    const withdrawalNetAmount = (w: WithdrawalRow) => w.net_amount != null
      ? Number(w.net_amount)
      : Number(w.amount) - (w.fee_amount != null ? Number(w.fee_amount) : (Number(w.amount) * feePercent) / 100);
    const withdrawalCharges = paidWithdrawals.reduce((sum, w) => sum + (w.fee_amount != null ? Number(w.fee_amount) : (Number(w.amount) * feePercent) / 100), 0);

    const dailyTrend = dailyRowsInRange.reduce<Record<string, number>>((acc, row) => {
      const key = row.earning_date || "unknown";
      acc[key] = (acc[key] || 0) + Number(row.amount);
      return acc;
    }, {});
    const dailyTrendData = Object.entries(dailyTrend).sort(([a], [b]) => a.localeCompare(b)).slice(-8).map(([label, total]) => ({ label, total }));

    return {
      approvedDepositsTotal: approvedDeposits.reduce((sum, d) => sum + Number(d.amount), 0),
      pendingDepositsTotal: pendingDeposits.reduce((sum, d) => sum + Number(d.amount), 0),
      rejectedDepositsTotal: rejectedDeposits.reduce((sum, d) => sum + Number(d.amount), 0),
      paidWithdrawalsGrossTotal: paidWithdrawals.reduce((sum, w) => sum + Number(w.amount), 0),
      paidWithdrawalsNetTotal: paidWithdrawals.reduce((sum, w) => sum + withdrawalNetAmount(w), 0),
      approvedWithdrawalsTotal: approvedWithdrawals.reduce((sum, w) => sum + Number(w.amount), 0),
      pendingWithdrawalsTotal: pendingWithdrawals.reduce((sum, w) => sum + Number(w.amount), 0),
      totalInvested: investmentsInRange.reduce((sum, i) => sum + Number(i.plan_amount), 0),
      totalReinvested: reinvestments.reduce((sum, i) => sum + Number(i.plan_amount), 0),
      totalAvailableBalance: profileList.reduce((sum, p) => sum + Number(p.balance || 0), 0),
      totalLockedEarnings: lockedDailyEarnings.reduce((sum, row) => sum + Number(row.amount), 0),
      totalActiveMiningCapital: activeInvestments.reduce((sum, i) => sum + Number(i.plan_amount), 0),
      totalProjectedMiningPayouts: [...activeInvestments, ...pendingInvestmentsInRange].reduce((sum, i) => sum + Number(i.projected_payout || 0), 0),
      totalCompletedMiningPayouts: completedInvestments.reduce((sum, i) => sum + Number(i.projected_payout || 0), 0),
      totalUserProfit: investmentsInRange.reduce((sum, i) => sum + (Number(i.projected_payout || 0) - Number(i.plan_amount || 0)), 0),
      totalDailyEarningsPaid: paidDailyEarnings.reduce((sum, row) => sum + Number(row.amount), 0),
      totalReferralCommissionPaid: paidReferral.reduce((sum, r) => sum + Number(r.amount), 0),
      totalPendingReferralCommission: pendingReferral.reduce((sum, r) => sum + Number(r.amount), 0),
      totalWithdrawalCharges: withdrawalCharges,
      totalPlatformProfit: withdrawalCharges,
      totalActiveCyclesValue: activeInvestments.reduce((sum, i) => sum + Number(i.projected_payout || 0), 0),
      totalCompletedCyclesValue: completedInvestments.reduce((sum, i) => sum + Number(i.projected_payout || 0), 0),
      dailyTrendData,
      investmentVsReinvestment: [
        { label: "Investments", amount: investmentsInRange.reduce((sum, i) => sum + Number(i.plan_amount), 0) },
        { label: "Reinvestments", amount: reinvestments.reduce((sum, i) => sum + Number(i.plan_amount), 0) },
      ],
      cycleBreakdown: [
        { label: "Active", amount: activeInvestments.reduce((sum, i) => sum + Number(i.projected_payout || 0), 0) },
        { label: "Completed", amount: completedInvestments.reduce((sum, i) => sum + Number(i.projected_payout || 0), 0) },
      ],
      referralBreakdown: [
        { label: "Paid", amount: paidReferral.reduce((sum, r) => sum + Number(r.amount), 0) },
        { label: "Pending", amount: pendingReferral.reduce((sum, r) => sum + Number(r.amount), 0) },
      ],
    };
  }, [deposits, withdrawals, investments, profileList, dailyEarnings, referrals, matchesMoneyRange, settings]);

  const moneyCards = [
    { key: "totalDeposited", label: "Total Deposited", value: moneyData.approvedDepositsTotal, tone: "green", icon: ArrowDownToLine, helper: "Approved M-Pesa deposits only" },
    { key: "totalWithdrawnGross", label: "Total Withdrawn", value: moneyData.paidWithdrawalsGrossTotal, tone: "red", icon: ArrowUpFromLine, helper: "Approved or paid, before 5% transaction fee" },
    { key: "totalWithdrawnNet", label: "Total Withdrawn After Fee", value: moneyData.paidWithdrawalsNetTotal, tone: "green", icon: ArrowUpFromLine, helper: "Amount received after 5% transaction fee" },
    { key: "totalInvested", label: "Total Invested", value: moneyData.totalInvested, tone: "blue", icon: Coins, helper: "Investments started" },
    { key: "totalReinvested", label: "Total Reinvested", value: moneyData.totalReinvested, tone: "blue", icon: TrendingUp, helper: "From available balance" },
    { key: "totalAvailableBalance", label: "Total Available User Balance", value: moneyData.totalAvailableBalance, tone: "green", icon: Wallet, helper: "Current withdrawable balance" },
    { key: "totalLockedEarnings", label: "Total Locked Earnings", value: moneyData.totalLockedEarnings, tone: "gold", icon: Lock, helper: "Unlocked later by plan rules" },
    { key: "totalActiveMiningCapital", label: "Total Active Investment Capital", value: moneyData.totalActiveMiningCapital, tone: "blue", icon: BarChart3, helper: "Locked in active investments" },
    { key: "totalProjectedMiningPayouts", label: "Total Projected Investment Returns", value: moneyData.totalProjectedMiningPayouts, tone: "gold", icon: CircleDollarSign, helper: "Active and pending investments" },
    { key: "totalCompletedMiningPayouts", label: "Total Completed Investment Returns", value: moneyData.totalCompletedMiningPayouts, tone: "gold", icon: BadgeCheck, helper: "Completed investment returns" },
    { key: "totalUserProfit", label: "Total User Profit", value: moneyData.totalUserProfit, tone: "gold", icon: TrendingUp, helper: "Projected payout minus investment" },
    { key: "totalDailyEarningsPaid", label: "Total Daily Earnings Paid", value: moneyData.totalDailyEarningsPaid, tone: "green", icon: Coins, helper: "Added to user balances" },
    { key: "totalReferralCommissionPaid", label: "Total Referral Commission Paid", value: moneyData.totalReferralCommissionPaid, tone: "green", icon: Users, helper: "Paid referral rewards" },
    { key: "totalPendingReferralCommission", label: "Total Pending Referral Commission", value: moneyData.totalPendingReferralCommission, tone: "grey", icon: Clock3, helper: "Awaiting payout" },
    { key: "totalPendingWithdrawals", label: "Total Pending Withdrawals", value: moneyData.pendingWithdrawalsTotal, tone: "grey", icon: Clock3, helper: "Awaiting admin action" },
    { key: "totalApprovedWithdrawals", label: "Total Approved Withdrawals", value: moneyData.approvedWithdrawalsTotal, tone: "grey", icon: BadgeCheck, helper: "Approved but not paid" },
    { key: "totalWithdrawalCharges", label: "Total Withdrawal Charges", value: moneyData.totalWithdrawalCharges, tone: "red", icon: ArrowUpFromLine, helper: "Platform fee from withdrawals" },
    { key: "totalPendingDeposits", label: "Total Pending Deposits", value: moneyData.pendingDepositsTotal, tone: "grey", icon: Clock3, helper: "Waiting for approval" },
    { key: "totalApprovedDeposits", label: "Total Approved Deposits", value: moneyData.approvedDepositsTotal, tone: "green", icon: BadgeCheck, helper: "Approved and counted" },
    { key: "totalRejectedDeposits", label: "Total Rejected Deposits", value: moneyData.rejectedDepositsTotal, tone: "grey", icon: Clock3, helper: "Not counted as real money" },
    { key: "totalActiveCyclesValue", label: "Total Active Investments Value", value: moneyData.totalActiveCyclesValue, tone: "blue", icon: BarChart3, helper: "Projected value of active investments" },
    { key: "totalCompletedCyclesValue", label: "Total Completed Investments Value", value: moneyData.totalCompletedCyclesValue, tone: "blue", icon: BadgeCheck, helper: "Projected value of completed investments" },
    { key: "totalPlatformProfit", label: "Total Platform Profit", value: moneyData.totalPlatformProfit, tone: "red", icon: CircleDollarSign, helper: "Fee-based platform profit" },
  ];

  if (isAdmin === null) return <p className="text-muted-foreground">Loading…</p>;
  if (!isAdmin) return (
    <div className="rounded-2xl border border-border/60 bg-card p-8 text-center">
      <h1 className="text-xl font-bold">Admin access required</h1>
      <p className="mt-2 text-sm text-muted-foreground">Your account does not have admin privileges.</p>
    </div>
  );

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Admin panel</h1>
            <p className="mt-1 text-sm text-muted-foreground">Approve deposits and withdrawals, and monitor investments.</p>
      </div>

      <div className="flex flex-wrap gap-2 border-b border-border/60">
        <TabBtn active={tab === "deposits"} onClick={() => setTab("deposits")} label={`Deposits${pendingDeposits ? ` (${pendingDeposits})` : ""}`} />
        <TabBtn active={tab === "withdrawals"} onClick={() => setTab("withdrawals")} label={`Withdrawals${pendingWithdrawals ? ` (${pendingWithdrawals})` : ""}`} />
        <TabBtn active={tab === "investments"} onClick={() => setTab("investments")} label={`Investments${pendingInvestments ? ` (${pendingInvestments})` : ""}`} />
        <TabBtn active={tab === "users"} onClick={() => setTab("users")} label={`Users (${profileList.length})`} />
        <TabBtn active={tab === "plans"} onClick={() => setTab("plans")} label="Plans" />
        <TabBtn active={tab === "settings"} onClick={() => setTab("settings")} label="Settings" />
        <TabBtn active={tab === "referrals"} onClick={() => setTab("referrals")} label="Referrals" />
        <TabBtn active={tab === "earnings"} onClick={() => setTab("earnings")} label="Earnings" />
        <TabBtn active={tab === "money-flow"} onClick={() => setTab("money-flow")} label="Money Flow Analytics" />
        <TabBtn active={tab === "log"} onClick={() => setTab("log")} label="Activity log" />
      </div>

      {tab === "money-flow" && (
        <MoneyFlowAnalyticsTab
          range={moneyRange}
          setRange={setMoneyRange}
          customStart={customStart}
          setCustomStart={setCustomStart}
          customEnd={customEnd}
          setCustomEnd={setCustomEnd}
          cards={moneyCards}
          formatMoney={formatMoney}
          moneyData={moneyData}
        />
      )}

      {tab === "deposits" && (
        <div className="rounded-2xl border border-border/60">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-secondary/40 text-left text-xs uppercase tracking-wide text-muted-foreground">
                <tr><th className="px-4 py-3">Date</th><th className="px-4 py-3">User</th><th className="px-4 py-3">Amount</th><th className="px-4 py-3">M-Pesa code</th><th className="px-4 py-3">Status</th><th className="px-4 py-3 text-right">Actions</th></tr>
              </thead>
              <tbody>
                {visibleDeposits.map(d => {
                  const p = profiles[d.user_id];
                  return (
                    <tr key={d.id} className="border-t border-border/40">
                      <td className="px-4 py-3 text-muted-foreground">{new Date(d.created_at).toLocaleString()}</td>
                      <td className="px-4 py-3">{p?.full_name || "—"}<div className="text-xs text-muted-foreground">{p?.phone}</div></td>
                      <td className="px-4 py-3 font-medium">{fmt(d.amount)}</td>
                      <td className="px-4 py-3 font-mono">{d.mpesa_code}</td>
                      <td className="px-4 py-3"><Badge status={d.status} /></td>
                      <td className="px-4 py-3 text-right">
                        <div className="flex justify-end gap-1">
                          <button type="button" onClick={() => setSelectedDeposit(d)} className="inline-flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-xs font-semibold text-muted-foreground hover:bg-secondary hover:text-foreground"><Eye className="h-3.5 w-3.5" /> View</button>
                          <button type="button" onClick={() => void deleteDeposit(d)} className="inline-flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-xs font-semibold text-red-400 hover:bg-red-500/10"><Trash2 className="h-3.5 w-3.5" /> Delete</button>
                          {d.status === "pending" ? (
                            <div className="inline-flex gap-2">
                            <button onClick={() => updateDeposit(d.id, "approved")} className="rounded-md bg-emerald-500/15 px-3 py-1 text-xs font-semibold text-emerald-400 hover:bg-emerald-500/25">Approve</button>
                            <button onClick={() => updateDeposit(d.id, "rejected")} className="rounded-md bg-red-500/15 px-3 py-1 text-xs font-semibold text-red-400 hover:bg-red-500/25">Reject</button>
                            </div>
                          ) : null}
                        </div>
                      </td>
                    </tr>
                  );
                })}
                {deposits.length === 0 && <tr><td colSpan={6} className="px-4 py-8 text-center text-muted-foreground">No deposits yet.</td></tr>}
              </tbody>
            </table>
          </div>
          <TablePagination
            page={safeDepositsPage}
            totalPages={depositsTotalPages}
            rowsPerPage={depositsRowsPerPage}
            onPageChange={setDepositsPage}
            onRowsPerPageChange={setDepositsRowsPerPage}
            totalItems={deposits.length}
            startIndex={(safeDepositsPage - 1) * depositsRowsPerPage}
            endIndex={Math.min(safeDepositsPage * depositsRowsPerPage, deposits.length)}
          />
        </div>
      )}

      <Dialog open={Boolean(selectedDeposit)} onOpenChange={(open) => { if (!open) setSelectedDeposit(null); }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Deposit details</DialogTitle>
            <DialogDescription>Review the deposit record before taking action.</DialogDescription>
          </DialogHeader>
          {selectedDeposit && (
            <dl className="grid gap-3 rounded-xl border border-border/60 bg-secondary/20 p-4 text-sm sm:grid-cols-2">
              <div><dt className="text-xs text-muted-foreground">User</dt><dd className="mt-1 font-medium">{profiles[selectedDeposit.user_id]?.full_name || "—"}</dd></div>
              <div><dt className="text-xs text-muted-foreground">Phone</dt><dd className="mt-1">{profiles[selectedDeposit.user_id]?.phone || "—"}</dd></div>
              <div><dt className="text-xs text-muted-foreground">Amount</dt><dd className="mt-1 font-semibold">{fmt(selectedDeposit.amount)}</dd></div>
              <div><dt className="text-xs text-muted-foreground">M-Pesa code</dt><dd className="mt-1 font-mono text-xs">{selectedDeposit.mpesa_code}</dd></div>
              <div><dt className="text-xs text-muted-foreground">Status</dt><dd className="mt-1 capitalize">{selectedDeposit.status}</dd></div>
              <div><dt className="text-xs text-muted-foreground">Date</dt><dd className="mt-1">{new Date(selectedDeposit.created_at).toLocaleString()}</dd></div>
            </dl>
          )}
        </DialogContent>
      </Dialog>

      {tab === "investments" && (
        <InvestmentsTab investments={investments} profiles={profiles} plans={investmentPlans} onRefresh={refresh} />
      )}

      {tab === "withdrawals" && (
        <WithdrawalsTab withdrawals={withdrawals} profiles={profiles} settings={settings} onFinalize={finalizeWithdrawal} onRefresh={refresh} />
      )}

      {tab === "users" && <UsersTab users={profileList} roles={userRoles} onDone={refresh} />}

      {tab === "plans" && <PlansTab investments={investments} dailyEarnings={dailyEarnings} withdrawals={withdrawals} referrals={referrals} deposits={deposits} transactions={transactions} isSuperAdmin={isSuperAdmin} currentUserEmail={currentUserEmail} />}
      {tab === "settings" && <SettingsTab />}

      {tab === "settings" && (
        <div className="rounded-2xl border border-border/60 bg-card p-5">
          <h3 className="text-lg font-bold">Email notification history</h3>
          <div className="mt-4 overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-secondary/40 text-left text-xs uppercase tracking-wide text-muted-foreground">
                <tr><th className="px-3 py-2">When</th><th className="px-3 py-2">User</th><th className="px-3 py-2">Subject</th><th className="px-3 py-2">Status</th><th className="px-3 py-2">Event</th></tr>
              </thead>
              <tbody>
                {visibleEmailLogs.map(entry => (
                  <tr key={entry.id} className="border-t border-border/40">
                    <td className="px-3 py-2 text-muted-foreground">{new Date(entry.sent_at || entry.created_at).toLocaleString()}</td>
                    <td className="px-3 py-2">{profiles[entry.user_id]?.full_name || entry.user_id?.slice(0, 8) || "—"}</td>
                    <td className="px-3 py-2">{entry.subject}</td>
                    <td className="px-3 py-2"><span className={`rounded-full px-2 py-0.5 text-xs font-semibold ${entry.status === "sent" ? "bg-emerald-500/15 text-emerald-400" : "bg-red-500/15 text-red-400"}`}>{entry.status}</span></td>
                    <td className="px-3 py-2 text-xs text-muted-foreground">{entry.meta?.event || "—"}</td>
                  </tr>
                ))}
                {emailLogs.length === 0 && <tr><td colSpan={5} className="px-3 py-8 text-center text-muted-foreground">No email activity yet.</td></tr>}
              </tbody>
            </table>
          </div>
          <TablePagination
            page={safeEmailLogsPage}
            totalPages={emailLogsTotalPages}
            rowsPerPage={emailLogsRowsPerPage}
            onPageChange={setEmailLogsPage}
            onRowsPerPageChange={setEmailLogsRowsPerPage}
            totalItems={emailLogs.length}
            startIndex={(safeEmailLogsPage - 1) * emailLogsRowsPerPage}
            endIndex={Math.min(safeEmailLogsPage * emailLogsRowsPerPage, emailLogs.length)}
          />
        </div>
      )}

      {tab === "referrals" && (
        <div className="space-y-6">
          <div className="rounded-2xl border border-border/60 bg-card p-5">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <h3 className="text-lg font-bold">People who joined by referral</h3>
                <p className="mt-1 text-sm text-muted-foreground">Every account linked to a referral code or link, including users who have not deposited yet.</p>
              </div>
              <span className="rounded-full bg-primary/10 px-3 py-1 text-sm font-semibold text-primary">{referredUsers.length} joined</span>
            </div>
            <div className="mt-4 overflow-x-auto rounded-2xl border border-border/60">
              <table className="w-full text-sm">
                <thead className="bg-secondary/40 text-left text-xs uppercase tracking-wide text-muted-foreground">
                  <tr>
                    <th className="px-4 py-3">Joined user</th>
                    <th className="px-4 py-3">Phone</th>
                    <th className="px-4 py-3">Referred by</th>
                    <th className="px-4 py-3">Referrer phone</th>
                    <th className="px-4 py-3">Referral code</th>
                    <th className="px-4 py-3">Joined</th>
                    <th className="px-4 py-3 text-right">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {referredUsers.map((joinedUser) => {
                    const referrer = joinedUser.referred_by ? profiles[joinedUser.referred_by] : undefined;
                    return (
                      <tr key={joinedUser.id} className="border-t border-border/40">
                        <td className="px-4 py-3">
                          <div className="font-medium">{joinedUser.full_name || "Unnamed user"}</div>
                          <div className="text-xs text-muted-foreground">{joinedUser.id.slice(0, 8)}</div>
                        </td>
                        <td className="px-4 py-3">{joinedUser.phone || "—"}</td>
                        <td className="px-4 py-3">
                          <div className="font-medium">{referrer?.full_name || "Unknown referrer"}</div>
                          <div className="text-xs text-muted-foreground">{joinedUser.referred_by?.slice(0, 8) || "—"}</div>
                        </td>
                        <td className="px-4 py-3">{referrer?.phone || "—"}</td>
                        <td className="px-4 py-3 font-mono text-xs">{referrer?.referral_code || "—"}</td>
                        <td className="whitespace-nowrap px-4 py-3 text-muted-foreground">{new Date(joinedUser.created_at).toLocaleDateString()}</td>
                        <td className="px-4 py-3">
                          <div className="flex justify-end gap-1">
                            <button type="button" onClick={() => window.alert(`User: ${joinedUser.full_name || "Unnamed user"}\nPhone: ${joinedUser.phone || "—"}\nReferral code: ${referrer?.referral_code || "—"}`)} className="inline-flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-xs font-semibold text-muted-foreground hover:bg-secondary hover:text-foreground"><Eye className="h-3.5 w-3.5" /> View</button>
                            <button type="button" onClick={() => void unlinkReferredUser(joinedUser.id)} className="inline-flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-xs font-semibold text-red-400 hover:bg-red-500/10"><Trash2 className="h-3.5 w-3.5" /> Delete</button>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                  {referredUsers.length === 0 && <tr><td colSpan={7} className="px-4 py-8 text-center text-muted-foreground">No users have joined through a referral yet.</td></tr>}
                </tbody>
              </table>
            </div>
          </div>
          <div className="rounded-2xl border border-border/60 bg-card p-5">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <h3 className="text-lg font-bold">Referral link analytics</h3>
                <p className="mt-1 text-sm text-muted-foreground">See how many users joined through each referral code, which plans they chose, and the total invested amount.</p>
              </div>
            </div>
            <div className="mt-4 overflow-x-auto rounded-2xl border border-border/60">
              <table className="w-full text-sm">
                <thead className="bg-secondary/40 text-left text-xs uppercase tracking-wide text-muted-foreground">
                  <tr>
                    <th className="px-4 py-3">Referrer</th>
                    <th className="px-4 py-3">Referral code</th>
                    <th className="px-4 py-3">Joined users</th>
                    <th className="px-4 py-3">Plans</th>
                    <th className="px-4 py-3">Total invested</th>
                    <th className="px-4 py-3 text-right">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {referralAnalytics.length === 0 && <tr><td colSpan={6} className="px-4 py-8 text-center text-muted-foreground">No referral activity yet.</td></tr>}
                  {visibleReferralAnalytics.map((row) => (
                    <tr key={row.referrerId ?? row.referralCode ?? "unknown"} className="border-t border-border/40">
                      <td className="px-4 py-3">
                        <div className="font-medium">{row.referrerName || "Unknown"}</div>
                        <div className="text-xs text-muted-foreground">{row.referrerId?.slice(0, 8) || "—"}</div>
                      </td>
                      <td className="px-4 py-3 font-mono text-xs">{row.referralCode || "—"}</td>
                      <td className="px-4 py-3 font-semibold">{row.joinedUsers}</td>
                      <td className="px-4 py-3">
                        {row.planNames.length > 0 ? <div className="flex flex-wrap gap-1">{row.planNames.map((plan) => <span key={plan} className="rounded-full bg-primary/10 px-2 py-0.5 text-xs text-primary">{plan}</span>)}</div> : <span className="text-muted-foreground">No investments yet</span>}
                      </td>
                      <td className="px-4 py-3 font-semibold text-emerald-400">{fmt(row.totalInvestedAmount)}</td>
                      <td className="px-4 py-3">
                        <div className="flex justify-end gap-1">
                          <button type="button" onClick={() => window.alert(`Referrer: ${row.referrerName || "Unknown"}\nReferral code: ${row.referralCode || "—"}\nJoined users: ${row.joinedUsers}\nTotal invested: ${fmt(row.totalInvestedAmount)}`)} className="inline-flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-xs font-semibold text-muted-foreground hover:bg-secondary hover:text-foreground"><Eye className="h-3.5 w-3.5" /> View</button>
                          <button type="button" onClick={() => void removeReferralAnalytics(row.referrerId)} disabled={!row.referrerId} className="inline-flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-xs font-semibold text-red-400 hover:bg-red-500/10 disabled:opacity-50"><Trash2 className="h-3.5 w-3.5" /> Delete</button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <TablePagination
              page={safeReferralAnalyticsPage}
              totalPages={referralAnalyticsTotalPages}
              rowsPerPage={referralAnalyticsRowsPerPage}
              onPageChange={setReferralAnalyticsPage}
              onRowsPerPageChange={setReferralAnalyticsRowsPerPage}
              totalItems={referralAnalytics.length}
              startIndex={(safeReferralAnalyticsPage - 1) * referralAnalyticsRowsPerPage}
              endIndex={Math.min(safeReferralAnalyticsPage * referralAnalyticsRowsPerPage, referralAnalytics.length)}
            />
          </div>
          <ReferralsTab referrals={referrals} profiles={profiles} deposits={deposits} onApprove={updateReferral} onReject={updateReferral} onMarkPaid={markReferralPaid} onRefresh={refresh} />
        </div>
      )}

      {tab === "earnings" && (
        <div className="space-y-4">
          <AdminEarningsTab earnings={dailyEarnings} profiles={profiles} investments={investments} onRefresh={refresh} />
        </div>
      )}

      {tab === "log" && (
        <div className="rounded-2xl border border-border/60">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-secondary/40 text-left text-xs uppercase tracking-wide text-muted-foreground">
                <tr><th className="px-4 py-3">Date</th><th className="px-4 py-3">Action</th><th className="px-4 py-3">Target user</th><th className="px-4 py-3">Amount</th><th className="px-4 py-3">Note</th></tr>
              </thead>
              <tbody>
                {visibleActions.map(a => (
                  <tr key={a.id} className="border-t border-border/40">
                    <td className="px-4 py-3 text-muted-foreground">{new Date(a.created_at).toLocaleString()}</td>
                    <td className="px-4 py-3 font-semibold">{a.action}</td>
                    <td className="px-4 py-3">{profiles[a.target_user_id]?.full_name || a.target_user_id.slice(0, 8)}</td>
                    <td className="px-4 py-3 font-medium">{a.amount != null ? fmt(a.amount) : "—"}</td>
                    <td className="px-4 py-3 text-muted-foreground">{a.note || "—"}</td>
                  </tr>
                ))}
                {actions.length === 0 && <tr><td colSpan={5} className="px-4 py-8 text-center text-muted-foreground">No admin actions yet.</td></tr>}
              </tbody>
            </table>
          </div>
          <TablePagination
            page={safeLogPage}
            totalPages={logTotalPages}
            rowsPerPage={logRowsPerPage}
            onPageChange={setLogPage}
            onRowsPerPageChange={setLogRowsPerPage}
            totalItems={actions.length}
            startIndex={(safeLogPage - 1) * logRowsPerPage}
            endIndex={Math.min(safeLogPage * logRowsPerPage, actions.length)}
          />
        </div>
      )}
    </div>
  );
}

function UsersTab({ users, roles, onDone }: { users: ProfileLite[]; roles: Record<string, string[]>; onDone: () => void }) {
  const [q, setQ] = useState("");
  const [selected, setSelected] = useState<ProfileLite | null>(null);
  const [page, setPage] = useState(1);
  const [rowsPerPage, setRowsPerPage] = useState(10);
  const [amount, setAmount] = useState("");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [grantPlans, setGrantPlans] = useState<PlanOption[]>([]);
  const [grantPlanId, setGrantPlanId] = useState("");
  const [statusFilter, setStatusFilter] = useState<"all" | "active" | "archived">("all");
  const [mode, setMode] = useState<"create" | "edit">("create");
  const [userDialogOpen, setUserDialogOpen] = useState(false);
  const [form, setForm] = useState({
    full_name: "",
    phone: "",
    balance: "",
    referral_code: "",
    email: "",
    password: "",
    role: "user",
    deleted: false,
  });

  const resetForm = () => {
    setForm({ full_name: "", phone: "", balance: "", referral_code: "", email: "", password: "", role: "user", deleted: false });
    setMode("create");
    setSelected(null);
    setUserDialogOpen(false);
  };

  useEffect(() => {
    void supabase.from("investment_plans")
      .select("id,name,slug,duration_days,roi_percent,min_amount,max_amount,unlock_day,amount_presets")
      .eq("is_active", true)
      .order("sort_order")
      .order("min_amount")
      .then(({ data }) => {
        if (data) {
          const plans = data as PlanOption[];
          setGrantPlans(plans);
          if (!grantPlanId && plans[0]) setGrantPlanId(plans[0].id);
        }
      });
  }, []);

  useEffect(() => {
    if (!selected) {
      if (mode === "edit") setForm({ ...form, role: form.role });
      return;
    }
    setMode("edit");
    setForm({
      full_name: selected.full_name || "",
      phone: selected.phone || "",
      balance: String(selected.balance ?? 0),
      referral_code: selected.referral_code || "",
      email: "",
      password: "",
      role: roles[selected.id]?.includes("admin") ? "admin" : "user",
      deleted: Boolean(selected.deleted_at),
    });
  }, [selected, roles]);

  const filtered = users.filter(u => {
    const s = q.toLowerCase();
    const matchesQuery = !s || u.full_name?.toLowerCase().includes(s) || u.phone?.toLowerCase().includes(s) || u.id.includes(s) || (u.referral_code || "").toLowerCase().includes(s);
    const matchesStatus = statusFilter === "all" || (statusFilter === "active" ? !u.deleted_at : Boolean(u.deleted_at));
    return matchesQuery && matchesStatus;
  });
  const totalPages = Math.max(1, Math.ceil(filtered.length / rowsPerPage));
  const safePage = Math.min(page, totalPages);
  const visibleUsers = filtered.slice((safePage - 1) * rowsPerPage, safePage * rowsPerPage);

  useEffect(() => {
    setPage(1);
  }, [q, statusFilter]);

  useEffect(() => {
    if (page > totalPages) setPage(totalPages);
  }, [page, totalPages]);

  const selectedGrantPlan = grantPlans.find(p => p.id === grantPlanId) ?? grantPlans[0] ?? null;

  const saveUser = async (e?: React.FormEvent) => {
    e?.preventDefault();
    if (mode === "create") {
      if (!form.email.trim() || !form.password.trim()) return toast.error("Email and password are required for a new user");
      setBusy(true);
      const { data: authData, error: signUpError } = await supabase.auth.signUp({
        email: form.email.trim(),
        password: form.password,
        options: {
          emailRedirectTo: getSiteUrl() || undefined,
          data: {
            full_name: form.full_name.trim(),
            phone: form.phone.trim(),
            referral_code: form.referral_code.trim().toUpperCase() || undefined,
          },
        },
      });
      setBusy(false);
      if (signUpError) return toast.error(signUpError.message);
      const userId = authData?.user?.id;
      if (userId) {
        const rolesToInsert = [{ user_id: userId, role: "user" }, ...(form.role === "admin" ? [{ user_id: userId, role: "admin" }] : [])];
        const { error: roleError } = await supabase.from("user_roles").upsert(rolesToInsert, { onConflict: "user_id,role" });
        if (roleError) toast.error(roleError.message);
      }
      toast.success("User created. They will need to confirm their email before logging in.");
      resetForm();
      onDone();
      return;
    }

    if (!selected) return;
    setBusy(true);
    const payload: Record<string, unknown> = {
      full_name: form.full_name.trim() || null,
      phone: form.phone.trim() || null,
      balance: Number(form.balance) || 0,
      referral_code: form.referral_code.trim().toUpperCase() || null,
      deleted_at: form.deleted ? new Date().toISOString() : null,
    };
    const { error } = await supabase.from("profiles").update(payload).eq("id", selected.id);
    setBusy(false);
    if (error) return toast.error(error.message);

    const roleRows = [{ user_id: selected.id, role: "user" }, ...(form.role === "admin" ? [{ user_id: selected.id, role: "admin" }] : [])];
    const { error: roleError } = await supabase.from("user_roles").delete().eq("user_id", selected.id).in("role", ["user", "admin"]);
    if (!roleError) {
      const { error: insertRoleError } = await supabase.from("user_roles").insert(roleRows);
      if (insertRoleError) return toast.error(insertRoleError.message);
    } else {
      return toast.error(roleError.message);
    }

    toast.success(form.deleted ? "User archived" : "User updated");
    resetForm();
    onDone();
  };

  const setUserAccountStatus = async (status: "active" | "suspended") => {
    if (!selected) return;
    setBusy(true);
    const { error } = await supabase.rpc("admin_set_user_status", { _target: selected.id, _status: status, _note: note || undefined });
    setBusy(false);
    if (error) return toast.error(error.message);
    setSelected(current => current ? { ...current, status } : current);
    toast.success(status === "active" ? "Account activated" : "Account suspended");
    void sendAccountStatusEmail({ data: { userId: selected.id, status, note: note || undefined } }).catch(() => {});
    setNote("");
    onDone();
  };

  const deleteUser = async () => {
    if (!selected) return;
    setBusy(true);
    const { error } = await supabase.rpc("admin_soft_delete_user", { _target: selected.id, _note: note || undefined });
    setBusy(false);
    if (error) return toast.error(error.message);
    setSelected(current => current ? { ...current, deleted_at: new Date().toISOString(), status: "suspended" } : current);
    toast.success("User archived");
    void sendAccountStatusEmail({ data: { userId: selected.id, status: "suspended", note: note || "Your account was archived by an administrator." } }).catch(() => {});
    setNote("");
    resetForm();
    onDone();
  };

  const restoreUser = async () => {
    if (!selected) return;
    setBusy(true);
    const { error } = await supabase.rpc("admin_restore_user", { _target: selected.id, _note: note || undefined });
    setBusy(false);
    if (error) return toast.error(error.message);
    setSelected(current => current ? { ...current, deleted_at: null, status: "active" } : current);
    toast.success("User restored");
    void sendAccountStatusEmail({ data: { userId: selected.id, status: "active", note: note || "Your account has been restored by an administrator." } }).catch(() => {});
    setNote("");
    resetForm();
    onDone();
  };

  const hardDeleteUser = async () => {
    if (!selected) return;
    const confirmed = window.confirm(`Delete ${selected.full_name || "this user"} from the app records?`);
    if (!confirmed) return;
    setBusy(true);
    const [{ error: roleError }, { error: profileError }] = await Promise.all([
      supabase.from("user_roles").delete().eq("user_id", selected.id),
      supabase.from("profiles").delete().eq("id", selected.id),
    ]);
    setBusy(false);
    if (roleError) return toast.error(roleError.message);
    if (profileError) return toast.error(profileError.message);
    toast.success("User removed from application records");
    resetForm();
    onDone();
  };

  const doAction = async (kind: "credit" | "debit" | "grant") => {
    if (!selected) return;
    const n = Number(amount);
    if (!n || n <= 0) return toast.error("Enter a valid amount");
    setBusy(true);
    let error: { message: string } | null = null;
    if (kind === "grant") {
      const r = await supabase.rpc("admin_grant_plan", {
        _target: selected.id,
        _amount: n,
        _note: note || undefined,
        _plan_id: grantPlanId || null,
      });
      error = r.error;
    } else {
      const delta = kind === "credit" ? n : -n;
      const r = await supabase.rpc("admin_adjust_balance", { _target: selected.id, _delta: delta, _note: note || undefined });
      error = r.error;
    }
    setBusy(false);
    if (error) return toast.error(error.message);
    toast.success(kind === "grant" ? "Mining plan granted" : kind === "credit" ? "Balance credited" : "Balance debited");
    setAmount(""); setNote("");
    onDone();
  };

  return (
    <div className="grid gap-6 xl:grid-cols-[1.1fr,420px]">
      <div className="rounded-2xl border border-border/60">
        <div className="border-b border-border/60 p-3">
          <div className="flex flex-wrap items-center gap-2">
            <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search by name, phone, referral code, or id…" className="flex-1 rounded-md border border-border bg-background px-3 py-2 text-sm focus:border-primary focus:outline-none" />
            <div className="flex items-center gap-1 rounded-md border border-border bg-background p-1">
              {(["all", "active", "archived"] as const).map(option => (
                <button key={option} type="button" onClick={() => setStatusFilter(option)} className={`rounded px-2.5 py-1 text-xs font-semibold capitalize ${statusFilter === option ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground"}`}>
                  {option}
                </button>
              ))}
            </div>
            <button type="button" onClick={() => { resetForm(); setMode("create"); setUserDialogOpen(true); }} className="rounded-md bg-primary/15 px-3 py-2 text-sm font-semibold text-primary hover:bg-primary/25">+ Add user</button>
          </div>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-secondary/40 text-left text-xs uppercase tracking-wide text-muted-foreground">
              <tr><th className="px-4 py-3">Joined</th><th className="px-4 py-3">Name</th><th className="px-4 py-3">Phone</th><th className="px-4 py-3">Status</th><th className="px-4 py-3">Role</th><th className="px-4 py-3">Balance</th><th className="px-4 py-3 text-right">Action</th></tr>
            </thead>
            <tbody>
              {visibleUsers.map(u => {
                const roleList = roles[u.id] || [];
                const state = u.deleted_at ? "archived" : (u.status === "suspended" ? "suspended" : "active");
                const statusClasses = state === "active" ? "bg-emerald-500/15 text-emerald-400" : state === "suspended" ? "bg-amber-500/15 text-amber-400" : "bg-slate-500/15 text-slate-400";
                return (
                  <tr key={u.id} className={`border-t border-border/40 ${selected?.id === u.id ? "bg-primary/5" : ""}`}>
                    <td className="px-4 py-3 text-muted-foreground">{new Date(u.created_at).toLocaleDateString()}</td>
                    <td className="px-4 py-3">
                      <div className="font-medium">{u.full_name || "—"}</div>
                      {u.deleted_at && <div className="text-[11px] uppercase tracking-wide text-amber-500">Archived</div>}
                    </td>
                    <td className="px-4 py-3 font-mono text-xs">{u.phone || "—"}</td>
                    <td className="px-4 py-3"><span className={`rounded-full px-2 py-0.5 text-[11px] font-semibold uppercase tracking-wide ${statusClasses}`}>{state}</span></td>
                    <td className="px-4 py-3 text-xs uppercase tracking-wide text-muted-foreground">{roleList.includes("admin") ? "Admin" : "User"}</td>
                    <td className="px-4 py-3 font-semibold">{fmt(u.balance)}</td>
                    <td className="px-4 py-3 text-right">
                      <div className="flex justify-end gap-2">
                        <button type="button" onClick={() => { setSelected(u); setUserDialogOpen(true); }} className="rounded-md bg-primary/15 px-3 py-1 text-xs font-semibold text-primary hover:bg-primary/25">Edit</button>
                        {!u.deleted_at ? (
                          <button type="button" onClick={() => { setSelected(u); setMode("edit"); setForm((prev) => ({ ...prev, deleted: true })); setUserDialogOpen(true); }} className="rounded-md bg-amber-500/15 px-3 py-1 text-xs font-semibold text-amber-500 hover:bg-amber-500/25">Archive</button>
                        ) : (
                          <button type="button" onClick={() => { setSelected(u); setMode("edit"); setForm((prev) => ({ ...prev, deleted: false })); setUserDialogOpen(true); }} className="rounded-md bg-emerald-500/15 px-3 py-1 text-xs font-semibold text-emerald-500 hover:bg-emerald-500/25">Restore</button>
                        )}
                      </div>
                    </td>
                  </tr>
                );
              })}
              {filtered.length === 0 && <tr><td colSpan={7} className="px-4 py-8 text-center text-muted-foreground">No users found.</td></tr>}
            </tbody>
          </table>
        </div>
        <TablePagination
          page={safePage}
          totalPages={totalPages}
          rowsPerPage={rowsPerPage}
          onPageChange={setPage}
          onRowsPerPageChange={setRowsPerPage}
          totalItems={filtered.length}
          startIndex={(safePage - 1) * rowsPerPage}
          endIndex={Math.min(safePage * rowsPerPage, filtered.length)}
        />
      </div>

      <Dialog open={userDialogOpen} onOpenChange={(open) => { if (!open && !busy) resetForm(); }}>
        <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle>{mode === "create" ? "Add new user" : "Manage user"}</DialogTitle>
            <DialogDescription>{mode === "create" ? "Create an account and assign its initial access level." : "Update account details, status, balance, or mining access."}</DialogDescription>
          </DialogHeader>

        <form onSubmit={saveUser} className="space-y-4 text-sm">
          <div className="grid gap-3 sm:grid-cols-2">
          <label className="block">
            <span className="text-sm font-medium">Full name</span>
            <input autoFocus value={form.full_name} onChange={(e) => setForm({ ...form, full_name: e.target.value })} className="mt-1 block w-full rounded-md border border-border bg-background px-3 py-2 text-sm focus:border-primary focus:outline-none" placeholder="Full name" />
          </label>
          <label className="block">
            <span className="text-sm font-medium">Phone</span>
            <input value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} className="mt-1 block w-full rounded-md border border-border bg-background px-3 py-2 text-sm focus:border-primary focus:outline-none" placeholder="Phone number" />
          </label>
          <label className="block">
            <span className="text-sm font-medium">Referral code</span>
            <input value={form.referral_code} onChange={(e) => setForm({ ...form, referral_code: e.target.value.toUpperCase() })} className="mt-1 block w-full rounded-md border border-border bg-background px-3 py-2 text-sm focus:border-primary focus:outline-none" placeholder="ABCD1234" />
          </label>
          <label className="block">
            <span className="text-sm font-medium">Balance (USD)</span>
            <input type="number" min="0" value={form.balance} onChange={(e) => setForm({ ...form, balance: e.target.value })} className="mt-1 block w-full rounded-md border border-border bg-background px-3 py-2 text-sm focus:border-primary focus:outline-none" />
          </label>
          <label className="block">
            <span className="text-sm font-medium">Role</span>
            <select value={form.role} onChange={(e) => setForm({ ...form, role: e.target.value })} className="mt-1 block w-full rounded-md border border-border bg-background px-3 py-2 text-sm focus:border-primary focus:outline-none">
              <option value="user">User</option>
              <option value="admin">Admin</option>
            </select>
          </label>
          </div>
          {mode === "create" ? (
            <>
              <label className="block">
                <span className="text-sm font-medium">Email</span>
                <input type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} className="mt-1 block w-full rounded-md border border-border bg-background px-3 py-2 text-sm focus:border-primary focus:outline-none" required />
              </label>
              <label className="block">
                <span className="text-sm font-medium">Password</span>
                <input type="password" value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} className="mt-1 block w-full rounded-md border border-border bg-background px-3 py-2 text-sm focus:border-primary focus:outline-none" required />
              </label>
            </>
          ) : (
            <label className="flex items-center gap-2 rounded-md border border-border bg-background/70 px-3 py-2 text-sm">
              <input type="checkbox" checked={form.deleted} onChange={(e) => setForm({ ...form, deleted: e.target.checked })} />
              <span>Archive this user</span>
            </label>
          )}

          {mode === "edit" && <div className="rounded-md border border-border/60 bg-secondary/40 p-4">
            <div className="font-semibold">Quick actions</div>
            <div className="mt-3 grid gap-2">
              <div className="flex flex-wrap gap-2">
                <button type="button" disabled={busy || !selected} onClick={() => setUserAccountStatus("active")} className="rounded-md bg-emerald-500/15 px-3 py-2 text-sm font-semibold text-emerald-400 hover:bg-emerald-500/25 disabled:opacity-60">Activate</button>
                <button type="button" disabled={busy || !selected} onClick={() => setUserAccountStatus("suspended")} className="rounded-md bg-amber-500/15 px-3 py-2 text-sm font-semibold text-amber-400 hover:bg-amber-500/25 disabled:opacity-60">Suspend</button>
              </div>
              <label className="block">
                <span className="text-sm font-medium">Amount (USD)</span>
                <input type="number" min="1" value={amount} onChange={(e) => setAmount(e.target.value)} className="mt-1 block w-full rounded-md border border-border bg-background px-3 py-2 text-sm focus:border-primary focus:outline-none" />
              </label>
              <label className="block">
                <span className="text-sm font-medium">Mining plan</span>
                <select value={grantPlanId} onChange={(e) => setGrantPlanId(e.target.value)} className="mt-1 block w-full rounded-md border border-border bg-background px-3 py-2 text-sm focus:border-primary focus:outline-none">
                  {grantPlans.map(plan => (
                    <option key={plan.id} value={plan.id}>{plan.name} · {plan.duration_days}d · {plan.roi_percent}%</option>
                  ))}
                </select>
              </label>
              <label className="block">
                <span className="text-sm font-medium">Note (optional)</span>
                <input value={note} onChange={(e) => setNote(e.target.value)} className="mt-1 block w-full rounded-md border border-border bg-background px-3 py-2 text-sm focus:border-primary focus:outline-none" />
              </label>
              <div className="grid grid-cols-2 gap-2">
                <button type="button" disabled={busy || !selected} onClick={() => doAction("credit")} className="rounded-md bg-emerald-500/15 px-3 py-2 text-sm font-semibold text-emerald-400 hover:bg-emerald-500/25 disabled:opacity-60">+ Credit</button>
                <button type="button" disabled={busy || !selected} onClick={() => doAction("debit")} className="rounded-md bg-red-500/15 px-3 py-2 text-sm font-semibold text-red-400 hover:bg-red-500/25 disabled:opacity-60">− Debit</button>
              </div>
              <button type="button" disabled={busy || !selected} onClick={() => doAction("grant")} className="w-full rounded-md bg-[image:var(--gradient-gold)] px-3 py-2 text-sm font-semibold text-primary-foreground shadow-[var(--shadow-gold)] disabled:opacity-60">
                {selectedGrantPlan ? `Grant ${selectedGrantPlan.name}` : "Grant mining plan"}
              </button>
            </div>
          </div>}

          <div className="flex flex-wrap justify-end gap-2 pt-2">
            <button type="button" onClick={resetForm} className="rounded-md border border-border px-4 py-2 text-sm font-semibold text-muted-foreground hover:text-foreground">Cancel</button>
            <button type="submit" disabled={busy} className="rounded-md bg-primary px-5 py-2 text-sm font-semibold text-primary-foreground disabled:opacity-60">
              {busy ? "Saving..." : mode === "create" ? "Create user" : "Save changes"}
            </button>
            {mode === "edit" && selected && (
              <>
                {!selected.deleted_at ? (
                  <button type="button" disabled={busy} onClick={deleteUser} className="rounded-md bg-amber-500/15 px-3 py-2 text-sm font-semibold text-amber-500 hover:bg-amber-500/25 disabled:opacity-60">Archive</button>
                ) : (
                  <button type="button" disabled={busy} onClick={restoreUser} className="rounded-md bg-emerald-500/15 px-3 py-2 text-sm font-semibold text-emerald-500 hover:bg-emerald-500/25 disabled:opacity-60">Restore</button>
                )}
                <button type="button" disabled={busy} onClick={hardDeleteUser} className="rounded-md bg-red-500/15 px-3 py-2 text-sm font-semibold text-red-400 hover:bg-red-500/25 disabled:opacity-60">Delete</button>
              </>
            )}
          </div>
        </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function TablePagination({ page, totalPages, rowsPerPage, onPageChange, onRowsPerPageChange, totalItems, startIndex, endIndex }: { page: number; totalPages: number; rowsPerPage: number; onPageChange: (page: number) => void; onRowsPerPageChange: (rowsPerPage: number) => void; totalItems: number; startIndex: number; endIndex: number; }) {
  const firstVisiblePage = Math.min(Math.max(page - 1, 1), Math.max(totalPages - 2, 1));
  const pageNumbers = Array.from({ length: Math.min(3, totalPages) }, (_, index) => firstVisiblePage + index);
  return (
    <div className="flex flex-col gap-3 border-t border-border/60 bg-background/50 px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
      <div className="text-sm text-muted-foreground">
        {totalItems === 0 ? "No results" : `Showing ${startIndex + 1}-${endIndex} of ${totalItems}`}
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <label className="flex items-center gap-2 text-sm text-muted-foreground">
          <span>Rows</span>
          <select value={rowsPerPage} onChange={(e) => onRowsPerPageChange(Number(e.target.value))} className="rounded-md border border-border bg-background px-2 py-1 text-sm focus:border-primary focus:outline-none">
            <option value={10}>10</option>
            <option value={25}>25</option>
            <option value={50}>50</option>
          </select>
        </label>
        <div className="flex items-center gap-1">
          <button disabled={page <= 1} onClick={() => onPageChange(Math.max(1, page - 1))} className="rounded-md border border-border bg-background px-3 py-1.5 text-sm text-muted-foreground disabled:cursor-not-allowed disabled:opacity-50 hover:text-foreground">Prev</button>
          {pageNumbers.map(number => (
            <button key={number} onClick={() => onPageChange(number)} className={`min-w-9 rounded-md border px-2.5 py-1.5 text-sm ${page === number ? "border-primary bg-primary text-primary-foreground" : "border-border bg-background text-muted-foreground hover:text-foreground"}`}>
              {number}
            </button>
          ))}
          <button disabled={page >= totalPages} onClick={() => onPageChange(Math.min(totalPages, page + 1))} className="rounded-md border border-border bg-background px-3 py-1.5 text-sm text-muted-foreground disabled:cursor-not-allowed disabled:opacity-50 hover:text-foreground">Next</button>
        </div>
      </div>
    </div>
  );
}

function TabBtn({ active, onClick, label }: { active: boolean; onClick: () => void; label: string }) {
  return (
    <button onClick={onClick} className={`-mb-px border-b-2 px-4 py-2 text-sm font-semibold transition-colors ${active ? "border-primary text-primary" : "border-transparent text-muted-foreground hover:text-foreground"}`}>{label}</button>
  );
}

type WithdrawalStatus = "pending" | "approved" | "rejected" | "all";
type InvestmentStatus = "active" | "paused" | "completed" | "all";
type PaymentSource = "all" | "mpesa" | "balance";

function InvestmentsTab({ investments, profiles, plans, onRefresh }: {
  investments: InvestmentRow[];
  profiles: Record<string, ProfileLite>;
  plans: Record<string, string>;
  onRefresh: () => Promise<void>;
}) {
  const [status, setStatus] = useState<InvestmentStatus>("all");
  const [source, setSource] = useState<PaymentSource>("all");
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const [rowsPerPage, setRowsPerPage] = useState(10);
  const [selectedInvestment, setSelectedInvestment] = useState<InvestmentRow | null>(null);
  const query = search.trim().toLowerCase();
  const filtered = investments.filter(inv => {
    if (status !== "all" && inv.status !== status) return false;
    if (source !== "all" && inv.payment_source !== source) return false;
    if (!query) return true;
    const profile = profiles[inv.user_id];
    return [profile?.full_name, String(inv.plan_amount), plans[inv.plan_id ?? ""] || "", String(inv.duration_days), String(inv.projected_payout), inv.payment_source]
      .some(value => value?.toLowerCase().includes(query));
  });
  const total = filtered.reduce((sum, inv) => sum + Number(inv.plan_amount), 0);
  const totalPages = Math.max(1, Math.ceil(filtered.length / rowsPerPage));
  const safePage = Math.min(page, totalPages);
  const visibleInvestments = filtered.slice((safePage - 1) * rowsPerPage, safePage * rowsPerPage);

  useEffect(() => {
    setPage(1);
  }, [status, source, search]);

  useEffect(() => {
    if (page > totalPages) setPage(totalPages);
  }, [page, totalPages]);

  const deleteInvestment = async (investment: InvestmentRow) => {
    if (!window.confirm("Delete this investment and its related earnings?")) return;
    const { error } = await (supabase as any).rpc("delete_investment_with_related_data", { p_investment_id: investment.id });
    if (error) { toast.error(error.message || "Unable to delete investment"); return; }
    toast.success("Investment deleted");
    setSelectedInvestment(null);
    await onRefresh();
  };

  const setInvestmentStatus = async (investment: InvestmentRow) => {
    const nextStatus = investment.status === "active" ? "paused" : "active";
    const action = nextStatus === "paused" ? "stop" : "resume";
    if (!window.confirm(`${action === "stop" ? "Stop" : "Resume"} this investment?`)) return;
    const { error } = await (supabase as any).rpc("set_investment_status", { p_investment_id: investment.id, p_status: nextStatus });
    if (error) { toast.error(error.message || `Unable to ${action} investment`); return; }
    toast.success(`Investment ${nextStatus === "paused" ? "stopped" : "resumed"}`);
    await onRefresh();
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
        <div className="flex flex-wrap gap-2">
          {(["all", "active", "paused", "completed"] as InvestmentStatus[]).map(s => (
            <button key={s} onClick={() => setStatus(s)}
              className={`rounded-full px-3 py-1 text-xs font-semibold capitalize transition-colors ${status === s ? "bg-primary text-primary-foreground" : "bg-secondary/50 text-muted-foreground hover:text-foreground"}`}>
              {s} <span className="opacity-70">({investments.filter(i => s === "all" ? true : i.status === s).length})</span>
            </button>
          ))}
        </div>
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
          <div className="flex flex-wrap gap-2">
            {(["all", "mpesa", "balance"] as PaymentSource[]).map(src => (
              <button key={src} onClick={() => setSource(src)}
                className={`rounded-full px-3 py-1 text-xs font-semibold capitalize transition-colors ${source === src ? "bg-primary text-primary-foreground" : "bg-secondary/50 text-muted-foreground hover:text-foreground"}`}>
                {src === "all" ? "All sources" : src === "mpesa" ? "M-Pesa" : "Account Balance"}
              </button>
            ))}
          </div>
          <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search user, plan, amount, status" className="rounded-md border border-border bg-background px-3 py-2 text-sm focus:border-primary focus:outline-none" />
        </div>
      </div>
      <div className="text-xs text-muted-foreground">Total shown: <span className="font-semibold text-foreground">{fmt(total)}</span></div>
      <div className="overflow-x-auto rounded-2xl border border-border/60">
        <table className="w-full text-sm">
          <thead className="bg-secondary/40 text-left text-xs uppercase tracking-wide text-muted-foreground">
            <tr>
              <th className="px-4 py-3">Date</th>
              <th className="px-4 py-3">User</th>
              <th className="px-4 py-3">Amount</th>
              <th className="px-4 py-3">Plan</th>
              <th className="px-4 py-3">Duration</th>
              <th className="px-4 py-3">Projected payout</th>
              <th className="px-4 py-3">Source</th>
              <th className="px-4 py-3">Status</th>
              <th className="px-4 py-3">Progress</th>
              <th className="px-4 py-3 text-right">Actions</th>
            </tr>
          </thead>
          <tbody>
            {visibleInvestments.map(inv => {
              const p = profiles[inv.user_id];
              const elapsed = Math.max(0, Date.now() - new Date(inv.created_at).getTime());
              const progress = inv.status === "completed" ? 100 : Math.min(100, Math.round((elapsed / (Math.max(1, inv.duration_days) * 86400000)) * 100));
              return (
                <tr key={inv.id} className="border-t border-border/40 transition-colors hover:bg-secondary/20">
                  <td className="px-4 py-3 text-muted-foreground">{new Date(inv.created_at).toLocaleString()}</td>
                  <td className="px-4 py-3">{p?.full_name || "—"}<div className="text-xs text-muted-foreground">{p?.phone}</div></td>
                  <td className="px-4 py-3 font-medium">{fmt(inv.plan_amount)}</td>
                  <td className="px-4 py-3">{plans[inv.plan_id ?? ""] || "—"}</td>
                  <td className="px-4 py-3">{inv.duration_days} days</td>
                  <td className="px-4 py-3 font-medium">{fmt(inv.projected_payout ?? 0)}</td>
                  <td className="px-4 py-3 capitalize">{inv.payment_source === "balance" ? "Account Balance" : "M-Pesa"}</td>
                  <td className="px-4 py-3"><Badge status={inv.status} /></td>
                  <td className="min-w-36 px-4 py-3">
                    <div className="flex items-center gap-2"><div className="h-1.5 flex-1 overflow-hidden rounded-full bg-secondary"><div className="h-full rounded-full bg-primary" style={{ width: `${progress}%` }} /></div><span className="text-xs text-muted-foreground">{progress}%</span></div>
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex justify-end gap-1">
                      <button type="button" onClick={() => setSelectedInvestment(inv)} className="inline-flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-xs font-semibold text-muted-foreground hover:bg-secondary hover:text-foreground"><Eye className="h-3.5 w-3.5" /> View</button>
                      {(inv.status === "active" || inv.status === "paused") && <button type="button" onClick={() => void setInvestmentStatus(inv)} className={`inline-flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-xs font-semibold ${inv.status === "active" ? "text-amber-400 hover:bg-amber-500/10" : "text-emerald-400 hover:bg-emerald-500/10"}`}>
                        {inv.status === "active" ? <Lock className="h-3.5 w-3.5" /> : <Play className="h-3.5 w-3.5" />} {inv.status === "active" ? "Stop" : "Resume"}
                      </button>}
                      <button type="button" onClick={() => void deleteInvestment(inv)} className="inline-flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-xs font-semibold text-red-400 hover:bg-red-500/10"><Trash2 className="h-3.5 w-3.5" /> Delete</button>
                    </div>
                  </td>
                </tr>
              );
            })}
            {filtered.length === 0 && <tr><td colSpan={10} className="px-4 py-8 text-center text-muted-foreground">No investments found.</td></tr>}
          </tbody>
        </table>
      </div>
      <TablePagination
        page={safePage}
        totalPages={totalPages}
        rowsPerPage={rowsPerPage}
        onPageChange={setPage}
        onRowsPerPageChange={setRowsPerPage}
        totalItems={filtered.length}
        startIndex={(safePage - 1) * rowsPerPage}
        endIndex={Math.min(safePage * rowsPerPage, filtered.length)}
      />
      <Dialog open={Boolean(selectedInvestment)} onOpenChange={(open) => { if (!open) setSelectedInvestment(null); }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Investment details</DialogTitle>
            <DialogDescription>Review the investment and its current progress.</DialogDescription>
          </DialogHeader>
          {selectedInvestment && (
            <dl className="grid gap-3 rounded-xl border border-border/60 bg-secondary/20 p-4 text-sm sm:grid-cols-2">
              <div><dt className="text-xs text-muted-foreground">User</dt><dd className="mt-1 font-medium">{profiles[selectedInvestment.user_id]?.full_name || "—"}</dd></div>
              <div><dt className="text-xs text-muted-foreground">Phone</dt><dd className="mt-1">{profiles[selectedInvestment.user_id]?.phone || "—"}</dd></div>
              <div><dt className="text-xs text-muted-foreground">Investment</dt><dd className="mt-1 font-semibold">{fmt(selectedInvestment.plan_amount)}</dd></div>
              <div><dt className="text-xs text-muted-foreground">Projected payout</dt><dd className="mt-1 font-semibold">{fmt(selectedInvestment.projected_payout ?? 0)}</dd></div>
              <div><dt className="text-xs text-muted-foreground">Plan</dt><dd className="mt-1">{plans[selectedInvestment.plan_id ?? ""] || "—"}</dd></div>
              <div><dt className="text-xs text-muted-foreground">Status</dt><dd className="mt-1 capitalize">{selectedInvestment.status}</dd></div>
              <div><dt className="text-xs text-muted-foreground">Started</dt><dd className="mt-1">{new Date(selectedInvestment.created_at).toLocaleString()}</dd></div>
              <div><dt className="text-xs text-muted-foreground">Duration</dt><dd className="mt-1">{selectedInvestment.duration_days} days</dd></div>
            </dl>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}

function WithdrawalsTab({ withdrawals, profiles, settings, onFinalize, onRefresh }: { withdrawals: WithdrawalRow[]; profiles: Record<string, ProfileLite>; settings: AppSettingsRow | null; onFinalize: (id: string, status: "approved" | "rejected", extra: { payout_mpesa_code?: string; admin_note?: string }) => Promise<void>; onRefresh: () => Promise<void>; }) {
  const [filter, setFilter] = useState<WithdrawalStatus>("pending");
  const [search, setSearch] = useState("");
  const [selected, setSelected] = useState<WithdrawalRow | null>(null);
  const [page, setPage] = useState(1);
  const [rowsPerPage, setRowsPerPage] = useState(10);
  const [payCode, setPayCode] = useState("");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);

  const counts = {
    pending: withdrawals.filter(w => w.status === "pending").length,
    approved: withdrawals.filter(w => w.status === "approved").length,
    rejected: withdrawals.filter(w => w.status === "rejected").length,
    all: withdrawals.length,
  };
  const weekday = nairobiWeekday();
  const isSunday = weekday === 7;
  const query = search.trim().toLowerCase();
  const filtered = withdrawals.filter(w => {
    if (filter !== "all" && w.status !== filter) return false;
    if (!query) return true;
    const user = profiles[w.user_id];
    const created = new Date(w.created_at).toLocaleString();
    return [user?.full_name, user?.phone, String(w.amount), created, w.status]
      .some(value => value?.toLowerCase().includes(query));
  });

  const openFor = (w: WithdrawalRow) => {
    setSelected(w);
    setPayCode(w.payout_mpesa_code || "");
    setNote(w.admin_note || "");
  };

  const markPaid = async () => {
    if (!selected) return;
    if (!payCode.trim()) { toast.error("Enter the M-Pesa transaction code"); return; }
    setBusy(true);
    await onFinalize(selected.id, "approved", { payout_mpesa_code: payCode.trim(), admin_note: note.trim() });
    setBusy(false);
    setSelected(null); setPayCode(""); setNote("");
  };
  const reject = async () => {
    if (!selected) return;
    setBusy(true);
    await onFinalize(selected.id, "rejected", { admin_note: note.trim() });
    setBusy(false);
    setSelected(null); setPayCode(""); setNote("");
  };

  const deleteWithdrawal = async (withdrawal: WithdrawalRow) => {
    if (!window.confirm("Delete this withdrawal record?")) return;
    const { error } = await (supabase as any).rpc("delete_withdrawal_record", { p_withdrawal_id: withdrawal.id });
    if (error) { toast.error(error.message || "Unable to delete withdrawal"); return; }
    toast.success("Withdrawal deleted");
    if (selected?.id === withdrawal.id) setSelected(null);
    await onRefresh();
  };

  const total = filtered.reduce((s, w) => s + Number(w.amount), 0);
  const totalPages = Math.max(1, Math.ceil(filtered.length / rowsPerPage));
  const safePage = Math.min(page, totalPages);
  const visibleWithdrawals = filtered.slice((safePage - 1) * rowsPerPage, safePage * rowsPerPage);
  const selectedRequestedAmount = Number(selected?.amount || 0);
  const selectedFeeEnabled = settings?.withdrawal_fee_enabled !== false;
  const selectedFeePercent = selectedFeeEnabled ? Number(settings?.withdrawal_fee_percent ?? 20) : 0;
  const selectedFee = Number(((selectedRequestedAmount * selectedFeePercent) / 100).toFixed(2));
  const selectedNetAmount = Number((selectedRequestedAmount - selectedFee).toFixed(2));

  useEffect(() => {
    setPage(1);
  }, [filter, query]);

  useEffect(() => {
    if (page > totalPages) setPage(totalPages);
  }, [page, totalPages]);

  return (
    <div>
      <div className="space-y-4">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
          <div className="flex flex-wrap gap-2">
            {(["pending", "approved", "rejected", "all"] as WithdrawalStatus[]).map(s => (
              <button key={s} onClick={() => setFilter(s)}
                className={`rounded-full px-3 py-1 text-xs font-semibold capitalize transition-colors ${filter === s ? "bg-primary text-primary-foreground" : "bg-secondary/50 text-muted-foreground hover:text-foreground"}`}>
                {s} <span className="opacity-70">({counts[s]})</span>
              </button>
            ))}
          </div>
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
            <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search name, phone, amount, date, status" className="rounded-md border border-border bg-background px-3 py-2 text-sm focus:border-primary focus:outline-none" />
            {isSunday && (
              <span className="rounded-full border border-yellow-500/40 bg-yellow-500/10 px-3 py-1 text-xs font-semibold text-yellow-700">User withdrawals are closed today.</span>
            )}
          </div>
        </div>
        <div className="text-xs text-muted-foreground">Total shown: <span className="font-semibold text-foreground">{fmt(total)}</span></div>

        <div className="overflow-x-auto rounded-2xl border border-border/60">
          <table className="w-full text-sm">
            <thead className="bg-secondary/40 text-left text-xs uppercase tracking-wide text-muted-foreground">
              <tr>
                <th className="px-4 py-3">Requested</th>
                <th className="px-4 py-3">User</th>
                <th className="px-4 py-3">Amount</th>
                <th className="px-4 py-3">Send to</th>
                <th className="px-4 py-3">Status</th>
                <th className="px-4 py-3">Payout code</th>
                <th className="px-4 py-3 text-right">Action</th>
              </tr>
            </thead>
            <tbody>
              {visibleWithdrawals.map(w => {
                const p = profiles[w.user_id];
                return (
                  <tr key={w.id} className={`border-t border-border/40 ${selected?.id === w.id ? "bg-primary/5" : ""}`}>
                    <td className="px-4 py-3 text-muted-foreground whitespace-nowrap">{new Date(w.created_at).toLocaleString()}</td>
                    <td className="px-4 py-3">
                      <div className="font-medium">{p?.full_name?.trim() || "Unnamed user"}</div>
                      <div className="text-xs text-muted-foreground">{p?.phone || w.user_id}</div>
                      <div className="text-xs text-muted-foreground">Bal: {fmt(p?.balance ?? 0)}</div>
                    </td>
                    <td className="px-4 py-3 font-medium">
                      {fmt(w.amount)}
                      {typeof settings?.withdrawal_fee_percent !== 'undefined' && (
                        (() => {
                          const feeEnabled = settings?.withdrawal_fee_enabled !== false;
                          const feePct = feeEnabled ? Number(settings?.withdrawal_fee_percent ?? 20) : 0;
                          const requestedAmount = Number(w.amount);
                          const fee = Number(((requestedAmount * feePct) / 100).toFixed(2));
                          const netAmount = Number((requestedAmount - fee).toFixed(2));
                          return (
                            <div className="mt-1 text-xs text-muted-foreground">
                              Requested: {fmt(requestedAmount)} ({fmtKes(requestedAmount * USD_TO_KES_RATE)})
                              <br />
                              Charge: {fmt(fee)} ({fmtKes(fee * USD_TO_KES_RATE)}) · Net: {fmt(netAmount)} ({fmtKes(netAmount * USD_TO_KES_RATE)}) ({feePct}% fee)
                            </div>
                          );
                        })()
                      )}
                    </td>
                    <td className="px-4 py-3 font-mono text-xs">{w.mpesa_phone}</td>
                    <td className="px-4 py-3"><Badge status={w.status} />{w.processed_at && <div className="mt-1 text-[10px] text-muted-foreground">{new Date(w.processed_at).toLocaleString()}</div>}</td>
                    <td className="px-4 py-3 font-mono text-xs">{w.payout_mpesa_code || <span className="text-muted-foreground">—</span>}</td>
                    <td className="px-4 py-3 text-right">
                      <div className="flex justify-end gap-1">
                        {w.status === "pending" ? (
                          <button onClick={() => openFor(w)} className="rounded-md bg-primary/15 px-3 py-1 text-xs font-semibold text-primary hover:bg-primary/25">Process</button>
                        ) : (
                          <button onClick={() => openFor(w)} className="rounded-md px-2.5 py-1.5 text-xs font-semibold text-muted-foreground hover:bg-secondary hover:text-foreground">View</button>
                        )}
                        <button type="button" onClick={() => void deleteWithdrawal(w)} className="inline-flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-xs font-semibold text-red-400 hover:bg-red-500/10"><Trash2 className="h-3.5 w-3.5" /> Delete</button>
                      </div>
                    </td>
                  </tr>
                );
              })}
              {filtered.length === 0 && <tr><td colSpan={7} className="px-4 py-8 text-center text-muted-foreground">No withdrawals in this view.</td></tr>}
            </tbody>
          </table>
        </div>
        <TablePagination
          page={safePage}
          totalPages={totalPages}
          rowsPerPage={rowsPerPage}
          onPageChange={setPage}
          onRowsPerPageChange={setRowsPerPage}
          totalItems={filtered.length}
          startIndex={(safePage - 1) * rowsPerPage}
          endIndex={Math.min(safePage * rowsPerPage, filtered.length)}
        />
      </div>

      <Dialog open={Boolean(selected)} onOpenChange={(open) => { if (!open) setSelected(null); }}>
        <DialogContent className="max-h-[90vh] overflow-y-auto">
          {selected && (
            <>
              <DialogHeader>
                <DialogTitle>Finalize payout</DialogTitle>
                <DialogDescription>Review the withdrawal and enter the M-Pesa payment reference.</DialogDescription>
              </DialogHeader>
              <div className="space-y-4">
            <div className="rounded-md bg-secondary/40 p-3 text-sm space-y-1">
              <div className="flex justify-between"><span className="text-muted-foreground">User</span><span className="font-semibold">{profiles[selected.user_id]?.full_name || "—"}</span></div>
              <div className="flex justify-between"><span className="text-muted-foreground">Send to</span><span className="font-mono">{selected.mpesa_phone}</span></div>
              <div className="flex justify-between gap-4"><span className="text-muted-foreground">Requested</span><span className="text-right font-semibold text-primary">{fmt(selectedRequestedAmount)} ({fmtKes(selectedRequestedAmount * USD_TO_KES_RATE)})</span></div>
              <div className="flex justify-between gap-4"><span className="text-muted-foreground">Charge ({selectedFeePercent}%)</span><span className="text-right">{fmt(selectedFee)} ({fmtKes(selectedFee * USD_TO_KES_RATE)})</span></div>
              <div className="flex justify-between gap-4"><span className="text-muted-foreground">Net payout</span><span className="text-right font-semibold text-emerald-400">{fmt(selectedNetAmount)} ({fmtKes(selectedNetAmount * USD_TO_KES_RATE)})</span></div>
              <div className="flex justify-between"><span className="text-muted-foreground">Status</span><Badge status={selected.status} /></div>
            </div>

            <label className="block">
              <span className="text-sm font-medium">M-Pesa transaction code</span>
              <input value={payCode} onChange={(e) => setPayCode(e.target.value.toUpperCase())} placeholder="e.g. SFE7X8K2LM" disabled={selected.status !== "pending"}
                className="mt-1 block w-full rounded-md border border-border bg-background px-3 py-2 text-sm font-mono uppercase focus:border-primary focus:outline-none disabled:opacity-60" />
            </label>
            <label className="block">
              <span className="text-sm font-medium">Admin note (optional)</span>
              <textarea value={note} onChange={(e) => setNote(e.target.value)} rows={2} disabled={selected.status !== "pending"}
                className="mt-1 block w-full rounded-md border border-border bg-background px-3 py-2 text-sm focus:border-primary focus:outline-none disabled:opacity-60" />
            </label>

            {selected.status === "pending" ? (
              <div className="space-y-2">
                <button disabled={busy} onClick={markPaid} className="w-full rounded-md bg-emerald-500/20 px-3 py-2 text-sm font-semibold text-emerald-400 hover:bg-emerald-500/30 disabled:opacity-60">
                  Mark paid & finalize
                </button>
                <button disabled={busy} onClick={reject} className="w-full rounded-md bg-red-500/15 px-3 py-2 text-sm font-semibold text-red-400 hover:bg-red-500/25 disabled:opacity-60">
                  Reject & refund balance
                </button>
              </div>
            ) : (
              <div className="rounded-md border border-border/60 p-3 text-xs text-muted-foreground">
                {selected.status === "approved" ? "This payout has been finalized." : "This withdrawal was rejected and the balance was refunded."}
                {selected.processed_at && <div className="mt-1">Processed: {new Date(selected.processed_at).toLocaleString()}</div>}
              </div>
            )}
              </div>
            </>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}

function ReferralsTab({ referrals, profiles, deposits, onApprove, onReject, onMarkPaid, onRefresh }: { referrals: ReferralRow[]; profiles: Record<string, ProfileLite>; deposits: DepositRow[]; onApprove: (id: string, status: "approved" | "rejected") => Promise<void>; onReject: (id: string, status: "approved" | "rejected") => Promise<void>; onMarkPaid: (id: string) => Promise<void>; onRefresh: () => Promise<void>; }) {
  const [q, setQ] = useState("");
  const [page, setPage] = useState(1);
  const [rowsPerPage, setRowsPerPage] = useState(10);
  const filtered = referrals.filter(r => {
    const s = q.toLowerCase();
    const refName = profiles[r.referrer_id]?.full_name ?? r.referrer_id.slice(0,8);
    const referredName = profiles[r.referred_id]?.full_name ?? r.referred_id.slice(0,8);
    const dep = deposits.find(d => d.id === r.deposit_id);
    return !s || refName.toLowerCase().includes(s) || referredName.toLowerCase().includes(s) || String(r.amount).includes(s) || r.status.toLowerCase().includes(s) || (dep && String(dep.amount).includes(s));
  });
  const totalPages = Math.max(1, Math.ceil(filtered.length / rowsPerPage));
  const safePage = Math.min(page, totalPages);
  const visibleReferrals = filtered.slice((safePage - 1) * rowsPerPage, safePage * rowsPerPage);

  return (
    <div>
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-lg font-bold">Referral rewards</h3>
        <input value={q} onChange={e => setQ(e.target.value)} placeholder="Search referrer, referred, amount, status…" className="w-64 rounded-md border border-border bg-background px-3 py-2 text-sm" />
      </div>
      <div className="overflow-x-auto rounded-2xl border border-border/60">
        <table className="w-full text-sm">
          <thead className="bg-secondary/40 text-left text-xs uppercase tracking-wide text-muted-foreground">
            <tr>
              <th className="px-4 py-3">Date</th>
              <th className="px-4 py-3">Referrer</th>
              <th className="px-4 py-3">Referred</th>
              <th className="px-4 py-3">Deposit</th>
              <th className="px-4 py-3">Commission</th>
              <th className="px-4 py-3">Status</th>
              <th className="px-4 py-3 text-right">Action</th>
            </tr>
          </thead>
          <tbody>
            {visibleReferrals.map(r => {
              const ref = profiles[r.referrer_id];
              const referred = profiles[r.referred_id];
              const dep = deposits.find(d => d.id === r.deposit_id);
              return (
                <tr key={r.id} className="border-t border-border/40">
                  <td className="px-4 py-3 text-muted-foreground">{new Date(r.created_at).toLocaleString()}</td>
                  <td className="px-4 py-3">{ref?.full_name || r.referrer_id.slice(0,8)}<div className="text-xs text-muted-foreground">{ref?.phone}</div></td>
                  <td className="px-4 py-3">{referred?.full_name || r.referred_id.slice(0,8)}<div className="text-xs text-muted-foreground">{referred?.phone}</div></td>
                  <td className="px-4 py-3">{dep ? fmt(dep.amount) : r.deposit_id}</td>
                  <td className="px-4 py-3 font-medium">{fmt(r.amount)}</td>
                  <td className="px-4 py-3"><span className={`inline-flex rounded-full px-2 py-0.5 text-xs font-medium ${r.status === 'approved' ? 'bg-emerald-500/15 text-emerald-400' : r.status === 'paid' ? 'bg-primary/15 text-primary' : r.status === 'rejected' ? 'bg-red-500/15 text-red-400' : 'bg-yellow-500/15 text-yellow-400'}`}>{r.status}</span></td>
                  <td className="px-4 py-3 text-right">
                    <div className="flex justify-end gap-1">
                      <button type="button" onClick={() => window.alert(`Referrer: ${ref?.full_name || "—"}\nReferred: ${referred?.full_name || "—"}\nDeposit: ${dep ? fmt(dep.amount) : r.deposit_id}\nCommission: ${fmt(r.amount)}\nStatus: ${r.status}`)} className="inline-flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-xs font-semibold text-muted-foreground hover:bg-secondary hover:text-foreground"><Eye className="h-3.5 w-3.5" /> View</button>
                      <button type="button" onClick={async () => { if (!window.confirm("Delete this referral reward?")) return; const { error } = await (supabase as any).rpc("delete_referral_reward", { p_referral_id: r.id }); if (error) toast.error(error.message); else { toast.success("Referral reward deleted"); await onRefresh(); } }} className="inline-flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-xs font-semibold text-red-400 hover:bg-red-500/10"><Trash2 className="h-3.5 w-3.5" /> Delete</button>
                      {r.status === 'pending' && (
                        <div className="inline-flex gap-2">
                        <button onClick={() => onApprove(r.id, 'approved')} className="rounded-md bg-emerald-500/15 px-3 py-1 text-xs font-semibold text-emerald-400 hover:bg-emerald-500/25">Approve</button>
                        <button onClick={() => onReject(r.id, 'rejected')} className="rounded-md bg-red-500/15 px-3 py-1 text-xs font-semibold text-red-400 hover:bg-red-500/25">Reject</button>
                        </div>
                      )}
                    {r.status === 'approved' && (
                      <button onClick={() => onMarkPaid(r.id)} className="rounded-md bg-[image:var(--gradient-gold)] px-3 py-1 text-xs font-semibold text-primary-foreground shadow-[var(--shadow-gold)]">Mark paid</button>
                    )}
                    </div>
                  </td>
                </tr>
              );
            })}
            {filtered.length === 0 && <tr><td colSpan={7} className="px-4 py-8 text-center text-muted-foreground">No referral rewards yet.</td></tr>}
          </tbody>
        </table>
      </div>
      <TablePagination
        page={safePage}
        totalPages={totalPages}
        rowsPerPage={rowsPerPage}
        onPageChange={setPage}
        onRowsPerPageChange={setRowsPerPage}
        totalItems={filtered.length}
        startIndex={(safePage - 1) * rowsPerPage}
        endIndex={Math.min(safePage * rowsPerPage, filtered.length)}
      />
    </div>
  );
}

function AdminEarningsTab({ earnings, profiles, investments, onRefresh }: { earnings: DailyEarningAdminRow[]; profiles: Record<string, ProfileLite>; investments: InvestmentRow[]; onRefresh: () => Promise<void> }) {
  const [q, setQ] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [planFilter, setPlanFilter] = useState("all");
  const [selectedDate, setSelectedDate] = useState("");
  const [page, setPage] = useState(1);
  const [rowsPerPage, setRowsPerPage] = useState(10);
  const [selectedEarning, setSelectedEarning] = useState<DailyEarningAdminRow | null>(null);
  const [deletingEarningId, setDeletingEarningId] = useState<string | null>(null);

  const filtered = earnings.filter(row => {
    const profile = profiles[row.user_id];
    const investment = investments.find(inv => inv.id === row.investment_id);
    const planName = investment?.plan_id ? "plan" : "";
    const haystack = [profile?.full_name, row.earning_date, planName, row.status, String(row.amount)].join(" ").toLowerCase();
    const matchesSearch = !q || haystack.includes(q.toLowerCase());
    const matchesStatus = statusFilter === "all" || row.status === statusFilter;
    const matchesDate = !selectedDate || row.earning_date === selectedDate;
    const matchesPlan = planFilter === "all" || (investment?.plan_id ? planFilter === investment.plan_id : false);
    return matchesSearch && matchesStatus && matchesDate && matchesPlan;
  });
  const totalPages = Math.max(1, Math.ceil(filtered.length / rowsPerPage));
  const safePage = Math.min(page, totalPages);
  const visibleEarnings = filtered.slice((safePage - 1) * rowsPerPage, safePage * rowsPerPage);

  useEffect(() => {
    setPage(1);
  }, [q, statusFilter, planFilter, selectedDate]);

  useEffect(() => {
    if (page > totalPages) setPage(totalPages);
  }, [page, totalPages]);

  const deleteEarning = async (earning: DailyEarningAdminRow) => {
    if (!window.confirm("Delete this daily earning? Released earnings will be reversed from the balance.")) return;
    setDeletingEarningId(earning.id);
    const { error } = await (supabase as any).rpc("delete_daily_earning", { p_earning_id: earning.id });
    if (error) {
      toast.error(error.message || "Unable to delete this daily earning.");
    } else {
      toast.success("Daily earning deleted.");
      setSelectedEarning(null);
      void onRefresh();
    }
    setDeletingEarningId(null);
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
        <div className="flex flex-wrap gap-2">
          {(["all", "pending", "released"].map(s => (
            <button key={s} onClick={() => setStatusFilter(s)} className={`rounded-full px-3 py-1 text-xs font-semibold capitalize ${statusFilter === s ? "bg-primary text-primary-foreground" : "bg-secondary/50 text-muted-foreground hover:text-foreground"}`}>{s}</button>
          )))}
        </div>
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
          <input value={q} onChange={e => setQ(e.target.value)} placeholder="Search user, date, plan, status" className="rounded-md border border-border bg-background px-3 py-2 text-sm focus:border-primary focus:outline-none" />
          <input type="date" value={selectedDate} onChange={e => setSelectedDate(e.target.value)} className="rounded-md border border-border bg-background px-3 py-2 text-sm focus:border-primary focus:outline-none" />
        </div>
      </div>
      <div className="overflow-x-auto rounded-2xl border border-border/60">
        <table className="w-full text-sm">
          <thead className="bg-secondary/40 text-left text-xs uppercase tracking-wide text-muted-foreground">
            <tr>
              <th className="px-4 py-3">User</th>
              <th className="px-4 py-3">Mining plan</th>
              <th className="px-4 py-3">Investment</th>
              <th className="px-4 py-3">Daily earning</th>
              <th className="px-4 py-3">Earned so far</th>
              <th className="px-4 py-3">Remaining</th>
              <th className="px-4 py-3">Status</th>
              <th className="px-4 py-3 text-right">Actions</th>
            </tr>
          </thead>
          <tbody>
            {visibleEarnings.map(row => {
              const profile = profiles[row.user_id];
              const investment = investments.find(inv => inv.id === row.investment_id);
              const planLabel = investment ? `${investment.duration_days} Days Plan` : "Investment";
              const totalForCycle = earnings.filter(e => e.investment_id === row.investment_id).reduce((sum, e) => sum + Number(e.amount), 0);
              const remainingForCycle = Math.max(0, (investment?.projected_payout ?? 0) - Number(investment?.plan_amount ?? 0) - totalForCycle);
              return (
                <tr key={row.id} className="border-t border-border/40 transition-colors hover:bg-secondary/20">
                  <td className="px-4 py-3">{profile?.full_name || "—"}<div className="text-xs text-muted-foreground">{profile?.phone}</div></td>
                  <td className="px-4 py-3">{planLabel}</td>
                  <td className="px-4 py-3">{fmt(Number(investment?.plan_amount ?? 0))}</td>
                  <td className="px-4 py-3">{fmt(row.amount)}</td>
                  <td className="px-4 py-3">{fmt(totalForCycle)}</td>
                  <td className="px-4 py-3">{fmt(remainingForCycle)}</td>
                  <td className="px-4 py-3"><span className={`inline-flex rounded-full px-2 py-0.5 text-xs font-medium ${row.status === 'released' ? 'bg-emerald-500/15 text-emerald-400' : 'bg-yellow-500/15 text-yellow-400'}`}>{row.status}</span></td>
                  <td className="px-4 py-3">
                    <div className="flex justify-end gap-1">
                      <button type="button" onClick={() => setSelectedEarning(row)} className="inline-flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-xs font-semibold text-muted-foreground hover:bg-secondary hover:text-foreground" aria-label="View daily earning">
                        <Eye className="h-3.5 w-3.5" /> View
                      </button>
                      <button type="button" onClick={() => void deleteEarning(row)} disabled={deletingEarningId === row.id} className="inline-flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-xs font-semibold text-red-400 hover:bg-red-500/10 disabled:cursor-not-allowed disabled:opacity-50" aria-label="Delete daily earning">
                        <Trash2 className="h-3.5 w-3.5" /> {deletingEarningId === row.id ? "Deleting" : "Delete"}
                      </button>
                    </div>
                  </td>
                </tr>
              );
            })}
            {filtered.length === 0 && <tr><td colSpan={8} className="px-4 py-8 text-center text-muted-foreground">No daily earnings found.</td></tr>}
          </tbody>
        </table>
      </div>
      <TablePagination
        page={safePage}
        totalPages={totalPages}
        rowsPerPage={rowsPerPage}
        onPageChange={setPage}
        onRowsPerPageChange={setRowsPerPage}
        totalItems={filtered.length}
        startIndex={(safePage - 1) * rowsPerPage}
        endIndex={Math.min(safePage * rowsPerPage, filtered.length)}
      />
      <Dialog open={Boolean(selectedEarning)} onOpenChange={(open) => { if (!open) setSelectedEarning(null); }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Daily earning details</DialogTitle>
            <DialogDescription>Review the earning record and its investment.</DialogDescription>
          </DialogHeader>
          {selectedEarning && (() => {
            const profile = profiles[selectedEarning.user_id];
            const investment = investments.find(inv => inv.id === selectedEarning.investment_id);
            return (
              <dl className="grid gap-3 rounded-xl border border-border/60 bg-secondary/20 p-4 text-sm sm:grid-cols-2">
                <div><dt className="text-xs text-muted-foreground">User</dt><dd className="mt-1 font-medium">{profile?.full_name || "—"}</dd></div>
                <div><dt className="text-xs text-muted-foreground">Phone</dt><dd className="mt-1">{profile?.phone || "—"}</dd></div>
                <div><dt className="text-xs text-muted-foreground">Investment</dt><dd className="mt-1">{fmt(Number(investment?.plan_amount ?? 0))}</dd></div>
                <div><dt className="text-xs text-muted-foreground">Daily earning</dt><dd className="mt-1 font-semibold">{fmt(selectedEarning.amount)}</dd></div>
                <div><dt className="text-xs text-muted-foreground">Earning date</dt><dd className="mt-1">{selectedEarning.earning_date}</dd></div>
                <div><dt className="text-xs text-muted-foreground">Status</dt><dd className="mt-1 capitalize">{selectedEarning.status}</dd></div>
                <div className="sm:col-span-2"><dt className="text-xs text-muted-foreground">Investment ID</dt><dd className="mt-1 break-all font-mono text-xs">{selectedEarning.investment_id}</dd></div>
              </dl>
            );
          })()}
        </DialogContent>
      </Dialog>
    </div>
  );
}

function MoneyFlowAnalyticsTab({ range, setRange, customStart, setCustomStart, customEnd, setCustomEnd, cards, formatMoney, moneyData }: {
  range: DateRangePreset;
  setRange: (value: DateRangePreset) => void;
  customStart: string;
  setCustomStart: (value: string) => void;
  customEnd: string;
  setCustomEnd: (value: string) => void;
  cards: Array<{ key: string; label: string; value: number; tone: string; icon: React.ComponentType<{ className?: string }>; helper: string }>;
  formatMoney: (value: number | string | null | undefined) => string;
  moneyData: Record<string, any>;
}) {
  const rangeOptions: Array<{ value: DateRangePreset; label: string }> = [
    { value: "today", label: "Today" },
    { value: "week", label: "This week" },
    { value: "month", label: "This month" },
    { value: "year", label: "This year" },
    { value: "all", label: "All time" },
    { value: "custom", label: "Custom range" },
  ];

  const toneClass = (tone: string) => {
    switch (tone) {
      case "green": return "border-emerald-500/20 bg-emerald-500/10 text-emerald-300";
      case "blue": return "border-sky-500/20 bg-sky-500/10 text-sky-300";
      case "gold": return "border-amber-500/20 bg-amber-500/10 text-amber-300";
      case "red": return "border-rose-500/20 bg-rose-500/10 text-rose-300";
      default: return "border-border/60 bg-card text-foreground";
    }
  };

  return (
    <div className="space-y-6">
      <div className="rounded-2xl border border-border/60 bg-card p-4">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <h2 className="text-xl font-semibold">Money Flow Analytics</h2>
            <p className="mt-1 text-sm text-muted-foreground">Real financial overview for TRENDY INVESTMENT AGENCY with no fake values.</p>
          </div>
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
            <div className="flex flex-wrap gap-2">
              {rangeOptions.map(option => (
                <button key={option.value} onClick={() => setRange(option.value)} className={`rounded-full px-3 py-1 text-xs font-semibold ${range === option.value ? "bg-primary text-primary-foreground" : "bg-secondary/50 text-muted-foreground hover:text-foreground"}`}>
                  {option.label}
                </button>
              ))}
            </div>
            {range === "custom" && (
              <div className="flex flex-col gap-2 sm:flex-row">
                <input type="date" value={customStart} onChange={e => setCustomStart(e.target.value)} className="rounded-md border border-border bg-background px-3 py-2 text-sm" />
                <input type="date" value={customEnd} onChange={e => setCustomEnd(e.target.value)} className="rounded-md border border-border bg-background px-3 py-2 text-sm" />
              </div>
            )}
          </div>
        </div>
      </div>

      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
        {cards.map(card => {
          const Icon = card.icon;
          return (
            <div key={card.key} className={`rounded-2xl border p-4 ${toneClass(card.tone)}`}>
              <div className="flex items-center justify-between gap-2">
                <div className="text-sm font-medium">{card.label}</div>
                <Icon className="h-4 w-4" />
              </div>
              <div className="mt-3 text-2xl font-bold">${formatMoney(card.value)}</div>
              <div className="mt-1 text-xs opacity-80">{card.helper}</div>
            </div>
          );
        })}
      </div>

      <div className="grid gap-4 xl:grid-cols-2">
        <div className="rounded-2xl border border-border/60 bg-card p-4">
          <div className="mb-3 text-sm font-semibold">Deposits vs Withdrawals</div>
          <div className="h-72">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={[{ label: "Deposits", deposits: moneyData.approvedDepositsTotal, withdrawals: moneyData.paidWithdrawalsNetTotal }]}> 
                <CartesianGrid strokeDasharray="3 3" stroke="#2a2a2a" />
                <XAxis dataKey="label" />
                <YAxis />
                <Tooltip formatter={(value: number) => `$${formatMoney(value)}`} />
                <Bar dataKey="deposits" fill="#10b981" radius={[4, 4, 0, 0]} />
                <Bar dataKey="withdrawals" fill="#ef4444" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>

        <div className="rounded-2xl border border-border/60 bg-card p-4">
          <div className="mb-3 text-sm font-semibold">Investments vs Reinvestments</div>
          <div className="h-72">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={moneyData.investmentVsReinvestment}>
                <CartesianGrid strokeDasharray="3 3" stroke="#2a2a2a" />
                <XAxis dataKey="label" />
                <YAxis />
                <Tooltip formatter={(value: number) => `$${formatMoney(value)}`} />
                <Bar dataKey="amount" fill="#38bdf8" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>

        <div className="rounded-2xl border border-border/60 bg-card p-4">
          <div className="mb-3 text-sm font-semibold">Daily Earnings</div>
          <div className="h-72">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={moneyData.dailyTrendData}>
                <CartesianGrid strokeDasharray="3 3" stroke="#2a2a2a" />
                <XAxis dataKey="label" />
                <YAxis />
                <Tooltip formatter={(value: number) => `$${formatMoney(value)}`} />
                <Line type="monotone" dataKey="total" stroke="#f59e0b" strokeWidth={2} />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </div>

        <div className="rounded-2xl border border-border/60 bg-card p-4">
          <div className="mb-3 text-sm font-semibold">Referral Commission</div>
          <div className="h-72">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={moneyData.referralBreakdown}>
                <CartesianGrid strokeDasharray="3 3" stroke="#2a2a2a" />
                <XAxis dataKey="label" />
                <YAxis />
                <Tooltip formatter={(value: number) => `$${formatMoney(value)}`} />
                <Bar dataKey="amount" fill="#8b5cf6" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>

        <div className="rounded-2xl border border-border/60 bg-card p-4">
          <div className="mb-3 text-sm font-semibold">Active vs Completed Investments</div>
          <div className="h-72">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={moneyData.cycleBreakdown}>
                <CartesianGrid strokeDasharray="3 3" stroke="#2a2a2a" />
                <XAxis dataKey="label" />
                <YAxis />
                <Tooltip formatter={(value: number) => `$${formatMoney(value)}`} />
                <Bar dataKey="amount" fill="#0ea5e9" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>

        <div className="rounded-2xl border border-border/60 bg-card p-4">
          <div className="mb-3 text-sm font-semibold">Platform Profit</div>
          <div className="h-72">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={[{ label: "Fee income", amount: moneyData.totalPlatformProfit }]}> 
                <CartesianGrid strokeDasharray="3 3" stroke="#2a2a2a" />
                <XAxis dataKey="label" />
                <YAxis />
                <Tooltip formatter={(value: number) => `$${formatMoney(value)}`} />
                <Line type="monotone" dataKey="amount" stroke="#ef4444" strokeWidth={2} />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </div>
      </div>
    </div>
  );
}

function Badge({ status }: { status: string }) {
  const cls = status === "approved" ? "bg-emerald-500/15 text-emerald-400"
    : status === "rejected" ? "bg-red-500/15 text-red-400"
    : "bg-yellow-500/15 text-yellow-400";
  return <span className={`inline-flex rounded-full px-2 py-0.5 text-xs font-medium ${cls}`}>{status}</span>;
}

const EMPTY_PLAN: Omit<PlanRow, "id"> = {
  name: "", slug: "", description: "",
  duration_days: 7, daily_return_percent: 6, roi_percent: 40,
  min_amount: 250, max_amount: null, unlock_day: 1,
  amount_presets: [250, 500, 1000, 5000, 10000],
  color: "#F5B301", icon: "sparkles", sort_order: 0, is_active: true,
};

function PlansTab({ investments, dailyEarnings, withdrawals, referrals, deposits, transactions, isSuperAdmin, currentUserEmail }: {
  investments: InvestmentRow[];
  dailyEarnings: DailyEarningAdminRow[];
  withdrawals: WithdrawalRow[];
  referrals: ReferralRow[];
  deposits: DepositRow[];
  transactions: any[];
  isSuperAdmin: boolean;
  currentUserEmail: string | null;
}) {
  const [plans, setPlans] = useState<PlanRow[]>([]);
  const [editing, setEditing] = useState<PlanRow | (Omit<PlanRow, "id"> & { id?: string }) | null>(null);
  const [busy, setBusy] = useState(false);
  const [planSearch, setPlanSearch] = useState("");
  const [page, setPage] = useState(1);
  const [rowsPerPage, setRowsPerPage] = useState(10);
  const [deleteTarget, setDeleteTarget] = useState<PlanRow | null>(null);
  const [confirmText, setConfirmText] = useState("");
  const [deleteBusy, setDeleteBusy] = useState(false);

  const deleteSummary = useMemo(() => {
    if (!deleteTarget) return null;
    const linkedInvestments = investments.filter(inv => inv.plan_id === deleteTarget.id);
    const linkedDeposits = deposits.filter(dep => dep.plan_id === deleteTarget.id);
    const linkedDailyEarnings = dailyEarnings.filter(earning => linkedInvestments.some(inv => inv.id === earning.investment_id));
    const linkedReferrals = referrals.filter(ref => linkedDeposits.some(dep => dep.id === ref.deposit_id));
    const linkedTransactions = transactions.filter(tx => {
      const metaPlanId = tx?.metadata?.plan_id ?? tx?.metadata?.planId;
      if (metaPlanId === deleteTarget.id) return true;
      const investmentId = tx?.metadata?.investment_id;
      return Boolean(investmentId && linkedInvestments.some(inv => inv.id === investmentId));
    });
    return { linkedInvestments, linkedDeposits, linkedDailyEarnings, linkedReferrals, linkedTransactions };
  }, [deleteTarget, investments, dailyEarnings, deposits, referrals, transactions]);

  const load = useCallback(async () => {
    const { data, error } = await supabase.from("investment_plans").select("*").order("sort_order").order("min_amount");
    if (error) return toast.error(error.message);
    setPlans((data ?? []) as PlanRow[]);
  }, []);
  useEffect(() => { void load(); }, [load]);

  const savePlan = async () => {
    if (!editing) return;
    if (!editing.name.trim() || !editing.slug.trim()) return toast.error("Name and slug are required");
    setBusy(true);
    const duration = Math.max(1, Number(editing.duration_days));
    const roiPercent = Math.max(0, Math.round(Number(editing.roi_percent ?? editing.daily_return_percent ?? 0)));
    const amountPresets = Array.isArray(editing.amount_presets)
      ? editing.amount_presets.filter(v => Number.isFinite(v) && v > 0)
      : [];
    const payload = {
      name: editing.name.trim(),
      slug: editing.slug.trim().toLowerCase().replace(/[^a-z0-9-]+/g, "-"),
      description: editing.description || null,
      duration_days: duration,
      daily_return_percent: Number((roiPercent / duration).toFixed(2)),
      roi_percent: roiPercent,
      min_amount: Number(editing.min_amount),
      max_amount: editing.max_amount ? Number(editing.max_amount) : null,
      unlock_day: Math.max(1, Number(editing.unlock_day ?? 1)),
      amount_presets: amountPresets,
      color: editing.color || null,
      icon: editing.icon || null,
      sort_order: Number(editing.sort_order) || 0,
      is_active: !!editing.is_active,
    };
    const res = "id" in editing && editing.id
      ? await supabase.from("investment_plans").update(payload).eq("id", editing.id)
      : await supabase.from("investment_plans").insert(payload);
    setBusy(false);
    if (res.error) return toast.error(res.error.message);
    toast.success("Plan saved");
    setEditing(null);
    void load();
  };

  const disable = async (p: PlanRow) => {
    const { error } = await supabase.from("investment_plans").update({ is_active: false }).eq("id", p.id);
    if (error) return toast.error(error.message);
    toast.success("Plan disabled");
    void load();
  };

  const archive = async (p: PlanRow) => {
    const { error } = await supabase.from("investment_plans").update({ is_active: false, archived_at: new Date().toISOString() }).eq("id", p.id);
    if (error) return toast.error(error.message);
    toast.success("Plan archived and hidden from users");
    void load();
  };

  const requestDelete = (p: PlanRow) => {
    setDeleteTarget(p);
    setConfirmText("");
  };

  const cancelDelete = () => {
    setDeleteTarget(null);
    setConfirmText("");
  };

  const confirmDelete = async () => {
    if (!deleteTarget || !isSuperAdmin) return;
    if (confirmText !== "DELETE PLAN") {
      toast.error("Type DELETE PLAN to confirm permanent deletion.");
      return;
    }
    setDeleteBusy(true);
    try {
      const { data, error } = await supabase.rpc("delete_mining_plan_with_related_data", { plan_id: deleteTarget.id });
      if (error) throw error;
      toast.success(data?.message || "Plan and related data deleted.");
      setDeleteTarget(null);
      setConfirmText("");
      void load();
    } catch (err: any) {
      toast.error(err?.message || "The deletion function is not available yet. Apply the database migration first.");
    } finally {
      setDeleteBusy(false);
    }
  };

  const filteredPlans = plans.filter(plan => {
    const q = planSearch.trim().toLowerCase();
    if (!q) return true;
    return [plan.name, plan.slug, plan.description].some(value => value?.toLowerCase().includes(q));
  });
  const totalPages = Math.max(1, Math.ceil(filteredPlans.length / rowsPerPage));
  const safePage = Math.min(page, totalPages);
  const visiblePlans = filteredPlans.slice((safePage - 1) * rowsPerPage, safePage * rowsPerPage);

  useEffect(() => { setPage(1); }, [planSearch, rowsPerPage]);

  return (
    <div>
      <div className="space-y-3">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
          <h3 className="text-lg font-bold">Investment plans</h3>
          <div className="flex flex-wrap items-center gap-2">
            <input value={planSearch} onChange={e => setPlanSearch(e.target.value)} placeholder="Search plans" className="rounded-md border border-border bg-background px-3 py-2 text-sm focus:border-primary focus:outline-none" />
            <select value={rowsPerPage} onChange={e => setRowsPerPage(Number(e.target.value))} className="rounded-md border border-border bg-background px-3 py-2 text-sm focus:border-primary focus:outline-none">
              {[10, 25, 50, 100].map(value => <option key={value} value={value}>{value} / page</option>)}
            </select>
            <button onClick={() => setEditing({ ...EMPTY_PLAN })} className="rounded-md bg-[image:var(--gradient-gold)] px-3 py-2 text-xs font-semibold text-primary-foreground shadow-[var(--shadow-gold)]">+ New plan</button>
          </div>
        </div>
        {deleteTarget && (
          <div className="rounded-2xl border border-red-500/30 bg-red-500/10 p-4 text-sm">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <h4 className="font-semibold text-red-400">Permanent plan deletion</h4>
                <p className="mt-1 text-muted-foreground">
                  This will permanently remove <span className="font-semibold text-foreground">{deleteTarget.name}</span> and all related records linked to it.
                </p>
              </div>
              <button onClick={cancelDelete} className="rounded-md border border-border px-3 py-1 text-xs font-semibold">Cancel</button>
            </div>
            <div className="mt-3 grid gap-2 sm:grid-cols-2">
              <div className="rounded-lg border border-red-500/20 bg-background/50 p-3">
                <div className="text-xs uppercase tracking-wide text-muted-foreground">Investments</div>
                <div className="mt-1 text-lg font-semibold">{deleteSummary?.linkedInvestments.length ?? 0}</div>
              </div>
              <div className="rounded-lg border border-red-500/20 bg-background/50 p-3">
                <div className="text-xs uppercase tracking-wide text-muted-foreground">Deposits</div>
                <div className="mt-1 text-lg font-semibold">{deleteSummary?.linkedDeposits.length ?? 0}</div>
              </div>
              <div className="rounded-lg border border-red-500/20 bg-background/50 p-3">
                <div className="text-xs uppercase tracking-wide text-muted-foreground">Daily earnings</div>
                <div className="mt-1 text-lg font-semibold">{deleteSummary?.linkedDailyEarnings.length ?? 0}</div>
              </div>
              <div className="rounded-lg border border-red-500/20 bg-background/50 p-3">
                <div className="text-xs uppercase tracking-wide text-muted-foreground">Transactions</div>
                <div className="mt-1 text-lg font-semibold">{deleteSummary?.linkedTransactions.length ?? 0}</div>
              </div>
            </div>
            <div className="mt-4 flex flex-col gap-2 sm:flex-row sm:items-center">
              <input value={confirmText} onChange={e => setConfirmText(e.target.value)} placeholder="Type DELETE PLAN" className="flex-1 rounded-md border border-red-500/30 bg-background px-3 py-2 text-sm focus:border-red-400 focus:outline-none" />
              <button onClick={confirmDelete} disabled={deleteBusy || !isSuperAdmin} className="rounded-md bg-red-600 px-3 py-2 text-sm font-semibold text-white hover:bg-red-500 disabled:cursor-not-allowed disabled:opacity-50">
                {deleteBusy ? "Deleting…" : "Delete permanently"}
              </button>
            </div>
            {!isSuperAdmin && <p className="mt-2 text-xs text-muted-foreground">Only super admins can execute this destructive action.</p>}
          </div>
        )}
        <div className="overflow-x-auto rounded-2xl border border-border/60 bg-card shadow-sm">
          <table className="w-full min-w-[920px] text-sm">
            <thead className="border-b border-border/60 bg-secondary/30 text-left text-[11px] uppercase tracking-[0.12em] text-muted-foreground">
              <tr>
                <th className="w-20 px-5 py-4">Order</th>
                <th className="px-5 py-4">Plan</th>
                <th className="px-5 py-4">Amounts</th>
                <th className="px-5 py-4">ROI</th>
                <th className="px-5 py-4">Term</th>
                <th className="px-5 py-4">Unlock</th>
                <th className="px-5 py-4">Status</th>
                <th className="px-5 py-4 text-right">Actions</th>
              </tr>
            </thead>
            <tbody>
              {visiblePlans.map(p => (
                <tr key={p.id} className="border-t border-border/40 transition-colors hover:bg-secondary/20">
                  <td className="px-5 py-4 align-middle text-muted-foreground">
                    <span className="inline-flex h-7 w-7 items-center justify-center rounded-full bg-secondary text-xs font-bold">{p.sort_order}</span>
                  </td>
                  <td className="px-5 py-4">
                    <div className="flex items-center gap-3">
                      <span className="h-9 w-1 rounded-full" style={{ backgroundColor: p.color || "var(--primary)" }} />
                      <div>
                        <div className="font-semibold text-foreground">{p.name}</div>
                        <div className="mt-0.5 text-xs text-muted-foreground">{p.slug}</div>
                      </div>
                    </div>
                  </td>
                  <td className="px-5 py-4">
                    <div className="font-semibold text-foreground">{p.amount_presets && p.amount_presets.length ? p.amount_presets.map(amount => fmt(amount)).join(" · ") : `${fmt(p.min_amount)}+`}</div>
                    <div className="mt-0.5 text-xs text-muted-foreground">USD investment</div>
                  </td>
                  <td className="px-5 py-4"><span className="inline-flex rounded-full bg-primary/10 px-2.5 py-1 text-xs font-bold text-primary">{Math.round(Number(p.roi_percent ?? p.daily_return_percent ?? 0))}%</span></td>
                  <td className="px-5 py-4"><span className="font-medium">{p.duration_days}</span> <span className="text-xs text-muted-foreground">days</span></td>
                  <td className="px-5 py-4"><span className="font-medium">Day {p.unlock_day ?? 1}</span></td>
                  <td className="px-5 py-4">
                    <button onClick={() => disable(p)} title={p.is_active ? "Disable plan" : "Disabled plan"} className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-semibold ${p.is_active ? "bg-emerald-500/15 text-emerald-400" : "bg-muted text-muted-foreground"}`}>
                      <span className={`h-1.5 w-1.5 rounded-full ${p.is_active ? "bg-emerald-400" : "bg-muted-foreground"}`} />
                      {p.is_active ? "Active" : p.archived_at ? "Archived" : "Disabled"}
                    </button>
                  </td>
                  <td className="px-5 py-4">
                    <div className="flex justify-end gap-1.5">
                      <button onClick={() => setEditing(p)} title="View plan" aria-label={`View ${p.name} plan`} className="inline-flex h-8 w-8 items-center justify-center rounded-lg border border-border bg-background text-muted-foreground transition-colors hover:border-primary/40 hover:text-primary"><Eye className="h-3.5 w-3.5" /></button>
                      <button onClick={() => setEditing(p)} title="Edit plan" aria-label={`Edit ${p.name} plan`} className="inline-flex h-8 w-8 items-center justify-center rounded-lg border border-border bg-background text-muted-foreground transition-colors hover:border-amber-500/40 hover:text-amber-400"><Pencil className="h-3.5 w-3.5" /></button>
                      <button onClick={() => disable(p)} title="Disable plan" aria-label={`Disable ${p.name} plan`} className="inline-flex h-8 w-8 items-center justify-center rounded-lg border border-border bg-background text-muted-foreground transition-colors hover:border-slate-400/40 hover:text-slate-300"><Ban className="h-3.5 w-3.5" /></button>
                      <button onClick={() => archive(p)} title="Archive plan" aria-label={`Archive ${p.name} plan`} className="inline-flex h-8 w-8 items-center justify-center rounded-lg border border-border bg-background text-muted-foreground transition-colors hover:border-amber-500/40 hover:text-amber-400"><Archive className="h-3.5 w-3.5" /></button>
                      <button onClick={() => requestDelete(p)} disabled={!isSuperAdmin} title="Delete plan" aria-label={`Delete ${p.name} plan`} className="inline-flex h-8 w-8 items-center justify-center rounded-lg border border-border bg-background text-muted-foreground transition-colors hover:border-red-500/40 hover:text-red-400 disabled:cursor-not-allowed disabled:opacity-40"><Trash2 className="h-3.5 w-3.5" /></button>
                    </div>
                  </td>
                </tr>
              ))}
              {visiblePlans.length === 0 && <tr><td colSpan={8} className="px-4 py-8 text-center text-muted-foreground">No records found.</td></tr>}
            </tbody>
          </table>
        </div>
        <div className="flex flex-wrap items-center justify-between gap-2 rounded-2xl border border-border/60 bg-card/70 px-4 py-3 text-sm">
          <span className="text-muted-foreground">Showing {filteredPlans.length === 0 ? 0 : (safePage - 1) * rowsPerPage + 1}-{Math.min(safePage * rowsPerPage, filteredPlans.length)} of {filteredPlans.length}</span>
          <div className="flex items-center gap-2">
            <button onClick={() => setPage(value => Math.max(1, value - 1))} disabled={safePage === 1} className="rounded-md border border-border px-3 py-1 text-xs font-semibold disabled:cursor-not-allowed disabled:opacity-50">Prev</button>
            <span className="text-xs text-muted-foreground">Page {safePage} / {totalPages}</span>
            <button onClick={() => setPage(value => Math.min(totalPages, value + 1))} disabled={safePage >= totalPages} className="rounded-md border border-border px-3 py-1 text-xs font-semibold disabled:cursor-not-allowed disabled:opacity-50">Next</button>
          </div>
        </div>
      </div>

      <Dialog open={Boolean(editing)} onOpenChange={(open) => { if (!open && !busy) setEditing(null); }}>
        <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-2xl">
          {editing && (
            <>
              <DialogHeader>
                <DialogTitle>{("id" in editing && editing.id) ? "Edit investment plan" : "Create investment plan"}</DialogTitle>
                <DialogDescription>Set the plan details, pricing, returns, and visibility.</DialogDescription>
              </DialogHeader>
              <div className="space-y-4 text-sm">
                <div className="grid gap-3 sm:grid-cols-2">
                  <Field label="Name"><input autoFocus value={editing.name} onChange={e => setEditing({ ...editing, name: e.target.value })} className={inputCls} placeholder="Silver" /></Field>
                  <Field label="Slug"><input value={editing.slug} onChange={e => setEditing({ ...editing, slug: e.target.value })} className={inputCls} placeholder="silver" /></Field>
                </div>
                <Field label="Description"><textarea rows={3} value={editing.description ?? ""} onChange={e => setEditing({ ...editing, description: e.target.value })} className={inputCls} placeholder="Describe this investment plan" /></Field>
                <div className="grid gap-3 sm:grid-cols-2">
                  <Field label="Duration (days)"><input type="number" min="1" value={editing.duration_days} onChange={e => setEditing({ ...editing, duration_days: Number(e.target.value) })} className={inputCls} /></Field>
                  <Field label="ROI %"><input type="number" min="0" step="1" value={editing.roi_percent ?? editing.daily_return_percent ?? ""} onChange={e => setEditing({ ...editing, roi_percent: Number(e.target.value) })} className={inputCls} /></Field>
                  <Field label="Min amount"><input type="number" min="0" value={editing.min_amount} onChange={e => setEditing({ ...editing, min_amount: Number(e.target.value) })} className={inputCls} /></Field>
                  <Field label="Max amount"><input type="number" min="0" value={editing.max_amount ?? ""} onChange={e => setEditing({ ...editing, max_amount: e.target.value ? Number(e.target.value) : null })} className={inputCls} placeholder="No limit" /></Field>
                  <Field label="Unlock day"><input type="number" min="1" value={editing.unlock_day ?? 1} onChange={e => setEditing({ ...editing, unlock_day: Number(e.target.value) })} className={inputCls} /></Field>
                  <Field label="Sort order"><input type="number" value={editing.sort_order} onChange={e => setEditing({ ...editing, sort_order: Number(e.target.value) })} className={inputCls} /></Field>
                  <Field label="Color"><input type="color" value={editing.color ?? "#F5B301"} onChange={e => setEditing({ ...editing, color: e.target.value })} className="h-9 w-full rounded-md border border-border bg-background" /></Field>
                  <Field label="Amount presets"><input value={Array.isArray(editing.amount_presets) ? editing.amount_presets.join(", ") : ""} onChange={e => setEditing({ ...editing, amount_presets: e.target.value.split(",").map(v => Number(v.trim())).filter(v => Number.isFinite(v) && v > 0) })} className={inputCls} placeholder="250, 500, 1000" /></Field>
                </div>
                <Field label="Icon (lucide name)"><input value={editing.icon ?? ""} onChange={e => setEditing({ ...editing, icon: e.target.value })} className={inputCls} placeholder="sparkles" /></Field>
                <label className="flex items-center gap-2"><input type="checkbox" checked={editing.is_active} onChange={e => setEditing({ ...editing, is_active: e.target.checked })} /> <span>Active (visible to users)</span></label>
                <div className="flex justify-end gap-2 pt-2">
                  <button type="button" onClick={() => setEditing(null)} className="rounded-md border border-border px-4 py-2 text-sm">Cancel</button>
                  <button type="button" disabled={busy} onClick={savePlan} className="rounded-md bg-[image:var(--gradient-gold)] px-5 py-2 text-sm font-semibold text-primary-foreground shadow-[var(--shadow-gold)] disabled:opacity-60">{busy ? "Saving..." : "Save plan"}</button>
                </div>
              </div>
            </>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}

function SettingsTab() {
  const [s, setS] = useState<SettingsRow | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    const { data, error } = await supabase.from("app_settings").select("*").eq("id", 1).maybeSingle();
    if (error) return toast.error(error.message);
    if (data) setS(data as SettingsRow);
    else setS({ id: 1, referral_percent: 10, min_deposit: 500, min_withdrawal: 100, max_withdrawal: 100000, withdrawal_fee_percent: 5, contact_email: "", whatsapp: "", mpesa_till: "", maintenance_mode: false, email_notifications_enabled: true, email_notifications_deposits: true, email_notifications_withdrawals: true, email_notifications_mining: true, email_notifications_referrals: true, email_notifications_account: true });
  }, []);
  useEffect(() => { void load(); }, [load]);

  const saveSettings = async () => {
    if (!s) return;
    setBusy(true);
    const { error } = await supabase.from("app_settings").upsert({ ...s, id: 1 });
    setBusy(false);
    if (error) return toast.error(error.message);
    toast.success("Settings saved");
    void load();
  };

  if (!s) return <p className="text-muted-foreground">Loading…</p>;
  const upd = <K extends keyof SettingsRow>(k: K, v: SettingsRow[K]) => setS({ ...s, [k]: v });

  return (
    <div className="max-w-2xl space-y-6">
      <div>
        <h3 className="text-lg font-bold">App settings</h3>
        <p className="text-sm text-muted-foreground">Applied across deposits, withdrawals, and referrals.</p>
      </div>

      <section className="rounded-2xl border border-border/60 bg-card p-5 space-y-4">
        <h4 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">Money rules</h4>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Min deposit (USD)"><input type="number" value={s.min_deposit} onChange={e => upd("min_deposit", Number(e.target.value))} className={inputCls} /></Field>
          <Field label="Min withdrawal (USD)"><input type="number" value={s.min_withdrawal} onChange={e => upd("min_withdrawal", Number(e.target.value))} className={inputCls} /></Field>
          <Field label="Max withdrawal (USD)"><input type="number" value={s.max_withdrawal} onChange={e => upd("max_withdrawal", Number(e.target.value))} className={inputCls} /></Field>
          <Field label="Withdrawal fee %"><input type="number" step="0.01" value={s.withdrawal_fee_percent} onChange={e => upd("withdrawal_fee_percent", Number(e.target.value))} className={inputCls} /></Field>
          <Field label="Referral %"><input type="number" step="0.01" value={s.referral_percent} onChange={e => upd("referral_percent", Number(e.target.value))} className={inputCls} /></Field>
          <Field label="M-Pesa till number"><input value={s.mpesa_till ?? ""} onChange={e => upd("mpesa_till", e.target.value)} className={inputCls} /></Field>
        </div>
      </section>

      <section className="rounded-2xl border border-border/60 bg-card p-5 space-y-4">
        <h4 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">Contact</h4>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Contact email"><input type="email" value={s.contact_email ?? ""} onChange={e => upd("contact_email", e.target.value)} className={inputCls} /></Field>
          <Field label="WhatsApp number"><input value={s.whatsapp ?? ""} onChange={e => upd("whatsapp", e.target.value)} className={inputCls} /></Field>
        </div>
      </section>

      <section className="rounded-2xl border border-border/60 bg-card p-5 space-y-4">
        <h4 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">Notifications</h4>
        <label className="flex items-center gap-3">
          <input type="checkbox" checked={s.email_notifications_enabled !== false} onChange={e => upd("email_notifications_enabled", e.target.checked)} />
          <span className="text-sm">Enable all email notifications</span>
        </label>
        <div className="grid gap-3 sm:grid-cols-2">
          <label className="flex items-center gap-3 rounded-lg border border-border/60 bg-background/70 p-3">
            <input type="checkbox" checked={s.email_notifications_deposits !== false} onChange={e => upd("email_notifications_deposits", e.target.checked)} />
            <span className="text-sm">Deposit emails</span>
          </label>
          <label className="flex items-center gap-3 rounded-lg border border-border/60 bg-background/70 p-3">
            <input type="checkbox" checked={s.email_notifications_withdrawals !== false} onChange={e => upd("email_notifications_withdrawals", e.target.checked)} />
            <span className="text-sm">Withdrawal emails</span>
          </label>
          <label className="flex items-center gap-3 rounded-lg border border-border/60 bg-background/60 p-3">
            <input type="checkbox" checked={s.email_notifications_mining !== false} onChange={e => upd("email_notifications_mining", e.target.checked)} />
            <span className="text-sm">Mining / earnings emails</span>
          </label>
          <label className="flex items-center gap-3 rounded-lg border border-border/60 bg-background/70 p-3">
            <input type="checkbox" checked={s.email_notifications_referrals !== false} onChange={e => upd("email_notifications_referrals", e.target.checked)} />
            <span className="text-sm">Referral emails</span>
          </label>
          <label className="flex items-center gap-3 rounded-lg border border-border/60 bg-background/70 p-3">
            <input type="checkbox" checked={s.email_notifications_account !== false} onChange={e => upd("email_notifications_account", e.target.checked)} />
            <span className="text-sm">Account status emails</span>
          </label>
        </div>
      </section>

      <section className="rounded-2xl border border-border/60 bg-card p-5 space-y-3">
        <h4 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">System</h4>
        <label className="flex items-center gap-3">
          <input type="checkbox" checked={s.maintenance_mode} onChange={e => upd("maintenance_mode", e.target.checked)} />
          <span className="text-sm">Maintenance mode (blocks new deposits/withdrawals for non-admins)</span>
        </label>
      </section>

      <div className="flex justify-end">
        <button disabled={busy} onClick={saveSettings} className="rounded-md bg-[image:var(--gradient-gold)] px-5 py-2 text-sm font-semibold text-primary-foreground shadow-[var(--shadow-gold)] disabled:opacity-60">Save settings</button>
      </div>
    </div>
  );
}

const inputCls = "mt-1 block w-full rounded-md border border-border bg-background px-3 py-2 text-sm focus:border-primary focus:outline-none";

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="text-xs font-medium text-muted-foreground">{label}</span>
      {children}
    </label>
  );
}