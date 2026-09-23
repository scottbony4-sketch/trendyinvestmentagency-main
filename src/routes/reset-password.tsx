import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";

export const Route = createFileRoute("/reset-password")({
  head: () => ({ meta: [{ title: "Set new password — TRENDY INVESTMENT AGENCY" }] }),
  component: ResetPassword,
});

function ResetPassword() {
  const navigate = useNavigate();
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [loading, setLoading] = useState(false);
  const [ready, setReady] = useState(false);
  const [checking, setChecking] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;

    const { data: sub } = supabase.auth.onAuthStateChange((event) => {
      if (!active) return;
      if (event === "PASSWORD_RECOVERY" || event === "SIGNED_IN") {
        setReady(true);
        setChecking(false);
        setError(null);
      }
    });

    supabase.auth.getSession().then(({ data }) => {
      if (!active) return;
      if (data.session) {
        setReady(true);
        setChecking(false);
        setError(null);
        return;
      }

      supabase.auth.getUser().then(({ data: userData, error: userError }) => {
        if (!active) return;
        if (userData.user) {
          setReady(true);
          setChecking(false);
          setError(null);
          return;
        }

        if (userError) {
          setError(userError.message);
        }
        setReady(false);
        setChecking(false);
      });
    });

    return () => {
      active = false;
      sub.subscription.unsubscribe();
    };
  }, []);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (password.length < 6) return toast.error("Password must be at least 6 characters");
    if (password !== confirm) return toast.error("Passwords do not match");
    setLoading(true);
    setError(null);
    const { error } = await supabase.auth.updateUser({ password });
    setLoading(false);
    if (error) {
      setError(error.message);
      toast.error(error.message);
      return;
    }

    toast.success("Password updated. Please log in.");
    await supabase.auth.signOut();
    navigate({ to: "/login" });
  };

  return (
    <div className="min-h-screen bg-[image:var(--gradient-hero)] flex items-center justify-center px-6 py-12">
      <div className="w-full max-w-md rounded-2xl border border-border/60 bg-card p-8 shadow-[var(--shadow-gold)]">
        <Link to="/login" className="text-sm text-muted-foreground hover:text-foreground">← Back to login</Link>
        <h1 className="mt-4 text-2xl font-bold">Set a new password</h1>
        {checking ? (
          <p className="mt-4 text-sm text-muted-foreground">Validating your reset link…</p>
        ) : !ready ? (
          <div className="mt-4 space-y-2 rounded-md border border-red-500/30 bg-red-500/10 p-4 text-sm text-red-400">
            <p>The password reset link is invalid or has expired.</p>
            {error ? <p className="text-xs opacity-80">{error}</p> : null}
            <Link to="/forgot-password" className="font-semibold underline">Request a new reset link</Link>
          </div>
        ) : (
          <form onSubmit={submit} className="mt-6 space-y-4">
            <label className="block">
              <span className="text-sm font-medium">New password</span>
              <input type="password" required minLength={6} value={password} onChange={(e) => setPassword(e.target.value)} className="mt-1 block w-full rounded-md border border-border bg-background px-3 py-2 text-sm focus:border-primary focus:outline-none" />
            </label>
            <label className="block">
              <span className="text-sm font-medium">Confirm password</span>
              <input type="password" required minLength={6} value={confirm} onChange={(e) => setConfirm(e.target.value)} className="mt-1 block w-full rounded-md border border-border bg-background px-3 py-2 text-sm focus:border-primary focus:outline-none" />
            </label>
            <button disabled={loading} className="w-full rounded-md bg-[image:var(--gradient-gold)] px-4 py-3 text-sm font-semibold text-primary-foreground shadow-[var(--shadow-gold)] disabled:opacity-60">
              {loading ? "Updating..." : "Update password"}
            </button>
          </form>
        )}
      </div>
    </div>
  );
}