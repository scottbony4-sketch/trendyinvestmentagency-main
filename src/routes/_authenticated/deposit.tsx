import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { PLANS, fmt, fmtKes, USD_TO_KES_RATE } from "@/lib/auth";
import { sendDepositApprovedEmail, sendDepositRejectedEmail, sendDepositSubmittedEmail } from "@/lib/api/email.functions";
import { DataTablePagination } from "@/components/ui/data-table-pagination";

type Search = { amount?: number; plan?: string };
const FIXED_DEPOSIT_AMOUNTS = [100, 250, 500] as const;

export const Route = createFileRoute("/_authenticated/deposit")({
  validateSearch: (s: Record<string, unknown>): Search => ({
    amount: s.amount ? Number(s.amount) : undefined,
    plan: typeof s.plan === "string" ? s.plan : undefined,
  }),
  head: () => ({ meta: [{ title: "Deposit — TRENDY INVESTMENT AGENCY" }] }),
  component: DepositPage,
});

type Deposit = { id: string; user_id: string; amount: number; mpesa_code: string; status: string; created_at: string; admin_note: string | null; plan_id: string | null };
type UserOption = { id: string; full_name: string | null; phone: string | null };
type PlanOption = { id: string; name: string; min_amount: number; max_amount: number | null };

function formatDepositAmount(amount: number | string) {
  const usd = Number(amount || 0);
  return `${fmt(usd)} (${fmtKes(usd * USD_TO_KES_RATE)})`;
}

