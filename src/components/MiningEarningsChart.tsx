import { useEffect, useMemo, useState } from "react";
import { Activity, CircleDollarSign, Clock3, Mail, Phone, Radio, UserRound, WalletCards } from "lucide-react";
import { Area, AreaChart, CartesianGrid, ReferenceDot, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { fmt } from "@/lib/auth";
import { formatCountdown, getInvestmentEarningsSnapshot, getInvestmentAccrualTimeline } from "@/lib/investment-accrual-timeline";

const FILTERS = ["24H", "7D", "30D", "90D", "ALL"] as const;
type Filter = typeof FILTERS[number];
type Investment = Record<string, unknown> & { id: string; status: string };
type EarningRow = { investment_id: string; earning_date: string; amount: number; added_to_balance?: boolean };

type UserIdentity = { name: string; phone: string; email: string };
type Props = { investment: Investment; earningRows: EarningRow[]; user?: UserIdentity };

export function MiningEarningsChart({ investment, earningRows, user }: Props) {
  const [filter, setFilter] = useState<Filter>("7D");
  const [now, setNow] = useState(() => new Date());

  useEffect(() => {
    const timer = window.setInterval(() => setNow(new Date()), 60000);
    return () => window.clearInterval(timer);
  }, []);

  const snapshot = useMemo(() => getInvestmentEarningsSnapshot(investment, earningRows, now), [investment, earningRows, now]);
  const chartData = useMemo(() => getInvestmentAccrualTimeline(investment, earningRows, now, filter).map((point) => ({
    ...point,
    label: new Date(point.timestamp).toLocaleDateString(undefined, { month: "short", day: "numeric" }),
  })), [investment, earningRows, now, filter]);
  const statusLabel = snapshot.status === "active" ? "EARNING NOW" : snapshot.status === "matured" ? "INVESTMENT MATURED" : "INACTIVE";
  const statusColor = snapshot.status === "active" ? "text-emerald-300" : snapshot.status === "matured" ? "text-primary" : "text-muted-foreground";

  return (
    <article className="overflow-hidden rounded-xl border border-border bg-card text-foreground shadow-[0_18px_50px_rgba(0,0,0,0.22)]">
      <div className="border-b border-border p-5 sm:p-6">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            {user && (
              <div className="mb-4 rounded-xl border border-primary/20 bg-primary/5 p-3">
                <div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-xs text-muted-foreground">
                  <span className="inline-flex items-center gap-1.5 font-semibold text-foreground"><UserRound className="h-3.5 w-3.5 text-primary" /> {user.name}</span>
                  <span className="inline-flex items-center gap-1.5"><Phone className="h-3.5 w-3.5" /> {user.phone || "No phone number"}</span>
                  <span className="inline-flex items-center gap-1.5"><Mail className="h-3.5 w-3.5" /> {user.email || "No email address"}</span>
                </div>
              </div>
            )}
            <div className="flex items-center gap-2 text-xl font-semibold tracking-tight"><Activity className="h-5 w-5 text-primary" /> Earnings Performance</div>
            <div className={`mt-2 flex items-center gap-2 text-[11px] font-semibold tracking-[0.18em] ${statusColor}`}><span className="h-2 w-2 rounded-full bg-current shadow-[0_0_12px_currentColor]" /> {statusLabel}</div>
          </div>
          <div className="flex items-center gap-2 rounded-md border border-primary/25 bg-primary/10 px-3 py-1.5 text-[10px] font-semibold tracking-[0.16em] text-primary"><Radio className="h-3.5 w-3.5" /> LIVE CALCULATION</div>
        </div>
        <div className="mt-6 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
          <ChartStat label="Current Earnings" value={fmt(snapshot.currentEarnings)} icon={CircleDollarSign} />
          <ChartStat label="Daily Accrual" value={fmt(snapshot.dailyAccrual)} icon={Activity} />
          <ChartStat label="Weekly Earnings" value={fmt(snapshot.weeklyEarnings)} icon={WalletCards} />
          <ChartStat label="Total Accrued" value={fmt(snapshot.totalAccrued)} icon={CircleDollarSign} />
          <ChartStat label="Next Payout" value={fmt(snapshot.nextPayout)} icon={Clock3} />
        </div>
      </div>

      <div className="p-4 sm:p-6">
        <div className="mb-3 flex flex-wrap items-end justify-between gap-3">
          <div><div className="text-xs uppercase tracking-[0.16em] text-emerald-200/60">Cumulative accrued profit · USD</div><div className="mt-1 text-2xl font-semibold tabular-nums text-emerald-200">{fmt(snapshot.totalAccrued)}</div></div>
          <div className="flex items-center gap-3 text-right text-[10px] uppercase tracking-[0.14em] text-white/45"><span className="inline-flex items-center gap-1.5"><span className="h-1.5 w-1.5 rounded-full bg-emerald-300 shadow-[0_0_8px_#6ee7b7]" /> Accrual feed</span><span>{snapshot.timeline.length} points</span></div>
        </div>
        <div className="rounded-xl border border-border bg-[#080B0F] p-2 pt-4 sm:p-3 sm:pt-5" role="img" aria-label={`Cumulative accrued profit chart for ${filter}`}>
          <div className="mb-1 flex items-center justify-between px-2 text-[9px] uppercase tracking-[0.16em] text-slate-500"><span>Profit curve</span><span>Live calculated value</span></div>
          <div className="h-60 min-w-0 sm:h-72">
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={chartData} margin={{ top: 16, right: 4, left: 0, bottom: 0 }}>
              <defs><linearGradient id={`profit-fill-${investment.id}`} x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor="#6ee7b7" stopOpacity={0.28} /><stop offset="100%" stopColor="#6ee7b7" stopOpacity={0} /></linearGradient></defs>
              <CartesianGrid stroke="rgba(100,116,139,0.2)" vertical strokeDasharray="1 5" />
              <XAxis dataKey="label" tick={{ fill: "rgba(148,163,184,0.7)", fontSize: 10 }} axisLine={{ stroke: "rgba(100,116,139,0.35)" }} tickLine={false} minTickGap={24} />
              <YAxis orientation="right" tick={{ fill: "rgba(148,163,184,0.7)", fontSize: 10 }} axisLine={false} tickLine={false} tickFormatter={(value) => `$${Number(value).toFixed(0)}`} width={46} />
              <Tooltip content={<ChartTooltip />} cursor={{ stroke: "rgba(110,231,183,0.65)", strokeDasharray: "4 4" }} />
              <Area type="monotone" dataKey="accruedProfit" stroke="#86efac" strokeWidth={2.5} fill={`url(#profit-fill-${investment.id})`} dot={false} activeDot={{ r: 5, fill: "#ecfdf5", stroke: "#34d399", strokeWidth: 3 }} isAnimationActive animationDuration={700} />
              {chartData.length > 0 && <ReferenceDot x={chartData[chartData.length - 1].label} y={chartData[chartData.length - 1].accruedProfit} r={6} fill="#d1fae5" stroke="#34d399" strokeWidth={3} label={{ value: "EARNING NOW", position: "top", fill: "#a7f3d0", fontSize: 10 }} />}
            </AreaChart>
          </ResponsiveContainer>
          </div>
        </div>
        <div className="mt-4 flex flex-wrap gap-2" role="group" aria-label="Chart time range">
          {FILTERS.map((value) => <button key={value} type="button" aria-pressed={filter === value} onClick={() => setFilter(value)} className={`rounded-lg border px-3 py-2 text-xs font-semibold tracking-wider transition-colors ${filter === value ? "border-primary/40 bg-primary/15 text-primary" : "border-border bg-secondary text-muted-foreground hover:border-primary/30 hover:text-foreground"}`}>{value}</button>)}
        </div>

        <div className="mt-5 grid gap-3 border-t border-slate-700/70 pt-5 sm:grid-cols-3">
          <ChartStat label="Current Cycle" value={`Day ${snapshot.cycleDay} of 7`} compact />
          <ChartStat label="Cycle Earnings" value={`${fmt(snapshot.cycleEarnings)} / ${fmt(snapshot.cycleTotal)}`} compact />
          <ChartStat label="Time Remaining" value={formatCountdown(snapshot.cycleEnd, now)} compact />
        </div>
        <div className="mt-4 rounded-2xl border border-border bg-secondary p-4">
          <div className="flex items-center justify-between text-xs text-white/55"><span>Investment timeline</span><span>{investment.start_at ? new Date(String(investment.start_at)).toLocaleDateString() : "—"} → {investment.maturity_date ? new Date(String(investment.maturity_date)).toLocaleDateString() : "—"}</span></div>
          <div className="mt-4 grid grid-cols-5 items-start gap-2 text-[10px] uppercase tracking-wider text-white/40">
            {["Started", "7", "14", "21", "90 · Maturity"].map((milestone) => <div key={milestone} className="flex flex-col items-center gap-1 text-center"><span className="h-2.5 w-2.5 rounded-full border border-emerald-300/70 bg-emerald-300/20" />{milestone}</div>)}
          </div>
        </div>
      </div>
    </article>
  );
}

function ChartStat({ label, value, icon: Icon, compact = false }: { label: string; value: string; icon?: typeof Activity; compact?: boolean }) {
  return <div className={`rounded-xl border border-border bg-secondary ${compact ? "p-3" : "p-3.5"}`}><div className="flex items-center gap-1.5 text-[10px] uppercase tracking-wider text-muted-foreground">{Icon && <Icon className="h-3.5 w-3.5" />}{label}</div><div className={`${compact ? "mt-1 text-sm" : "mt-2 text-lg"} font-semibold text-foreground`}>{value}</div></div>;
}

function ChartTooltip({ active, payload }: { active?: boolean; payload?: Array<{ payload: { timestamp: string; dailyAccrual: number; accruedProfit: number; cycleDay: number; calculated: boolean } }> }) {
  if (!active || !payload?.[0]) return null;
  const point = payload[0].payload;
  const date = new Date(point.timestamp);
  return <div className="rounded-xl border border-emerald-300/20 bg-[#0c2029] p-3 text-xs shadow-xl"><div className="font-semibold text-white">{date.toLocaleDateString()} · {date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</div><div className="mt-2 grid gap-1 text-white/65"><span>Daily Accrual <strong className="float-right ml-6 text-emerald-200">{fmt(point.dailyAccrual)}</strong></span><span>Cumulative Profit <strong className="float-right ml-6 text-emerald-200">{fmt(point.accruedProfit)}</strong></span><span>Cycle <strong className="float-right ml-6 text-white">Day {point.cycleDay} / 7</strong></span><span className="text-[10px] uppercase tracking-wider text-white/40">{point.calculated ? "Calculated accrual" : "Recorded accrual"}</span></div></div>;
}
