import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Bell, Check } from "lucide-react";

export const Route = createFileRoute("/_authenticated/notifications")({
  head: () => ({ meta: [{ title: "Notifications — TRENDY INVESTMENT AGENCY" }] }),
  component: NotifPage,
});

type N = { id: string; type: string; title: string; body: string; link: string | null; read_at: string | null; created_at: string };

function NotifPage() {
  const [rows, setRows] = useState<N[]>([]);
  const load = async () => {
    const { data } = await supabase.from("notifications").select("*").order("created_at", { ascending: false }).limit(100);
    if (data) setRows(data as N[]);
  };
  useEffect(() => { void load(); }, []);

  const markAll = async () => {
    await supabase.from("notifications").update({ read_at: new Date().toISOString() }).is("read_at", null);
    void load();
  };
  const markOne = async (id: string) => {
    await supabase.from("notifications").update({ read_at: new Date().toISOString() }).eq("id", id);
    void load();
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Notifications</h1>
          <p className="mt-1 text-sm text-muted-foreground">Updates on your deposits, withdrawals and earnings.</p>
        </div>
        <button onClick={markAll} className="inline-flex items-center gap-1.5 rounded-md border border-border px-3 py-1.5 text-sm hover:bg-secondary">
          <Check className="h-4 w-4" /> Mark all read
        </button>
      </div>
      {rows.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-border p-12 text-center text-sm text-muted-foreground">
          <Bell className="mx-auto mb-2 h-6 w-6" /> No notifications yet.
        </div>
      ) : (
        <ul className="divide-y divide-border/60 rounded-2xl border border-border/60 bg-card">
          {rows.map(n => (
            <li key={n.id} className={`p-4 ${!n.read_at ? "bg-primary/5" : ""}`}>
              <div className="flex items-start justify-between gap-3">
                <div>
                  <div className="text-sm font-semibold">{n.title}</div>
                  <div className="mt-0.5 text-sm text-muted-foreground">{n.body}</div>
                  <div className="mt-1 text-xs text-muted-foreground">{new Date(n.created_at).toLocaleString()}</div>
                </div>
                {!n.read_at && (
                  <button onClick={() => markOne(n.id)} className="rounded-md border border-border px-2 py-1 text-xs hover:bg-secondary">Mark read</button>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}