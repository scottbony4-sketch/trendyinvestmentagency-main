import { createFileRoute } from "@tanstack/react-router";
import { Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { Banknote, CalendarDays, CheckCircle2, Coins, Cpu, Download, HelpCircle, LockKeyhole, Pickaxe, ShieldCheck, Sparkles, Timer, TrendingUp, WalletCards, Zap } from "lucide-react";
import heroTeam from "@/assets/hero-team.jpg";
import { WhatsAppFab, WhatsAppInline } from "@/components/WhatsAppSupport";
import { supabase } from "@/integrations/supabase/client";
import { fmt } from "@/lib/auth";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "TRENDY INVESTMENT AGENCY — USD investment plans" },
      { name: "description", content: "Choose a fixed Bronze, Silver, or Gold USD investment plan with 20% weekly profit over 90 days." },
      { property: "og:title", content: "TRENDY INVESTMENT AGENCY" },
      { property: "og:description", content: "Fixed USD investment plans with 20% weekly profit and a 90-day term." },
    ],
  }),
  component: Index,
});

type PublicPlan = {
  name: string;
  min_amount: number;
  daily_return_percent: number;
  roi_percent: number;
  duration_days: number;
  color: string | null;
};

const FALLBACK_PLANS: PublicPlan[] = [
  { name: "Bronze", min_amount: 100, daily_return_percent: 20 / 7, roi_percent: 20, duration_days: 90, color: "#CD7F32" },
  { name: "Silver", min_amount: 250, daily_return_percent: 20 / 7, roi_percent: 20, duration_days: 90, color: "#94A3B8" },
  { name: "Gold", min_amount: 500, daily_return_percent: 20 / 7, roi_percent: 20, duration_days: 90, color: "#EAB308" },
];

function Index() {
  return (
    <div className="min-h-screen bg-background text-foreground">
      <Header />
      <Hero />
      <Features />
      <HowItWorks />
      <About />
      <Details />
      <MoreInformation />
      <Plans />
      <FAQ />
      <Footer />
      <WhatsAppFab />
    </div>
  );
}

function Logo() {
  return (
    <div className="flex items-center gap-3">
      <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-[image:var(--gradient-gold)] font-black text-primary-foreground shadow-[var(--shadow-gold)]">T</div>
      <span className="text-sm font-bold tracking-wide sm:text-base">
        TRENDY <span className="text-primary">INVESTMENT AGENCY</span>
      </span>
    </div>
  );
}

function Header() {
  return (
    <header className="sticky top-0 z-40 border-b border-border/40 bg-background/80 backdrop-blur-xl">
      <div className="mx-auto flex max-w-7xl items-center justify-between px-6 py-4">
        <Logo />
        <div className="flex items-center gap-2 sm:gap-3">
          <Link to="/login" className="rounded-md px-3 py-2 text-sm font-medium text-foreground/80 hover:text-foreground">Log in</Link>
          <Link to="/signup" className="rounded-md bg-[image:var(--gradient-gold)] px-4 py-2 text-sm font-semibold text-primary-foreground shadow-[var(--shadow-gold)] transition-transform hover:scale-[1.02]">Sign up</Link>
        </div>
      </div>
    </header>
  );
}

function Hero() {
  return (
    <section className="relative overflow-hidden">
      <div className="absolute inset-0 -z-10 bg-[image:var(--gradient-hero)]" />
      <div className="mx-auto grid max-w-7xl items-center gap-12 px-6 py-20 lg:grid-cols-2 lg:py-28">
        <div>
          <span className="inline-flex items-center gap-2 rounded-full border border-primary/30 bg-primary/10 px-3 py-1 text-xs font-medium text-primary">
            <Sparkles className="h-3.5 w-3.5" /> Fixed USD plans · 90-day term
          </span>
          <h1 className="mt-6 text-5xl font-bold leading-[1.05] tracking-tight sm:text-6xl">
            Invest in USD.<br />
            <span className="bg-[image:var(--gradient-gold)] bg-clip-text text-transparent">Grow with clarity.</span>
          </h1>
          <p className="mt-6 max-w-lg text-base text-muted-foreground sm:text-lg">
            Choose one fixed USD plan, earn 20% of your original principal every 7 calendar days, and unlock your principal at the end of the 90-day term.
          </p>
          <div className="mt-8 flex flex-wrap items-center gap-3">
            <Link to="/signup" className="inline-flex items-center justify-center rounded-md bg-[image:var(--gradient-gold)] px-6 py-3 text-sm font-semibold text-primary-foreground shadow-[var(--shadow-gold)] transition-transform hover:scale-[1.03]">Get started</Link>
            <a href="#plans" className="inline-flex items-center justify-center rounded-md border border-border bg-card px-6 py-3 text-sm font-semibold text-foreground hover:bg-secondary">View plans</a>
            <WhatsAppInline />
          </div>
        </div>
        <div className="relative">
          <div className="absolute -inset-4 -z-10 rounded-3xl bg-[image:var(--gradient-gold)] opacity-20 blur-3xl" />
          <img src={heroTeam} alt="TRENDY INVESTMENT AGENCY team" width={1280} height={1024}
            className="w-full rounded-2xl border border-border/60 shadow-[var(--shadow-gold)]" />
        </div>
      </div>
    </section>
  );
}

