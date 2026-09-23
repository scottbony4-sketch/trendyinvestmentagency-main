import { useEffect, useMemo, useState } from "react";
import { Area, AreaChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { Activity, CalendarDays, Mail, Phone, Pickaxe, Timer, UserRound, Zap } from "lucide-react";
import { fmt } from "@/lib/auth";
import { getInvestmentAccrualTimeline, getInvestmentEarningsSnapshot } from "@/lib/investment-accrual-timeline";

const FILTERS = ["24H", "7D", "30D"] as const;
type Filter = typeof FILTERS[number];
type Investment = Record<string, unknown> & { id: string; status: string };
type EarningRow = { investment_id: string; earning_date: string; amount: number; added_to_balance?: boolean };
type UserIdentity = { name: string; phone: string; email: string };
type Props = { investment: Investment; earningRows: EarningRow[]; user?: UserIdentity };

export function MiningEarningsChart({ investment, earningRows, user }: Props) {
  const [filter, setFilter] = useState<Filter>("24H");
  const [now, setNow] = useState(() => new Date());

  useEffect(() => {
    const timer = window.setInterval(() => setNow(new Date()), 60000);
    return () => window.clearInterval(timer);
  }, []);

  const snapshot = useMemo(() => getInvestmentEarningsSnapshot(investment, earningRows, now), [investment, earningRows, now]);
  const chartData = useMemo(() => {
    const points = getInvestmentAccrualTimeline(investment, earningRows, now, filter).map((point) => ({
      ...point,
      label: new Date(point.timestamp).toLocaleDateString(undefined, { month: "short", day: "numeric" }),
    }));
    if (points.length !== 1) return points;
    const first = points[0];
    const baselineTimestamp = new Date(new Date(first.timestamp).getTime() - 86400000).toISOString();
    return [{ ...first, timestamp: baselineTimestamp, label: new Date(baselineTimestamp).toLocaleDateString(undefined, { month: "short", day: "numeric" }), accruedProfit: 0, dailyAccrual: 0 }, first];
  }, [investment, earningRows, now, filter]);

  const amount = Number(investment.plan_amount || investment.principal_amount || 0);
  const duration = Math.max(1, Number(investment.term_days || investment.duration_days || 90));
  const projectedPayout = Number(investment.projected_payout || amount + snapshot.weeklyEarnings * duration / snapshot.cycleDays);
  const dailyPercent = amount > 0 ? (snapshot.dailyAccrual / amount) * 100 : 0;
  const totalProfit = Math.max(0, projectedPayout - amount);
  const totalPercent = amount > 0 ? (totalProfit / amount) * 100 : 0;
  const progress = getProgress(investment, now);
  const planName = String(investment.plan_name || investment.name || "Investment");
  const variant = getPlanVariant(planName, amount);
  const power = variant === "entry" ? "Low (SHA-256)" : variant === "mid" ? "Medium (SHA-256)" : "High (SHA-256)";
  const completed = investment.status === "completed" || investment.status === "matured";

  return (
    <>
      <article className={`rig-tier rig-tier-${variant}`}>
        {user && <div className="mb-0 flex flex-wrap items-center gap-x-4 gap-y-2 rounded-xl border border-white/10 bg-black/15 px-3 py-2 text-xs text-slate-400"><span className="inline-flex items-center gap-1.5 font-semibold text-slate-100"><UserRound className="h-3.5 w-3.5 text-primary" />{user.name}</span><span className="inline-flex items-center gap-1.5"><Phone className="h-3.5 w-3.5" />{user.phone}</span><span className="inline-flex items-center gap-1.5"><Mail className="h-3.5 w-3.5" />{user.email}</span></div>}
        <div className="rig-tier-top">
          <RigVisual variant={variant} />
          <div className="rig-tier-info"><span className="rig-badge">{planName.toUpperCase()} PLAN</span><div className="rig-price">{fmt(amount)}</div></div>
        </div>

        <div className="rig-progress"><div className="rig-progress-label"><span>Mining Progress</span><b>{progress}%</b></div><div className="rig-progress-track"><div className="rig-progress-fill" style={{ width: `${progress}%` }} /></div></div>

        <dl className="rig-stat-rows">
          <PlanMetric icon={Timer} label="Daily Return" value={`${dailyPercent.toFixed(2)}%`} detail={`(${fmt(snapshot.dailyAccrual)})`} />
          <PlanMetric icon={Timer} label={`Total Return (${duration} Days)`} value={`${totalPercent.toFixed(2)}%`} detail={`(${fmt(totalProfit)})`} />
          <PlanMetric icon={CalendarDays} label="Mining Duration" value={`${duration} Days`} />
          <PlanMetric icon={Zap} label="Mining Power" value={power} />
        </dl>

        <div className="rig-mine-button"><Pickaxe /> {completed ? "Mining Completed" : "Mining in Progress"}</div>

        <section className="bottom">
        <div className="panel"><h3><Activity /> Mining Stats</h3><div className="stats-list"><StatLine label="Investment Amount" value={fmt(amount)} /><StatLine label="Total Mined (Today)" value={fmt(snapshot.currentEarnings)} /><StatLine label="Estimated Daily Earnings" value={fmt(snapshot.dailyAccrual)} /><StatLine label="Next Payout" value={fmt(snapshot.nextPayout)} /></div><p className="disclaimer" style={{ marginTop: 16 }}>Values use the investment and daily earnings records stored in your account.</p></div>
        <div className="panel"><div className="panel-head"><h3><Activity /> Live Mining Performance</h3><div className="chart-tabs">{FILTERS.map((value) => <button key={value} type="button" className={`chart-tab ${filter === value ? "active" : ""}`} onClick={() => setFilter(value)}>{value}</button>)}</div></div><div className="h-[230px] min-w-0"><ResponsiveContainer width="100%" height="100%"><AreaChart data={chartData} margin={{ top: 14, right: 10, left: 34, bottom: 26 }}><defs><linearGradient id={`rig-chart-${investment.id}`} x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor="#2fe08a" stopOpacity={0.35} /><stop offset="100%" stopColor="#2fe08a" stopOpacity={0} /></linearGradient></defs><CartesianGrid stroke="rgba(255,255,255,.06)" /><XAxis dataKey="label" tick={{ fill: "#57616f", fontSize: 10 }} axisLine={false} tickLine={false} /><YAxis orientation="left" tick={{ fill: "#57616f", fontSize: 10 }} axisLine={false} tickLine={false} tickFormatter={(value) => `$${Number(value).toFixed(0)}`} width={30} /><Tooltip content={<ChartTooltip />} /><Area type="monotone" dataKey="accruedProfit" stroke="#2fe08a" strokeWidth={2.4} fill={`url(#rig-chart-${investment.id})`} dot={false} /></AreaChart></ResponsiveContainer></div></div>
        </section>
      </article>
    </>
  );
}

function getPlanVariant(name: string, amount: number) {
  const normalized = name.toLowerCase();
  if (normalized.includes("gold") || normalized.includes("premium") || normalized.includes("pro") || amount >= 500) return "pro" as const;
  if (normalized.includes("silver") || normalized.includes("standard") || normalized.includes("growth") || amount >= 250) return "mid" as const;
  return "entry" as const;
}

function RigVisual({ variant }: { variant: "entry" | "mid" | "pro" }) {
  const color = variant === "entry" ? "#2fe08a" : variant === "mid" ? "#3d93ff" : "#f0b429";
  const blades = Array.from({ length: 8 }, (_, index) => {
    const angle = (index * 45 * Math.PI) / 180;
    const x1 = 46 + 8 * Math.cos(angle);
    const y1 = 55 + 8 * Math.sin(angle);
    const x2 = 46 + 22 * Math.cos(angle);
    const y2 = 55 + 22 * Math.sin(angle);
    return <path key={index} d={`M${x1.toFixed(1)} ${y1.toFixed(1)} L${x2.toFixed(1)} ${y2.toFixed(1)}`} stroke={color} strokeWidth="2.6" strokeLinecap="round" opacity=".92" />;
  });

  return (
    <div className="rig-visual" aria-hidden="true">
      <svg className="rig" viewBox="0 0 130 110" xmlns="http://www.w3.org/2000/svg">
        <defs>
          <radialGradient id={`fan-glow-${variant}`} cx="50%" cy="50%" r="50%"><stop offset="45%" stopColor={color} stopOpacity="0" /><stop offset="100%" stopColor={color} stopOpacity=".5" /></radialGradient>
          <linearGradient id={`box-gradient-${variant}`} x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor="#333944" /><stop offset="100%" stopColor="#121419" /></linearGradient>
          <radialGradient id={`coin-gradient-${variant}`} cx="35%" cy="30%" r="75%"><stop offset="0%" stopColor="#ffe9a8" /><stop offset="55%" stopColor="#f0b429" /><stop offset="100%" stopColor="#a97a12" /></radialGradient>
        </defs>
        <rect x="4" y="8" width="122" height="94" rx="11" fill={`url(#box-gradient-${variant})`} stroke={color} strokeWidth="1.5" />
        <rect x="4" y="8" width="7" height="94" rx="3.5" fill={color} />
        <circle cx="26" cy="20" r="2" fill="#454b56" /><circle cx="108" cy="20" r="2" fill="#454b56" /><circle cx="26" cy="94" r="2" fill="#454b56" /><circle cx="108" cy="94" r="2" fill="#454b56" />
        <circle cx="46" cy="55" r="32" fill={`url(#fan-glow-${variant})`} />
        <circle cx="46" cy="55" r="27" stroke={color} strokeWidth="1.8" fill="#0a0c10" /><circle cx="46" cy="55" r="19" stroke={color} strokeWidth="1" opacity=".4" fill="none" />
        <g>{blades}</g>
        <circle cx="46" cy="55" r="5" fill={color} /><circle cx="46" cy="55" r="2" fill="#0a0c10" />
        <circle cx="98" cy="74" r="20" fill={`url(#coin-gradient-${variant})`} stroke="#7a5a0a" strokeWidth="1" />
        <text x="98" y="81.5" fontSize="20" fontWeight="800" fill="#5b3f06" textAnchor="middle" fontFamily="monospace">$</text>
        <rect x="92" y="16" width="26" height="10" rx="2.5" fill={color} opacity=".22" stroke={color} strokeWidth="1" /><rect x="92" y="29" width="26" height="10" rx="2.5" fill={color} opacity=".22" stroke={color} strokeWidth="1" />
      </svg>
    </div>
  );
}

function getProgress(investment: Investment, now: Date) {
  const duration = Math.max(1, Number(investment.term_days || investment.duration_days || 90));
  const daysPaid = Number(investment.days_paid);
  const start = Date.parse(String(investment.start_at || investment.start_date || investment.created_at || ""));
  const end = Date.parse(String(investment.maturity_date || investment.end_at || ""));
  if (investment.status === "completed" || investment.status === "matured") return 100;
  if (Number.isFinite(start) && Number.isFinite(end) && end > start) return Math.min(100, Math.max(0, Math.round(((now.getTime() - start) / (end - start)) * 100)));
  if (Number.isFinite(daysPaid) && daysPaid > 0) return Math.min(100, Math.max(0, Math.round((daysPaid / duration) * 100)));
  return 0;
}

function PlanMetric({ icon: Icon, label, value, detail }: { icon: typeof Timer; label: string; value: string; detail?: string }) {
  return <div className="rig-stat-row"><span className="rig-stat-icon"><Icon /></span><dt className="rig-stat-name">{label}</dt><dd className="rig-stat-value">{value}{detail && <small>{detail}</small>}</dd></div>;
}

function StatLine({ label, value }: { label: string; value: string }) {
  return <div className="stat-line"><span>{label}</span><b>{value}</b></div>;
}

function ChartTooltip({ active, payload }: { active?: boolean; payload?: Array<{ payload: { timestamp: string; dailyAccrual: number; accruedProfit: number } }> }) {
  if (!active || !payload?.[0]) return null;
  const point = payload[0].payload;
  return <div className="rounded-xl border border-emerald-300/20 bg-[#0c2029] p-3 text-xs shadow-xl"><div className="font-semibold text-white">{new Date(point.timestamp).toLocaleDateString()}</div><div className="mt-2 grid gap-1 text-white/65"><span>Daily Accrual <strong className="float-right ml-6 text-emerald-200">{fmt(point.dailyAccrual)}</strong></span><span>Cumulative Profit <strong className="float-right ml-6 text-emerald-200">{fmt(point.accruedProfit)}</strong></span></div></div>;
}
