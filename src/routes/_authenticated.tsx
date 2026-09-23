import { createFileRoute, Outlet, Link, useNavigate, useRouterState } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { LayoutDashboard, ArrowDownToLine, ArrowUpFromLine, Shield, LogOut, Sparkles, TrendingUp, Users, Receipt, User as UserIcon, Bell, Menu, X } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth";

export const Route = createFileRoute("/_authenticated")({
  component: AuthenticatedLayout,
});

function AuthenticatedLayout() {
  const { user, loading } = useAuth();
  const navigate = useNavigate();
  const [isAdmin, setIsAdmin] = useState(false);
  const [unread, setUnread] = useState(0);

  useEffect(() => {
    if (!loading && !user) navigate({ to: "/login" });
  }, [user, loading, navigate]);

  useEffect(() => {
    if (!user) return;
    supabase.from("user_roles").select("role").eq("user_id", user.id).eq("role", "admin").maybeSingle()
      .then(({ data }) => setIsAdmin(!!data));
  }, [user]);

  useEffect(() => {
    if (!user) return;
    const loadUnread = () => {
      supabase.from("notifications").select("id", { count: "exact", head: true })
        .is("read_at", null).eq("user_id", user.id)
        .then(({ count }) => setUnread(count ?? 0));
    };
    loadUnread();
    const ch = supabase.channel(`notif-${user.id}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "notifications", filter: `user_id=eq.${user.id}` }, loadUnread)
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, [user]);

  if (loading || !user) {
    return <div className="min-h-screen flex items-center justify-center bg-background text-muted-foreground">Loading…</div>;
  }

  return (
    <div className="min-h-screen bg-background text-foreground">
      <Nav isAdmin={isAdmin} email={user.email ?? ""} unread={unread} />
    </div>
  );
}

function Nav({ isAdmin, email, unread }: { isAdmin: boolean; email: string; unread: number }) {
  const navigate = useNavigate();
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const [mobileOpen, setMobileOpen] = useState(false);
  const [desktopCollapsed, setDesktopCollapsed] = useState(false);

  const items = [
    { to: "/dashboard", label: "Dashboard", icon: LayoutDashboard },
    { to: "/invest", label: "Invest", icon: Sparkles },
    { to: "/earnings", label: "Earnings", icon: TrendingUp },
    { to: "/deposit", label: "Deposit", icon: ArrowDownToLine },
    { to: "/withdraw", label: "Withdraw", icon: ArrowUpFromLine },
    { to: "/transactions", label: "History", icon: Receipt },
    { to: "/referrals", label: "Referrals", icon: Users },
    { to: "/profile", label: "Profile", icon: UserIcon },
    ...(isAdmin ? [{ to: "/admin", label: "Admin", icon: Shield }] : []),
  ] as const;

  useEffect(() => {
    setMobileOpen(false);
  }, [pathname]);

  const logout = async () => {
    await supabase.auth.signOut();
    navigate({ to: "/" });
  };

  return (
    <div className="flex min-h-screen flex-col lg:flex-row">
      <div
        className={`fixed inset-0 z-30 bg-slate-950/75 backdrop-blur-[2px] transition-opacity duration-200 lg:hidden ${mobileOpen ? "opacity-100" : "pointer-events-none opacity-0"}`}
        onClick={() => setMobileOpen(false)}
        aria-hidden={!mobileOpen}
      />

      <aside
        className={`fixed inset-y-0 left-0 z-40 flex w-[min(88vw,22rem)] max-w-[22rem] flex-col overflow-hidden border-r border-border/60 bg-[linear-gradient(180deg,rgba(15,23,42,0.98),rgba(15,23,42,0.92))] shadow-[12px_0_40px_rgba(2,6,23,0.28)] backdrop-blur-xl transition-all duration-300 ease-in-out supports-[padding:max(0px)]:pb-[env(safe-area-inset-bottom)] lg:sticky lg:top-0 lg:h-screen lg:translate-x-0 ${
          mobileOpen ? "translate-x-0" : "-translate-x-full lg:translate-x-0"
        } ${desktopCollapsed ? "lg:max-w-[88px] lg:w-[88px]" : "lg:max-w-[280px] lg:w-[280px]"}`}
      >
        <div className={`flex items-center justify-between border-b border-border/60 bg-white/[0.03] px-4 py-4 sm:px-5 ${desktopCollapsed ? "lg:px-2" : "lg:px-5"}`}>
          <Link to="/dashboard" className={`flex items-center ${desktopCollapsed ? "lg:justify-center lg:mx-auto" : "gap-3"}`}>
            <div className="flex h-10 w-10 items-center justify-center rounded-lg border border-primary/40 bg-primary/10 text-lg font-black text-primary">T</div>
            {!desktopCollapsed && (
              <div className="flex flex-col">
                <span className="text-[10px] font-semibold uppercase tracking-[0.28em] text-muted-foreground">Agency</span>
                <span className="text-sm font-bold tracking-[0.12em] text-foreground">TRENDY</span>
              </div>
            )}
          </Link>

          <button
            type="button"
            onClick={() => setDesktopCollapsed((value) => !value)}
            className="hidden h-9 w-9 items-center justify-center rounded-lg border border-border/60 bg-slate-900/70 text-muted-foreground hover:text-foreground lg:inline-flex"
            aria-label={desktopCollapsed ? "Expand navigation" : "Collapse navigation"}
          >
            {desktopCollapsed ? <Menu className="h-4 w-4" /> : <X className="h-4 w-4" />}
          </button>

          <button
            type="button"
            onClick={() => setMobileOpen(false)}
            className="inline-flex h-11 w-11 items-center justify-center rounded-xl border border-white/10 bg-white/[0.06] text-muted-foreground transition-colors hover:bg-white/10 hover:text-foreground lg:hidden"
            aria-label="Close navigation"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <nav className={`flex-1 space-y-1 overflow-y-auto px-3 py-5 sm:space-y-2 sm:px-4 ${desktopCollapsed ? "lg:px-2" : "lg:px-3"}`}>
          {items.map(({ to, label, icon: Icon }) => {
            const active = pathname === to;
            return (
              <Link
                key={to}
                to={to}
                onClick={() => setMobileOpen(false)}
                className={`group flex min-h-11 items-center gap-3 rounded-lg border-l-2 border-transparent px-3 py-3 text-sm font-medium transition-all active:scale-[0.99] ${
                  desktopCollapsed ? "justify-center px-2" : ""
                } ${
                  active
                    ? "border-primary bg-primary/10 text-primary"
                    : "text-muted-foreground hover:bg-white/[0.06] hover:text-foreground"
                }`}
                title={desktopCollapsed ? label : undefined}
              >
                <span className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-lg ${active ? "bg-primary/10 text-primary" : "bg-secondary text-muted-foreground group-hover:text-foreground"}`}>
                  <Icon className="h-4 w-4" />
                </span>
                {!desktopCollapsed && <span>{label}</span>}
              </Link>
            );
          })}
        </nav>

        <div className={`border-t border-border/60 bg-white/[0.025] px-3 py-4 sm:px-4 ${desktopCollapsed ? "lg:p-2" : "lg:p-4"}`}>
          {!desktopCollapsed ? (
            <div className="mb-3 flex items-center gap-3 rounded-2xl border border-white/10 bg-slate-900/70 p-3.5">
              <div className="flex h-10 w-10 items-center justify-center rounded-full bg-primary/14 text-sm font-bold text-primary">
                {email.charAt(0).toUpperCase() || "U"}
              </div>
              <div className="min-w-0 flex-1">
                <div className="truncate text-sm font-semibold text-foreground">{email}</div>
                <div className="text-[11px] uppercase tracking-[0.18em] text-muted-foreground">Member</div>
              </div>
            </div>
          ) : (
            <div className="mb-2 flex justify-center">
              <div className="flex h-10 w-10 items-center justify-center rounded-full bg-primary/14 text-sm font-bold text-primary">
                {email.charAt(0).toUpperCase() || "U"}
              </div>
            </div>
          )}

          <div className={`flex items-center ${desktopCollapsed ? "justify-center" : "gap-2"}`}>
            <Link to="/notifications" className={`relative inline-flex items-center justify-center rounded-xl border border-white/10 bg-slate-900/70 text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground ${desktopCollapsed ? "h-10 w-10" : "h-12 w-12"}`}>
              <Bell className="h-4 w-4" />
              {unread > 0 && (
                <span className="absolute -right-1 -top-1 flex h-5 min-w-5 items-center justify-center rounded-full bg-primary px-1 text-[10px] font-bold text-primary-foreground">{unread > 9 ? "9+" : unread}</span>
              )}
            </Link>

            {!desktopCollapsed && (
              <button onClick={logout} className="inline-flex min-h-12 flex-1 items-center justify-center gap-2 rounded-xl border border-white/10 bg-slate-900/70 px-3 py-3 text-sm font-medium text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground">
                <LogOut className="h-4 w-4" />
                Log out
              </button>
            )}
          </div>
        </div>
      </aside>

      <div className="flex min-h-screen flex-1 flex-col">
        <header className="sticky top-0 z-30 border-b border-border bg-[#080B0F]/90 backdrop-blur-xl">
          <div className="flex items-center justify-between px-3 py-3.5 sm:px-6 sm:py-4">
            <div className="flex items-center gap-3">
              <button
                type="button"
                onClick={() => setMobileOpen(true)}
                aria-label="Open navigation"
                className="inline-flex h-11 w-11 items-center justify-center rounded-xl border border-border/60 bg-card text-muted-foreground shadow-sm transition-colors hover:bg-secondary hover:text-foreground lg:hidden"
              >
                <Menu className="h-4 w-4" />
              </button>

              <div>
                <p className="text-[10px] font-semibold uppercase tracking-[0.28em] text-muted-foreground">Portfolio</p>
                <h1 className="mt-1 text-lg font-bold text-foreground sm:text-xl">Overview</h1>
              </div>
            </div>

            <Link to="/notifications" className="relative inline-flex h-10 w-10 items-center justify-center rounded-lg border border-border/50 bg-card text-muted-foreground hover:bg-secondary hover:text-foreground">
              <Bell className="h-4 w-4" />
              {unread > 0 && (
                <span className="absolute -right-1 -top-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-primary px-1 text-[10px] font-bold text-primary-foreground">{unread > 9 ? "9+" : unread}</span>
              )}
            </Link>
          </div>
        </header>

        <main className="mx-auto w-full max-w-6xl min-w-0 px-3 py-5 sm:px-6 sm:py-8 lg:px-8">
          <Outlet />
        </main>
      </div>
    </div>
  );
}