function Features() {
  const items = [
    { icon: Coins, title: "Three fixed USD plans", body: "Choose Bronze at $100, Silver at $250, or Gold at $500. Deposits cannot be lower or higher than the selected plan." },
    { icon: TrendingUp, title: "20% weekly profit", body: "Profit is calculated from your original principal every 7 calendar days, without compounding." },
    { icon: ShieldCheck, title: "Locked principal", body: "Your principal remains locked for 90 days, then becomes available for withdrawal or explicit reinvestment." },
  ];
  return (
    <section className="mx-auto max-w-7xl px-6 pb-20">
      <div className="grid gap-6 md:grid-cols-3">
        {items.map(({ icon: Icon, title, body }) => (
          <div key={title} className="rounded-2xl border border-border/60 bg-card p-6 transition-colors hover:border-primary/40">
            <Icon className="h-7 w-7 text-primary" />
            <h3 className="mt-5 text-lg font-semibold">{title}</h3>
            <p className="mt-2 text-sm text-muted-foreground">{body}</p>
          </div>
        ))}
      </div>
    </section>
  );
}

function HowItWorks() {
  const steps = [
    { number: "01", title: "Choose a plan", body: "Select Bronze, Silver, or Gold. Each plan has one fixed USD deposit amount and a 90-day term." },
    { number: "02", title: "Fund your account", body: "Complete your deposit through the instructions shown in your account, then wait for approval." },
    { number: "03", title: "Track daily accrual", body: "Your weekly profit is calculated from the original principal and displayed as daily accrual in your dashboard." },
    { number: "04", title: "Reach maturity", body: "After 90 calendar days, your original principal becomes available for withdrawal or explicit reinvestment." },
  ];

  return (
    <section className="border-y border-border/50 bg-card/30">
      <div className="mx-auto max-w-7xl px-6 py-20">
        <div className="max-w-2xl">
          <p className="text-sm font-semibold uppercase tracking-[0.2em] text-primary">A clear four-step process</p>
          <h2 className="mt-3 text-3xl font-bold tracking-tight sm:text-4xl">How your investment works</h2>
          <p className="mt-4 text-muted-foreground">Everything is organized around a fixed plan, a transparent accrual schedule, and a defined maturity date.</p>
        </div>
        <div className="mt-12 grid gap-6 md:grid-cols-4">
          {steps.map((step) => (
            <div key={step.number} className="border-l-2 border-primary/50 pl-5">
              <span className="text-sm font-bold text-primary">{step.number}</span>
              <h3 className="mt-4 text-lg font-semibold">{step.title}</h3>
              <p className="mt-2 text-sm leading-6 text-muted-foreground">{step.body}</p>
            </div>
          ))}
        </div>
        <div className="mt-12 grid gap-4 sm:grid-cols-3">
          {[
            { icon: CalendarDays, title: "90 calendar days", body: "Your maturity date is based on the date your investment is activated." },
            { icon: TrendingUp, title: "No compounding", body: "Weekly profit is always based on your original principal, not accumulated profit." },
            { icon: CheckCircle2, title: "Visible status", body: "Follow deposit approval, accruals, maturity, and withdrawal status from your dashboard." },
          ].map(({ icon: Icon, title, body }) => (
            <div key={title} className="flex gap-4 rounded-xl border border-border/60 bg-card p-5">
              <Icon className="mt-0.5 h-5 w-5 shrink-0 text-primary" />
              <div><h3 className="font-semibold">{title}</h3><p className="mt-1 text-sm text-muted-foreground">{body}</p></div>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

function About() {
  return (
    <section className="border-y border-border/50 bg-card/30">
      <div className="mx-auto max-w-4xl px-6 py-20 text-center">
        <h2 className="text-3xl font-bold tracking-tight sm:text-4xl">
          About <span className="text-primary">TRENDY INVESTMENT AGENCY</span>
        </h2>
        <p className="mt-6 text-base text-muted-foreground sm:text-lg">
          TRENDY INVESTMENT AGENCY offers simple USD investment plans with fixed deposits, 20% weekly profit, daily accrual, and a 90-day maturity period. Your original principal is never compounded and is unlocked only when the investment matures.
        </p>
      </div>
    </section>
  );
}

function Plans() {
  const [plans, setPlans] = useState<PublicPlan[]>(FALLBACK_PLANS);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    void supabase
      .from("investment_plans")
      .select("name, min_amount, daily_return_percent, roi_percent, duration_days, color")
      .eq("is_active", true)
      .order("sort_order")
      .then(({ data }) => {
        if (data?.length) setPlans(data as PublicPlan[]);
        setLoading(false);
      });
  }, []);

  return (
    <section id="plans" className="mx-auto max-w-7xl px-6 py-20">
      <div className="text-center">
        <h2 className="text-3xl font-bold tracking-tight sm:text-4xl">Investment plans</h2>
        <p className="mt-3 text-muted-foreground">Fixed USD deposits. 20% weekly profit. 90-day maturity.</p>
      </div>
      <div className="rig-tiers mt-12">
        {loading
          ? plans.map((plan) => <div key={plan.name} className="rig-tier-placeholder" />)
          : plans.map((plan) => {
            const dailyAccrual = plan.min_amount * Number(plan.daily_return_percent) / 100;
            const termProfit = dailyAccrual * Number(plan.duration_days);
            const variant = getPlanVariant(plan.name);
            const progress = variant === "entry" ? 68 : variant === "mid" ? 52 : 37;
            const dailyPercent = Number(plan.daily_return_percent);
            const totalPercent = dailyPercent * Number(plan.duration_days);
            return (
              <article key={plan.name} className={`rig-tier rig-tier-${variant}`}>
                <div className="rig-tier-top">
                  <div className="rig-visual" aria-hidden="true">
                    <Cpu className="rig-machine" />
                    <span className="rig-coin">$</span>
                  </div>
                  <div className="rig-tier-info">
                    <span className="rig-badge">{plan.name.toUpperCase()} PLAN</span>
                    <div className="rig-price">{fmt(plan.min_amount)}</div>
                  </div>
                </div>

                <div className="rig-progress">
                  <div className="rig-progress-label"><span>Mining Progress</span><b>{progress}%</b></div>
                  <div className="rig-progress-track"><div className="rig-progress-fill" style={{ width: `${progress}%` }} /></div>
                </div>

                <dl className="rig-stat-rows">
                  <PlanMetric icon={Timer} label="Daily Return" value={`${dailyPercent.toFixed(2)}%`} detail={`(${fmt(dailyAccrual)})`} />
                  <PlanMetric icon={Timer} label={`Total Profit (${plan.duration_days} Days)`} value={`${totalPercent.toFixed(2)}%`} detail={`(${fmt(termProfit)})`} />
                  <PlanMetric icon={CalendarDays} label="Mining Duration" value={`${plan.duration_days} Days`} />
                  <PlanMetric icon={Zap} label="Mining Power" value={variant === "entry" ? "Low" : variant === "mid" ? "Medium" : "High"} />
                </dl>

                <button type="button" className="rig-mine-button"><Pickaxe /> Mining in Progress</button>
              </article>
            );
          })}
      </div>
      <div className="mt-12 text-center">
        <Link to="/signup" className="inline-flex items-center justify-center rounded-md bg-[image:var(--gradient-gold)] px-8 py-3 text-sm font-semibold text-primary-foreground shadow-[var(--shadow-gold)] transition-transform hover:scale-[1.03]">
          Start mining now
        </Link>
      </div>
    </section>
  );
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

function Details() {
  return (
    <section className="numbers-section border-y border-border/50 bg-card/30">
      <div className="mx-auto grid max-w-7xl gap-12 px-6 py-20 lg:grid-cols-[1.1fr_0.9fr] lg:items-start">
        <div className="numbers-intro">
          <p className="numbers-eyebrow">Read the numbers clearly</p>
          <h2 className="numbers-title">Your plan, explained</h2>
          <p className="numbers-copy">The figures below use simple, non-compounding calculations. Daily accrual is the weekly profit divided by seven, while the 90-day figure is the expected profit across the full term.</p>
          <div className="numbers-grid">
            {[
              ["$100", "$2.86/day", "$257.14 profit"],
              ["$250", "$7.14/day", "$642.86 profit"],
              ["$500", "$14.29/day", "$1,285.71 profit"],
            ].map(([deposit, daily, profit], index) => (
              <div key={deposit} className={`numbers-card numbers-card-${index + 1}`}>
                <span className="numbers-card-label">Plan {String(index + 1).padStart(2, "0")}</span>
                <p className="numbers-deposit">{deposit}</p>
                <p className="numbers-daily">{daily}</p>
                <p className="numbers-profit"><span>90-day profit</span>{profit}</p>
              </div>
            ))}
          </div>
        </div>
        <div className="numbers-guidance">
          <LockKeyhole className="h-7 w-7 text-primary" />
          <h2 className="numbers-guidance-title">Before you get started</h2>
          <ul className="numbers-guidance-list">
            <li><strong className="text-foreground">Have your account ready.</strong> Sign up with accurate details so deposits and withdrawals can be matched to you.</li>
            <li><strong className="text-foreground">Choose one fixed amount.</strong> A plan cannot be funded below or above its listed deposit amount.</li>
            <li><strong className="text-foreground">Plan for the full term.</strong> The principal is locked until the investment reaches its 90-day maturity date.</li>
            <li><strong className="text-foreground">Review before funding.</strong> Understand the plan terms and use only money you can keep committed for the full term.</li>
          </ul>
        </div>
      </div>
    </section>
  );
}

function MoreInformation() {
  const items = [
    { icon: Banknote, eyebrow: "01 · FUNDING", title: "Submit the exact plan amount", body: "Choose Bronze, Silver, or Gold, follow the M-Pesa instructions in your account, and submit the confirmation code and payer details. Your investment starts after approval." },
    { icon: WalletCards, eyebrow: "02 · EARNINGS", title: "Track your accrual clearly", body: "Profit is calculated from your original USD principal. It accrues daily for display, while each full 7-day cycle represents 20% of the original principal without compounding." },
    { icon: LockKeyhole, eyebrow: "03 · MATURITY", title: "Your principal stays locked", body: "The principal remains unavailable until the 90-day maturity date. Eligible earnings and balances are shown separately so you can see what is available." },
    { icon: ShieldCheck, eyebrow: "04 · NEXT STEP", title: "Withdraw or reinvest deliberately", body: "After maturity, request a withdrawal of your available balance or explicitly reinvest it. Withdrawals are available Monday through Saturday and may include the configured fee." },
  ];

  return (
    <section className="information-section border-y border-border/50">
      <div className="mx-auto max-w-7xl px-6 py-20">
        <div className="information-heading">
          <p className="numbers-eyebrow">A little more clarity</p>
          <h2>How the details work</h2>
          <p>Review the practical steps behind funding, earnings, maturity, and your next decision.</p>
        </div>
        <div className="information-grid">
          {items.map(({ icon: Icon, eyebrow, title, body }) => (
            <article key={eyebrow} className="information-card">
              <div className="information-icon"><Icon /></div>
              <p className="information-eyebrow">{eyebrow}</p>
              <h3>{title}</h3>
              <p className="information-body">{body}</p>
            </article>
          ))}
        </div>
      </div>
    </section>
  );
}

function FAQ() {
  const questions = [
    ["Can I deposit a different amount?", "No. Each plan accepts only its listed deposit: $100, $250, or $500."],
    ["When is profit calculated?", "Profit accrues daily for display, with each full 7-calendar-day period representing 20% of the original principal."],
    ["Can I withdraw the principal early?", "The principal remains locked until the investment reaches its 90-day maturity date."],
    ["What happens after maturity?", "You can request a withdrawal of the available balance or explicitly choose to reinvest it from your account."],
  ];

  return (
    <section className="faq-section border-t border-border/50 bg-card/30">
      <div className="mx-auto max-w-4xl px-6 py-20">
        <div className="faq-heading">
          <div className="faq-icon"><HelpCircle /></div>
          <p className="faq-eyebrow">Need to know</p>
          <h2>Common questions</h2>
          <p>The key details to review before choosing a plan.</p>
        </div>
        <div className="faq-list">
          {questions.map(([question, answer], index) => (
            <div key={question} className="faq-item">
              <span className="faq-number">0{index + 1}</span>
              <div>
                <h3>{question}</h3>
                <p>{answer}</p>
              </div>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

function Footer() {
  return (
    <footer className="border-t border-border/50">
      <div className="mx-auto flex max-w-7xl flex-col items-center justify-between gap-4 px-6 py-8 sm:flex-row">
        <Logo />
        <div className="flex flex-col items-center gap-2 sm:items-end">
          <WhatsAppInline label="WhatsApp support" />
          <p className="text-xs text-muted-foreground">© {new Date().getFullYear()} TRENDY INVESTMENT AGENCY. All rights reserved.</p>
        </div>
      </div>
    </footer>
  );
}
