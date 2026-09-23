import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { fmt } from "@/lib/auth";
import { Download, Eye, Trash2 } from "lucide-react";
import { DataTablePagination } from "@/components/ui/data-table-pagination";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";

export const Route = createFileRoute("/_authenticated/transactions")({
  head: () => ({ meta: [{ title: "Transactions — TRENDY INVESTMENT AGENCY" }] }),
  component: TxPage,
});

type Tx = { id: string; type: string; amount: number; status: string; reference: string | null; description: string; created_at: string };
const TYPES = ["all", "deposit", "withdrawal", "investment", "daily_earning", "claim", "referral", "admin_adjust"];

function TxPage() {
  const [rows, setRows] = useState<Tx[]>([]);
  const [type, setType] = useState("all");
  const [q, setQ] = useState("");
  const [page, setPage] = useState(1);
  const [rowsPerPage, setRowsPerPage] = useState(10);
  const [selectedTransaction, setSelectedTransaction] = useState<Tx | null>(null);
  const [deletingTransactionId, setDeletingTransactionId] = useState<string | null>(null);

  useEffect(() => {
    supabase.from("transactions").select("*").order("created_at", { ascending: false }).limit(500)
      .then(({ data }) => { if (data) setRows(data as Tx[]); });
  }, []);

  const filtered = useMemo(() => rows.filter(r =>
    (type === "all" || r.type === type) &&
    (!q || r.description.toLowerCase().includes(q.toLowerCase()) || (r.reference ?? "").toLowerCase().includes(q.toLowerCase()))
  ), [rows, type, q]);

  const totalPages = Math.max(1, Math.ceil(filtered.length / rowsPerPage));
  const safePage = Math.min(page, totalPages);
  const visibleRows = filtered.slice((safePage - 1) * rowsPerPage, safePage * rowsPerPage);

  useEffect(() => {
    setPage(1);
  }, [type, q, rowsPerPage]);

  useEffect(() => {
    if (page > totalPages) setPage(totalPages);
  }, [page, totalPages]);

  const deleteTransaction = async (transaction: Tx) => {
    if (!window.confirm("Delete this transaction from your activity history?")) return;
    setDeletingTransactionId(transaction.id);
    const { error } = await (supabase as any).rpc("delete_transaction", { p_transaction_id: transaction.id });
    if (error) {
      console.error("Transaction deletion failed", error);
      window.alert(error.message || "Unable to delete this transaction.");
    } else {
      setRows(current => current.filter(row => row.id !== transaction.id));
      if (selectedTransaction?.id === transaction.id) setSelectedTransaction(null);
    }
    setDeletingTransactionId(null);
  };

  const exportCsv = () => {
    const header = "Date,Type,Amount,Status,Reference,Description\n";
    const body = filtered.map(r => [new Date(r.created_at).toISOString(), r.type, r.amount, r.status, r.reference ?? "", r.description.replace(/,/g, ";")].join(",")).join("\n");
    const blob = new Blob([header + body], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a"); a.href = url; a.download = `transactions-${Date.now()}.csv`; a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold">Transactions</h1>
          <p className="mt-1 text-sm text-muted-foreground">Complete history of your account activity.</p>
        </div>
        <button onClick={exportCsv} className="inline-flex items-center gap-1.5 rounded-md border border-border px-3 py-1.5 text-sm hover:bg-secondary">
          <Download className="h-4 w-4" /> Export CSV
        </button>
      </div>

      <div className="flex flex-wrap items-center gap-2 rounded-2xl border border-border/60 bg-card/70 p-3">
        {TYPES.map(t => (
          <button key={t} onClick={() => setType(t)} className={`rounded-md px-3 py-1.5 text-xs font-medium capitalize ${type === t ? "bg-primary/15 text-primary" : "bg-secondary text-muted-foreground hover:text-foreground"}`}>{t}</button>
        ))}
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search reference or description" className="ml-auto min-w-[220px] rounded-md border border-border bg-background px-3 py-1.5 text-sm focus:border-primary focus:outline-none" />
      </div>

      <div className="overflow-hidden rounded-2xl border border-border/60 bg-card">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-secondary/40 text-left text-xs uppercase tracking-wide text-muted-foreground">
              <tr><th className="px-4 py-3">Date</th><th className="px-4 py-3">Type</th><th className="px-4 py-3">Description</th><th className="px-4 py-3">Reference</th><th className="px-4 py-3">Amount</th><th className="px-4 py-3">Status</th><th className="px-4 py-3 text-right">Actions</th></tr>
            </thead>
            <tbody>
              {visibleRows.length === 0 && <tr><td colSpan={7} className="px-4 py-8 text-center text-muted-foreground">No transactions</td></tr>}
              {visibleRows.map(r => (
                <tr key={r.id} className="border-t border-border/40 transition-colors hover:bg-secondary/20">
                  <td className="px-4 py-3 text-muted-foreground">{new Date(r.created_at).toLocaleString()}</td>
                  <td className="px-4 py-3 font-medium capitalize">{r.type.replace("_", " ")}</td>
                  <td className="max-w-[260px] px-4 py-3">{r.description}</td>
                  <td className="px-4 py-3 font-mono text-xs text-muted-foreground">{r.reference || "—"}</td>
                  <td className={`px-4 py-3 font-bold ${r.type === "withdrawal" ? "text-red-400" : "text-emerald-400"}`}>{r.type === "withdrawal" ? "−" : "+"}{fmt(r.amount)}</td>
                  <td className="px-4 py-3 capitalize"><span className={`rounded-full px-2 py-0.5 text-xs font-medium ${r.status === "completed" || r.status === "approved" ? "bg-emerald-500/10 text-emerald-400" : r.status === "rejected" ? "bg-red-500/10 text-red-400" : "bg-amber-500/10 text-amber-400"}`}>{r.status}</span></td>
                  <td className="px-4 py-3">
                    <div className="flex justify-end gap-1">
                      <button type="button" onClick={() => setSelectedTransaction(r)} className="inline-flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-xs font-semibold text-muted-foreground hover:bg-secondary hover:text-foreground" aria-label={`View ${r.description}`}>
                        <Eye className="h-3.5 w-3.5" /> View
                      </button>
                      <button type="button" onClick={() => void deleteTransaction(r)} disabled={deletingTransactionId === r.id} className="inline-flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-xs font-semibold text-red-400 hover:bg-red-500/10 disabled:cursor-not-allowed disabled:opacity-50" aria-label={`Delete ${r.description}`}>
                        <Trash2 className="h-3.5 w-3.5" /> {deletingTransactionId === r.id ? "Deleting" : "Delete"}
                      </button>
                    </div>
                  </td>
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
          totalItems={filtered.length}
          startIndex={(safePage - 1) * rowsPerPage}
          endIndex={Math.min(safePage * rowsPerPage, filtered.length)}
        />
      </div>

      <Dialog open={Boolean(selectedTransaction)} onOpenChange={(open) => { if (!open) setSelectedTransaction(null); }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Transaction details</DialogTitle>
            <DialogDescription>Review the activity recorded on your account.</DialogDescription>
          </DialogHeader>
          {selectedTransaction && (
            <dl className="grid gap-3 rounded-xl border border-border/60 bg-secondary/20 p-4 text-sm sm:grid-cols-2">
              <div><dt className="text-xs text-muted-foreground">Type</dt><dd className="mt-1 font-medium capitalize">{selectedTransaction.type.replace("_", " ")}</dd></div>
              <div><dt className="text-xs text-muted-foreground">Amount</dt><dd className="mt-1 font-semibold">{fmt(selectedTransaction.amount)}</dd></div>
              <div><dt className="text-xs text-muted-foreground">Status</dt><dd className="mt-1 capitalize">{selectedTransaction.status}</dd></div>
              <div><dt className="text-xs text-muted-foreground">Date</dt><dd className="mt-1">{new Date(selectedTransaction.created_at).toLocaleString()}</dd></div>
              <div className="sm:col-span-2"><dt className="text-xs text-muted-foreground">Description</dt><dd className="mt-1">{selectedTransaction.description}</dd></div>
              {selectedTransaction.reference && <div className="sm:col-span-2"><dt className="text-xs text-muted-foreground">Reference</dt><dd className="mt-1 font-mono text-xs">{selectedTransaction.reference}</dd></div>}
            </dl>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}