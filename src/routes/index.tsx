import { createFileRoute } from "@tanstack/react-router";
import { Link } from "@tanstack/react-router";
import { CalendarDays, CheckCircle2, Coins, Download, HelpCircle, LockKeyhole, ShieldCheck, Sparkles, TrendingUp } from "lucide-react";
import heroTeam from "@/assets/hero-team.jpg";
import { WhatsAppFab, WhatsAppInline } from "@/components/WhatsAppSupport";
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

const PLANS = [
  { name: "Bronze", amount: 100, daily: 20 / 7, weekly: 20, profit: 257.14, color: "#CD7F32" },
  { name: "Silver", amount: 250, daily: 50 / 7, weekly: 50, profit: 642.86, color: "#94A3B8" },
  { name: "Gold", amount: 500, daily: 100 / 7, weekly: 100, profit: 1285.71, color: "#EAB308" },
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
  return (
    <section id="plans" className="mx-auto max-w-7xl px-6 py-20">
      <div className="text-center">
        <h2 className="text-3xl font-bold tracking-tight sm:text-4xl">Investment plans</h2>
        <p className="mt-3 text-muted-foreground">Fixed USD deposits. 20% weekly profit. 90-day maturity.</p>
      </div>
      <div className="mt-12 overflow-x-auto rounded-2xl border border-border/60 bg-card">
        <table className="w-full text-sm">
          <thead className="bg-secondary/40 text-left text-xs uppercase tracking-wide text-muted-foreground">
            <tr><th className="px-4 py-3">Plan</th><th className="px-4 py-3">Deposit</th><th className="px-4 py-3">Daily accrual</th><th className="px-4 py-3">Weekly profit</th><th className="px-4 py-3">90-day profit</th></tr>
          </thead>
          <tbody>
            {PLANS.map(p => (
              <tr key={p.name} className="border-t border-border/40">
                <td className="px-4 py-4 font-semibold" style={{ color: p.color }}>{p.name}</td>
                <td className="px-4 py-4 font-semibold">{fmt(p.amount)}</td>
                <td className="px-4 py-4 text-primary">{fmt(p.daily)}</td>
                <td className="px-4 py-4 text-primary">{fmt(p.weekly)}</td>
                <td className="px-4 py-4 text-primary">{fmt(p.profit)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="mt-12 text-center">
        <Link to="/signup" className="inline-flex items-center justify-center rounded-md bg-[image:var(--gradient-gold)] px-8 py-3 text-sm font-semibold text-primary-foreground shadow-[var(--shadow-gold)] transition-transform hover:scale-[1.03]">
          Start mining now
        </Link>
      </div>
    </section>
  );
}

function Details() {
  return (
    <section className="border-y border-border/50 bg-card/30">
      <div className="mx-auto grid max-w-7xl gap-12 px-6 py-20 lg:grid-cols-[1.1fr_0.9fr] lg:items-start">
        <div>
          <p className="text-sm font-semibold uppercase tracking-[0.2em] text-primary">Read the numbers clearly</p>
          <h2 className="mt-3 text-3xl font-bold tracking-tight sm:text-4xl">Your plan, explained</h2>
          <p className="mt-4 max-w-2xl text-muted-foreground">The figures below use simple, non-compounding calculations. Daily accrual is the weekly profit divided by seven, while the 90-day figure is the expected profit across the full term.</p>
          <div className="mt-8 grid gap-4 sm:grid-cols-3">
            {[
              ["$100", "$2.86/day", "$257.14 profit"],
              ["$250", "$7.14/day", "$642.86 profit"],
              ["$500", "$14.29/day", "$1,285.71 profit"],
            ].map(([deposit, daily, profit]) => (
              <div key={deposit} className="rounded-xl border border-border/60 bg-card p-5">
                <p className="text-2xl font-bold text-primary">{deposit}</p>
                <p className="mt-3 text-sm font-medium">{daily}</p>
                <p className="mt-1 text-xs text-muted-foreground">over 90 days: {profit}</p>
              </div>
            ))}
          </div>
        </div>
        <div className="rounded-2xl border border-primary/20 bg-primary/5 p-6 sm:p-8">
          <LockKeyhole className="h-7 w-7 text-primary" />
          <h2 className="mt-5 text-2xl font-bold">Before you get started</h2>
          <ul className="mt-5 space-y-4 text-sm leading-6 text-muted-foreground">
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

function FAQ() {
  const questions = [
    ["Can I deposit a different amount?", "No. Each plan accepts only its listed deposit: $100, $250, or $500."],
    ["When is profit calculated?", "Profit accrues daily for display, with each full 7-calendar-day period representing 20% of the original principal."],
    ["Can I withdraw the principal early?", "The principal remains locked until the investment reaches its 90-day maturity date."],
    ["What happens after maturity?", "You can request a withdrawal of the available balance or explicitly choose to reinvest it from your account."],
  ];

  return (
    <section className="border-t border-border/50 bg-card/30">
      <div className="mx-auto max-w-4xl px-6 py-20">
        <div className="text-center">
          <HelpCircle className="mx-auto h-8 w-8 text-primary" />
          <h2 className="mt-4 text-3xl font-bold tracking-tight sm:text-4xl">Common questions</h2>
          <p className="mt-3 text-muted-foreground">The key details to review before choosing a plan.</p>
        </div>
        <div className="mt-10 divide-y divide-border/60 rounded-2xl border border-border/60 bg-card px-6">
          {questions.map(([question, answer]) => (
            <div key={question} className="py-5">
              <h3 className="font-semibold">{question}</h3>
              <p className="mt-2 text-sm leading-6 text-muted-foreground">{answer}</p>
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