function DepositPage() {
  const search = Route.useSearch();
  const initialAmount = FIXED_DEPOSIT_AMOUNTS.includes(search.amount as 100 | 250 | 500) ? search.amount! : FIXED_DEPOSIT_AMOUNTS[0];
  const [amount, setAmount] = useState<number>(initialAmount);
  const [code, setCode] = useState("");
  const [phone, setPhone] = useState("");
  const [payerName, setPayerName] = useState("");
  const [loading, setLoading] = useState(false);
  const [isAdmin, setIsAdmin] = useState<boolean | null>(null);
  const [deposits, setDeposits] = useState<Deposit[]>([]);
  const [page, setPage] = useState(1);
  const [rowsPerPage, setRowsPerPage] = useState(5);
  const [users, setUsers] = useState<UserOption[]>([]);
  const [adminPlans, setAdminPlans] = useState<PlanOption[]>([]);

  const refresh = async () => {
    const { data } = await supabase.from("deposits").select("*").order("created_at", { ascending: false }).limit(20);
    if (data) setDeposits(data as Deposit[]);
  };
  useEffect(() => { void refresh(); }, []);
  useEffect(() => {
    void (async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) { setIsAdmin(false); return; }
      const { data } = await supabase.from("user_roles").select("role").eq("user_id", user.id).eq("role", "admin").maybeSingle();
      const admin = Boolean(data);
      setIsAdmin(admin);
      if (admin) {
        void refresh();
        const [usersResult, plansResult] = await Promise.all([
          supabase.from("profiles").select("id, full_name, phone").order("created_at", { ascending: false }),
          supabase.from("investment_plans").select("id, name, min_amount, max_amount").eq("is_active", true).order("sort_order"),
        ]);
        if (usersResult.data) setUsers(usersResult.data as UserOption[]);
        if (plansResult.data) setAdminPlans(plansResult.data as PlanOption[]);
      }
    })();
  }, []);

  const totalPages = Math.max(1, Math.ceil(deposits.length / rowsPerPage));
  const safePage = Math.min(page, totalPages);
  const visibleDeposits = useMemo(() => deposits.slice((safePage - 1) * rowsPerPage, safePage * rowsPerPage), [deposits, safePage, rowsPerPage]);

  useEffect(() => {
    setPage(1);
  }, [rowsPerPage]);

  useEffect(() => {
    if (page > totalPages) setPage(totalPages);
  }, [page, totalPages]);

  if (isAdmin) {
    return (
      <AdminDepositsView deposits={deposits} users={users} plans={adminPlans} onRefresh={refresh} />
    );
  }

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!FIXED_DEPOSIT_AMOUNTS.includes(amount as 100 | 250 | 500)) {
      return toast.error("Choose a fixed plan amount: $100, $250, or $500.");
    }
    if (!code.trim()) return toast.error("Enter the M-Pesa confirmation code");
    if (!phone.trim()) return toast.error("Enter the M-Pesa phone number used to pay");
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return;
    setLoading(true);
    let planId = search.plan;
    if (!planId) {
      const { data: matchingPlan, error: planError } = await supabase
        .from("investment_plans")
        .select("id")
        .eq("is_active", true)
        .eq("min_amount", amount)
        .eq("max_amount", amount)
        .maybeSingle();
      if (planError || !matchingPlan) {
        setLoading(false);
        return toast.error("The selected USD plan is not available.");
      }
      planId = matchingPlan.id;
    }
    const { data: inserted, error } = await supabase.from("deposits").insert({
      user_id: user.id, amount, mpesa_code: code.trim().toUpperCase(), status: "pending",
      plan_id: planId,
      mpesa_phone: phone.trim(),
      payer_name: payerName.trim() || undefined,
    }).select("id").single();
    setLoading(false);
    if (error) return toast.error(error.message);
    if (inserted?.id) void sendDepositSubmittedEmail({ data: { depositId: inserted.id } }).catch(() => {});
    toast.success("Waiting for approval");
    setCode("");
    void refresh();
  };

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-2xl font-bold">Make a deposit</h1>
        <p className="mt-1 text-sm text-muted-foreground">Deposit in USD and confirm your investment before the 90-day term begins.</p>
      </div>

      <div className="card rounded-2xl border-primary/30 bg-primary/5 p-6 text-sm">
        <div className="font-semibold text-primary">M-Pesa payment instructions</div>
        <ol className="mt-3 list-decimal space-y-1 pl-5 text-foreground/90">
          <li>Go to Lipa na M-Pesa → Buy Goods</li>
          <li>M-Pesa Till Number: <span className="font-mono font-bold">4970892</span></li>
          <li>Send exactly the selected plan amount in Kenyan shillings ({formatDepositAmount(amount)}), then enter your M-Pesa transaction code.</li>
        </ol>
      </div>

      <form onSubmit={submit} className="card space-y-5 rounded-2xl p-6">
        <div>
          <label className="text-sm font-medium">Amount (USD / KES)</label>
          <div className="mt-2 grid min-w-0 grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3">
            {PLANS.map(p => (
              <button type="button" key={p} onClick={() => setAmount(p)}
                className={`min-w-0 rounded-md border px-2 py-2 text-center text-sm leading-5 font-medium whitespace-normal break-words transition-colors ${amount === p ? "border-primary bg-primary/15 text-primary" : "border-border hover:border-primary/40"}`}>
                {formatDepositAmount(p)}
              </button>
            ))}
          </div>
        </div>
        <div>
          <label className="text-sm font-medium">M-Pesa confirmation code</label>
          <input value={code} onChange={(e) => setCode(e.target.value)} placeholder="e.g. SJK4X2P9LM" required
            className="mt-2 block w-full rounded-md border border-border bg-background px-3 py-2 font-mono text-sm focus:border-primary focus:outline-none" />
        </div>
        <div>
          <label className="text-sm font-medium">M-Pesa phone number</label>
          <input value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="e.g. 2547XXXXXXXX" required
            className="mt-2 block w-full rounded-md border border-border bg-background px-3 py-2 text-sm focus:border-primary focus:outline-none" />
        </div>
        <div>
          <label className="text-sm font-medium">Payer name (optional)</label>
          <input value={payerName} onChange={(e) => setPayerName(e.target.value)} placeholder="Name on M-Pesa receipt" 
            className="mt-2 block w-full rounded-md border border-border bg-background px-3 py-2 text-sm focus:border-primary focus:outline-none" />
        </div>
        <button disabled={loading} className="rounded-md bg-[image:var(--gradient-gold)] px-5 py-2.5 text-sm font-semibold text-primary-foreground shadow-[var(--shadow-gold)] disabled:opacity-60">
          {loading ? "Submitting…" : `Submit deposit of ${formatDepositAmount(amount)}`}
        </button>
      </form>

      <section>
        <h2 className="text-lg font-semibold">My deposits</h2>
        {deposits.length === 0 ? (
          <p className="mt-3 text-sm text-muted-foreground">No deposits yet.</p>
        ) : (
          <div className="mt-4 overflow-hidden rounded-2xl border border-border/60 bg-card">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-secondary/40 text-left text-xs uppercase tracking-wide text-muted-foreground">
                  <tr><th className="px-4 py-3">Date</th><th className="px-4 py-3">Amount</th><th className="px-4 py-3">M-Pesa code</th><th className="px-4 py-3">Status</th></tr>
                </thead>
                <tbody>
                  {visibleDeposits.map(d => (
                    <tr key={d.id} className="border-t border-border/40">
                      <td className="px-4 py-3 text-muted-foreground">{new Date(d.created_at).toLocaleDateString()}</td>
                      <td className="px-4 py-3 font-medium">{formatDepositAmount(d.amount)}</td>
                      <td className="px-4 py-3 font-mono">{d.mpesa_code}</td>
                      <td className="px-4 py-3"><StatusBadge status={d.status} /></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <DataTablePagination
              page={safePage}
              totalPages={totalPages}
              rowsPerPage={rowsPerPage}
              onPageChange={setPage}
              onRowsPerPageChange={setRowsPerPage}
              totalItems={deposits.length}
              startIndex={(safePage - 1) * rowsPerPage}
              endIndex={Math.min(safePage * rowsPerPage, deposits.length)}
            />
          </div>
        )}
      </section>
    </div>
  );
}

function AdminDepositsView({ deposits, users, plans, onRefresh }: { deposits: Deposit[]; users: UserOption[]; plans: PlanOption[]; onRefresh: () => Promise<void> }) {
  const [page, setPage] = useState(1);
  const [rowsPerPage, setRowsPerPage] = useState(10);
  const [userId, setUserId] = useState("");
  const [planId, setPlanId] = useState("");
  const [loading, setLoading] = useState(false);
  const totalPages = Math.max(1, Math.ceil(deposits.length / rowsPerPage));
  const safePage = Math.min(page, totalPages);
  const visibleDeposits = deposits.slice((safePage - 1) * rowsPerPage, safePage * rowsPerPage);
  const selectedPlan = plans.find(plan => plan.id === planId);

  const updateDeposit = async (id: string, status: "approved" | "rejected") => {
    setLoading(true);
    const { error } = await supabase.from("deposits").update({ status }).eq("id", id);
    setLoading(false);
    if (error) return toast.error(error.message);
    toast.success(`Deposit ${status}`);
    if (status === "approved") void sendDepositApprovedEmail({ data: { depositId: id } }).catch(() => {});
    if (status === "rejected") void sendDepositRejectedEmail({ data: { depositId: id } }).catch(() => {});
    await onRefresh();
  };

  const createDeposit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!userId || !selectedPlan) return toast.error("Select a user and investment plan.");
    setLoading(true);
    const { data, error } = await (supabase as any).rpc("admin_create_deposit_for_user", {
      _user_id: userId,
      _plan_id: selectedPlan.id,
      _amount: selectedPlan.min_amount,
    });
    setLoading(false);
    if (error) return toast.error(error.message);
    toast.success("Deposit created and approved for the selected user.");
    if (data) void sendDepositApprovedEmail({ data: { depositId: String(data) } }).catch(() => {});
    setUserId("");
    setPlanId("");
    await onRefresh();
  };

  useEffect(() => {
    if (page > totalPages) setPage(totalPages);
  }, [page, totalPages]);

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-2xl font-bold">Deposit activity</h1>
        <p className="mt-1 text-sm text-muted-foreground">Review member deposits and manage approvals.</p>
      </div>

      <form onSubmit={createDeposit} className="rounded-2xl border border-border/60 bg-card p-6">
        <h2 className="text-lg font-semibold">Deposit for a user</h2>
        <div className="mt-4 grid gap-3 sm:grid-cols-2">
          <select value={userId} onChange={event => setUserId(event.target.value)} className="rounded-md border border-border bg-background px-3 py-2 text-sm">
            <option value="">Select user</option>
            {users.map(user => <option key={user.id} value={user.id}>{user.full_name || user.phone || user.id}</option>)}
          </select>
          <select value={planId} onChange={event => setPlanId(event.target.value)} className="rounded-md border border-border bg-background px-3 py-2 text-sm">
            <option value="">Select investment plan</option>
            {plans.map(plan => <option key={plan.id} value={plan.id}>{plan.name} - {formatDepositAmount(plan.min_amount)}</option>)}
          </select>
        </div>
        <button disabled={loading || !userId || !planId} className="mt-4 rounded-md bg-[image:var(--gradient-gold)] px-5 py-2.5 text-sm font-semibold text-primary-foreground disabled:opacity-60">
          {loading ? "Processing..." : selectedPlan ? `Create approved deposit of ${formatDepositAmount(selectedPlan.min_amount)}` : "Create deposit"}
        </button>
      </form>

      <section className="overflow-hidden rounded-2xl border border-border/60 bg-card">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-secondary/40 text-left text-xs uppercase tracking-wide text-muted-foreground">
              <tr><th className="px-4 py-3">Date</th><th className="px-4 py-3">User</th><th className="px-4 py-3">Amount</th><th className="px-4 py-3">M-Pesa code</th><th className="px-4 py-3">Status</th><th className="px-4 py-3">Actions</th></tr>
            </thead>
            <tbody>
              {visibleDeposits.map(deposit => {
                const user = users.find(item => item.id === deposit.user_id);
                return (
                  <tr key={deposit.id} className="border-t border-border/40">
                    <td className="px-4 py-3 text-muted-foreground">{new Date(deposit.created_at).toLocaleDateString()}</td>
                    <td className="px-4 py-3">{user?.full_name || user?.phone || deposit.user_id}</td>
                    <td className="px-4 py-3 font-medium">{formatDepositAmount(deposit.amount)}</td>
                    <td className="px-4 py-3 font-mono">{deposit.mpesa_code}</td>
                    <td className="px-4 py-3"><StatusBadge status={deposit.status} /></td>
                    <td className="px-4 py-3">
                      {deposit.status === "pending" ? (
                        <div className="flex gap-2">
                          <button disabled={loading} onClick={() => void updateDeposit(deposit.id, "approved")} className="rounded-md bg-emerald-500/15 px-3 py-1 text-xs font-semibold text-emerald-400">Approve</button>
                          <button disabled={loading} onClick={() => void updateDeposit(deposit.id, "rejected")} className="rounded-md bg-red-500/15 px-3 py-1 text-xs font-semibold text-red-400">Reject</button>
                        </div>
                      ) : <span className="text-xs text-muted-foreground">Processed</span>}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <DataTablePagination
          page={safePage}
          totalPages={totalPages}
          rowsPerPage={rowsPerPage}
          onPageChange={setPage}
          onRowsPerPageChange={value => { setRowsPerPage(value); setPage(1); }}
          totalItems={deposits.length}
          startIndex={deposits.length ? (safePage - 1) * rowsPerPage : 0}
          endIndex={Math.min(safePage * rowsPerPage, deposits.length)}
        />
      </section>
    </div>
  );
}

function StatusBadge({ status }: { status: string }) {
  const cls = status === "approved" ? "bg-emerald-500/15 text-emerald-400"
    : status === "rejected" ? "bg-red-500/15 text-red-400"
    : "bg-yellow-500/15 text-yellow-400";
  return <span className={`inline-flex rounded-full px-2 py-0.5 text-xs font-medium ${cls}`}>{status}</span>;
}