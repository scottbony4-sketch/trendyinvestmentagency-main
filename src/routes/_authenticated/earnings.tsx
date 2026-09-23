import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { ArrowLeft, Sparkles } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { DataTablePagination } from "@/components/ui/data-table-pagination";
import { MiningEarningsChart } from "@/components/MiningEarningsChart";

export const Route = createFileRoute("/_authenticated/earnings")({
  head: () => ({ meta: [{ title: "Investment earnings — TRENDY INVESTMENT AGENCY" }] }),
  component: EarningsPage,
});

type Investment = Record<string, unknown> & { id: string; user_id: string; status: string };
type EarningRow = { id: string; investment_id: string; earning_date: string; amount: number; added_to_balance: boolean; status: string };
type UserIdentity = { name: string; phone: string; email: string };

function EarningsPage() {
  const [investments, setInvestments] = useState<Investment[]>([]);
  const [dailyEarnings, setDailyEarnings] = useState<EarningRow[]>([]);
  const [page, setPage] = useState(1);
  const [rowsPerPage, setRowsPerPage] = useState(3);
  const [loading, setLoading] = useState(true);
  const [users, setUsers] = useState<Record<string, UserIdentity>>({});

  useEffect(() => {
    void Promise.all([
      supabase.from("investments").select("*").order("created_at", { ascending: false }),
      supabase.from("daily_earnings").select("id, investment_id, earning_date, amount, added_to_balance, status").order("earning_date", { ascending: true }),
    ]).then(async ([investmentResult, earningsResult]) => {
      if (investmentResult.data) {
        setInvestments(investmentResult.data as Investment[]);
        const userIds = [...new Set((investmentResult.data as Investment[]).map(investment => investment.user_id))];
        if (userIds.length > 0) {
          const { data: ownerRows, error: ownerError } = await (supabase as any).rpc("get_investment_owner_contacts", { _user_ids: userIds });
          if (ownerError) console.error("Investment owner contacts failed", ownerError);
          if (ownerRows) {
            const ownerMap: Record<string, UserIdentity> = {};
            for (const owner of ownerRows as Array<{ user_id: string; full_name: string | null; phone: string | null; email: string | null }>) {
              ownerMap[owner.user_id] = {
                name: owner.full_name || "Unnamed user",
                phone: owner.phone || "No phone number",
                email: owner.email || "No email address",
              };
            }
            setUsers(ownerMap);
          }
        }
      }
      if (earningsResult.data) setDailyEarnings(earningsResult.data as EarningRow[]);
      setLoading(false);
    });
  }, []);

  const totalPages = Math.max(1, Math.ceil(investments.length / rowsPerPage));
  const safePage = Math.min(page, totalPages);
  const visibleInvestments = useMemo(
    () => investments.slice((safePage - 1) * rowsPerPage, safePage * rowsPerPage),
    [investments, safePage, rowsPerPage],
  );

  useEffect(() => {
    setPage(1);
  }, [rowsPerPage]);

  useEffect(() => {
    if (page > totalPages) setPage(totalPages);
  }, [page, totalPages]);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <Link to="/dashboard" className="mb-3 inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground">
            <ArrowLeft className="h-4 w-4" /> Back to dashboard
          </Link>
          <div className="flex items-center gap-2">
            <Sparkles className="h-5 w-5 text-primary" />
            <h1 className="text-2xl font-bold">Investment earnings</h1>
          </div>
          <p className="mt-1 text-sm text-muted-foreground">Monitor the live earnings performance of every investment cycle.</p>
        </div>
        <Link to="/invest" className="rounded-md bg-primary/15 px-3 py-2 text-sm font-semibold text-primary hover:bg-primary/25">+ Start new cycle</Link>
      </div>

      {loading ? (
        <div className="rounded-2xl border border-border/60 bg-card p-8 text-center text-sm text-muted-foreground">Loading earnings...</div>
      ) : investments.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-border p-12 text-center text-sm text-muted-foreground">No investments yet.</div>
      ) : (
        <div className="space-y-4">
          {visibleInvestments.map((investment) => (
            <MiningEarningsChart key={investment.id} investment={investment} earningRows={dailyEarnings} user={users[investment.user_id]} />
          ))}
          <DataTablePagination
            page={safePage}
            totalPages={totalPages}
            rowsPerPage={rowsPerPage}
            onPageChange={setPage}
            onRowsPerPageChange={setRowsPerPage}
            totalItems={investments.length}
            startIndex={(safePage - 1) * rowsPerPage}
            endIndex={Math.min(safePage * rowsPerPage, investments.length)}
          />
        </div>
      )}
    </div>
  );
}
