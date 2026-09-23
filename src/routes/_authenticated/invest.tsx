import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { CalendarDays, Cpu, Pickaxe, Timer, Zap } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { fmt, fmtKes, USD_TO_KES_RATE } from "@/lib/auth";
import { calculateInvestmentPlanMetrics } from "@/lib/investment-withdrawal";
import { sendMiningCycleStartedEmail } from "@/lib/api/email.functions";

export const Route = createFileRoute("/_authenticated/invest")({
  head: () => ({ meta: [{ title: "Invest — TRENDY INVESTMENT AGENCY" }] }),
  component: InvestPage,
});

type Plan = {
  id: string; name: string; slug: string; description: string;
  duration_days: number; daily_return_percent: number; roi_percent: number;
  min_amount: number; max_amount: number | null; unlock_day: number | null;
  amount_presets: number[] | null; color: string; icon: string;
};

type PaymentMethod = "mpesa" | "balance";

const AMOUNT_TIERS = [100, 250, 500];

function formatInvestmentAmount(amount: number | string) {
  const usd = Number(amount || 0);
  return `${fmt(usd)} (${fmtKes(usd * USD_TO_KES_RATE)})`;
}

function getPlanVariant(name: string) {
  const normalized = name.toLowerCase();
  if (normalized.includes("silver") || normalized.includes("standard") || normalized.includes("growth")) return "mid" as const;
  if (normalized.includes("gold") || normalized.includes("premium") || normalized.includes("pro")) return "pro" as const;
  return "entry" as const;
}

function PlanMetric({ icon: Icon, label, value, detail }: { icon: typeof Timer; label: string; value: string; detail?: string }) {
  return (
    <div className="rig-stat-row">
      <span className="rig-stat-icon"><Icon /></span>
      <dt className="rig-stat-name">{label}</dt>
      <dd className="rig-stat-value">{value}{detail && <small>{detail}</small>}</dd>
    </div>
  );
}

function getPlanRoi(plan: Pick<Plan, "roi_percent" | "daily_return_percent" | "duration_days">) {
  return Number(plan.roi_percent ?? plan.daily_return_percent * plan.duration_days);
}

function getPlanAmountTiers(plan: Pick<Plan, "amount_presets" | "min_amount" | "max_amount">) {
  const presets = Array.isArray(plan.amount_presets) ? plan.amount_presets.filter(v => Number.isFinite(v) && v > 0) : [];
  if (presets.length > 0) {
    return presets.filter(amount => amount >= Number(plan.min_amount) && (plan.max_amount === null || amount <= Number(plan.max_amount)));
  }
  return AMOUNT_TIERS.filter(amount => amount >= Number(plan.min_amount) && (plan.max_amount === null || amount <= Number(plan.max_amount)));
}

function getDefaultAmount(plan: Pick<Plan, "amount_presets" | "min_amount" | "max_amount">) {
  const tiers = getPlanAmountTiers(plan);
  return tiers[0] ?? (Number(plan.min_amount) || 250);
}

function InvestPage() {
  const navigate = useNavigate();
  const [plans, setPlans] = useState<Plan[]>([]);
  const [selected, setSelected] = useState<Plan | null>(null);
  const [amount, setAmount] = useState<number>(100);
  const [paymentMethod, setPaymentMethod] = useState<PaymentMethod>("mpesa");
  const [balance, setBalance] = useState(0);
  const [mpesaCode, setMpesaCode] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [isAdmin, setIsAdmin] = useState<boolean | null>(null);

  useEffect(() => {
    void Promise.all([
      supabase.from("investment_plans").select("*").eq("is_active", true).order("sort_order"),
      supabase.from("profiles").select("balance, status, deleted_at").maybeSingle(),
    ]).then(([plansResult, profileResult]) => {
      if (plansResult.data) {
        setPlans(plansResult.data as Plan[]);
        if (plansResult.data[0]) {
          const firstPlan = plansResult.data[0] as Plan;
          setSelected(firstPlan);
          setAmount(getDefaultAmount(firstPlan));
        }
      }
      if (profileResult.data) {
        setBalance(Math.floor(Number(profileResult.data.balance ?? 0)));
      }
    });
  }, []);

  useEffect(() => {
    void (async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) { setIsAdmin(false); return; }
      const { data } = await supabase.from("user_roles").select("role").eq("user_id", user.id).eq("role", "admin").maybeSingle();
      setIsAdmin(Boolean(data));
    })();
  }, []);

  const projected = useMemo(() => {
    if (!selected || !amount) return null;
    const roi = getPlanRoi(selected);
    const metrics = calculateInvestmentPlanMetrics({ amount, roiPercent: roi, durationDays: selected.duration_days });
    const endAt = new Date(Date.now() + selected.duration_days * 86400_000);
    return { roi, payout: metrics.totalReturn, profit: metrics.totalProfit, daily: metrics.dailyEarning, weekly: metrics.weeklyProfit, endAt };
  }, [selected, amount]);

  const amountValid = selected ? amount >= Number(selected.min_amount) && (selected.max_amount === null || amount <= Number(selected.max_amount)) : false;
  const balanceAvailable = balance >= amount;
  const submitDisabled = loading || !selected || !amountValid || (paymentMethod === "balance" && !balanceAvailable);

  const proceed = async () => {
    if (!selected) return;
    setError(null);
    if (!amountValid) {
      return toast.error(`Minimum for ${selected.name} is ${fmt(selected.min_amount)}`);
    }
    if (paymentMethod === "balance" && !balanceAvailable) {
      setError("Your available balance is not enough for this mining plan.");
      return toast.error("Your available balance is not enough for this mining plan.");
    }

    setConfirming(true);
  };

  const confirmInvestment = async () => {
    if (!selected) return;

    if (paymentMethod === "mpesa") {
      setConfirming(false);
      navigate({ to: "/deposit", search: { amount, plan: selected.id } });
      return;
    }

    if (paymentMethod === "balance") {
      setLoading(true);
      try {
        const { data: investmentId, error: rpcError } = await supabase.rpc("create_balance_investment", { _plan_id: selected.id, _amount: amount });
        if (rpcError) throw rpcError;
        if (investmentId) void sendMiningCycleStartedEmail({ data: { investmentId: String(investmentId) } }).catch(() => {});
        toast.success("Investment started from your available balance.");
        setConfirming(false);
        setMpesaCode("");
        setAmount(Number(selected.min_amount));
        const { data: profileData } = await supabase.from("profiles").select("balance").maybeSingle();
        if (profileData) setBalance(Math.floor(Number(profileData.balance ?? 0)));
      } catch (error: any) {
        const message = error?.message || "Unable to start investment.";
        setError(message);
        toast.error(message);
      } finally {
        setLoading(false);
      }
    }
  };

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-2xl font-bold">Investment plans</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          {isAdmin
            ? "Review the active plans available to members."
            : "Choose a fixed USD plan and select how to invest."}
        </p>
      </div>

      <div className="rig-tiers">
        {plans.map(p => {
          const active = selected?.id === p.id;
          const amount = getDefaultAmount(p);
          const dailyAccrual = amount * Number(p.daily_return_percent) / 100;
          const totalProfit = dailyAccrual * Number(p.duration_days);
          const variant = getPlanVariant(p.name);
          const progress = variant === "entry" ? 68 : variant === "mid" ? 52 : 37;
          return (
            <button key={p.id} type="button" aria-pressed={active} onClick={() => { setSelected(p); setAmount(amount); }}
              className={`rig-tier rig-tier-${variant} cursor-pointer text-left ${active ? "ring-2 ring-primary ring-offset-2 ring-offset-background" : ""}`}>
              <div className="rig-tier-top">
                <div className="rig-visual" aria-hidden="true">
                  <Cpu className="rig-machine" />
                  <span className="rig-coin">$</span>
                </div>
                <div className="rig-tier-info">
                  <span className="rig-badge">{p.name.toUpperCase()} PLAN</span>
                  <div className="rig-price">{fmt(amount)}</div>
                </div>
              </div>

              <div className="rig-progress">
                <div className="rig-progress-label"><span>Mining Progress</span><b>{progress}%</b></div>
                <div className="rig-progress-track"><div className="rig-progress-fill" style={{ width: `${progress}%` }} /></div>
              </div>

              <dl className="rig-stat-rows">
                <PlanMetric icon={Timer} label="Daily Return" value={`${Number(p.daily_return_percent).toFixed(2)}%`} detail={`(${fmt(dailyAccrual)})`} />
                <PlanMetric icon={Timer} label={`Total Profit (${p.duration_days} Days)`} value={`${(Number(p.daily_return_percent) * Number(p.duration_days)).toFixed(2)}%`} detail={`(${fmt(totalProfit)})`} />
                <PlanMetric icon={CalendarDays} label="Mining Duration" value={`${p.duration_days} Days`} />
                <PlanMetric icon={Zap} label="Mining Power" value={variant === "entry" ? "Low" : variant === "mid" ? "Medium" : "High"} />
              </dl>

              <div className="rig-mine-button"><Pickaxe /> Mining in Progress</div>
            </button>
          );
        })}
      </div>

      {!isAdmin && selected && (
        <div className="grid gap-4 rounded-2xl border border-border/60 bg-card p-6 sm:grid-cols-2">
          <div>
            <label className="text-sm font-medium">Investment amount (USD / KES)</label>
            <div className="mt-2 grid min-w-0 grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3">
              {getPlanAmountTiers(selected).map(a => (
                <button type="button" key={a} onClick={() => setAmount(a)}
                  className={`min-w-0 rounded-md border px-2 py-2 text-center text-xs leading-5 font-semibold whitespace-normal break-words transition-colors ${amount === a ? "border-primary bg-primary/15 text-primary" : "border-border hover:border-primary/40"}`}>
                  {formatInvestmentAmount(a)}
                </button>
              ))}
            </div>
            <input type="number" step="1" min={Number(selected.min_amount)} max={selected.max_amount ?? undefined}
              value={amount || ""} onChange={(e) => setAmount(Math.floor(Number(e.target.value)) || 0)}
              className="mt-2 block w-full rounded-md border border-border bg-background px-3 py-2 text-lg font-bold focus:border-primary focus:outline-none" />
            <div className="mt-2 break-words text-xs leading-5 text-muted-foreground">Fixed plan amount · {formatInvestmentAmount(selected.min_amount)}</div>
          </div>

          <div className="space-y-2 text-sm">
            <Row label="Plan" value={selected.name} />
            <Row label="Term" value={`${selected.duration_days} days`} />
            <Row label="Daily accrual" value={projected ? fmt(projected.daily) : "—"} />
            <Row label="Weekly profit" value={projected ? fmt(projected.weekly) : "—"} />
            <Row label="90-day profit" value={projected ? fmt(projected.profit) : "—"} accent />
            <Row label="Principal" value="Locked until maturity" />
            <Row label="End date" value={projected ? projected.endAt.toLocaleDateString() : "—"} />
          </div>

          <div className="sm:col-span-2 rounded-2xl border border-border/60 bg-background p-4">
            <div className="grid gap-2 sm:grid-cols-2">
              <button type="button" onClick={() => setPaymentMethod("mpesa")}
                className={`rounded-2xl border px-4 py-3 text-left ${paymentMethod === "mpesa" ? "border-primary bg-primary/10" : "border-border bg-secondary"}`}>
                <div className="text-sm font-semibold">Pay with M-Pesa</div>
                <div className="mt-1 text-xs text-muted-foreground">Continue with the existing M-Pesa deposit process.</div>
              </button>
              <button type="button" onClick={() => setPaymentMethod("balance")}
                className={`rounded-2xl border px-4 py-3 text-left ${paymentMethod === "balance" ? "border-primary bg-primary/10" : "border-border bg-secondary"}`}>
                <div className="text-sm font-semibold">Invest from Available Balance</div>
                <div className="mt-1 text-xs text-muted-foreground">Use your real available account balance.</div>
              </button>
            </div>

            <div className="mt-4 space-y-3">
              <div className="rounded-xl border border-border/60 bg-secondary p-4 text-sm">
                <div className="font-semibold">Available balance</div>
                <div className="mt-1 text-lg font-bold">{formatInvestmentAmount(balance)}</div>
                {paymentMethod === "balance" && !balanceAvailable && (
                  <div className="mt-2 text-sm text-red-500">Your available balance is not enough for this mining plan.</div>
                )}
              </div>

              {paymentMethod === "mpesa" && (
                <div className="rounded-xl border border-primary/40 bg-primary/5 p-4 text-sm">
                  After confirming the selected plan, you will be redirected to the M-Pesa deposit flow and the investment will start after approval.
                </div>
              )}

              {paymentMethod === "balance" && (
                <div className="rounded-xl border border-primary/25 bg-primary/10 p-4 text-sm text-primary">
                  Your available balance will be deducted immediately and the investment will start right away at 0% progress.
                </div>
              )}
            </div>

            <button onClick={proceed} disabled={submitDisabled}
              className="mt-4 w-full rounded-md bg-[image:var(--gradient-gold)] px-5 py-3 text-sm font-semibold text-primary-foreground shadow-[var(--shadow-gold)] disabled:opacity-60">
              {loading ? "Processing…" : paymentMethod === "mpesa" ? "Continue to M-Pesa" : "Invest from Available Balance"}
            </button>
            {error && <p className="mt-3 text-sm text-red-500">{error}</p>}
          </div>
        </div>
      )}

      {confirming && selected && projected && (
        <div className="fixed inset-0 z-50 grid place-items-center bg-black/50 p-4" role="dialog" aria-modal="true" aria-labelledby="confirm-investment-title">
          <div className="w-full max-w-md rounded-2xl border border-border bg-card p-6 shadow-2xl">
            <h2 id="confirm-investment-title" className="text-xl font-bold">Confirm Investment</h2>
            <div className="mt-4 space-y-2 text-sm">
              <Row label="Plan" value={selected.name} />
              <Row label="Investment amount" value={formatInvestmentAmount(amount)} />
              <Row label="Weekly profit" value={fmt(projected.weekly)} />
              <Row label="Daily accrual" value={fmt(projected.daily)} />
              <Row label="Term" value="90 days" />
              <Row label="Principal" value="Locked until maturity" />
            </div>
            <div className="mt-6 flex justify-end gap-2">
              <button type="button" onClick={() => setConfirming(false)} className="rounded-md border border-border px-4 py-2 text-sm font-semibold">Cancel</button>
              <button type="button" onClick={() => void confirmInvestment()} disabled={loading} className="rounded-md bg-[image:var(--gradient-gold)] px-4 py-2 text-sm font-semibold text-primary-foreground disabled:opacity-60">Confirm Investment</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function Row({ label, value, accent }: { label: string; value: string; accent?: boolean }) {
  return (
    <div className="flex items-center justify-between border-b border-border/40 pb-2 last:border-b-0">
      <span className="text-muted-foreground">{label}</span>
      <span className={`font-semibold ${accent ? "text-primary" : ""}`}>{value}</span>
    </div>
  );
}
