import { createFileRoute, Link } from "@tanstack/react-router";
import { useState } from "react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { getResetPasswordRedirectUrl } from "@/lib/site-url";

export const Route = createFileRoute("/forgot-password")({
  head: () => ({ meta: [{ title: "Reset password — TRENDY INVESTMENT AGENCY" }] }),
  component: ForgotPassword,
});

function ForgotPassword() {
  const [email, setEmail] = useState("");
  const [loading, setLoading] = useState(false);
  const [sent, setSent] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    const { error } = await supabase.auth.resetPasswordForEmail(email, {
      redirectTo: getResetPasswordRedirectUrl(),
    });
    setLoading(false);
    if (error) return toast.error(error.message);
    setSent(true);
    toast.success("Check your email for the reset link.");
  };

  return (
    <div className="min-h-screen bg-[image:var(--gradient-hero)] flex items-center justify-center px-6 py-12">
      <div className="w-full max-w-md rounded-2xl border border-border/60 bg-card p-8 shadow-[var(--shadow-gold)]">
        <Link to="/login" className="text-sm text-muted-foreground hover:text-foreground">← Back to login</Link>
        <h1 className="mt-4 text-2xl font-bold">Forgot your password?</h1>
        <p className="mt-2 text-sm text-muted-foreground">Enter your email and we'll send you a reset link.</p>
        {sent ? (
          <div className="mt-6 rounded-md bg-emerald-500/15 p-4 text-sm text-emerald-400">
            If an account exists for <strong>{email}</strong>, a reset link has been sent.
          </div>
        ) : (
          <form onSubmit={submit} className="mt-6 space-y-4">
            <label className="block">
              <span className="text-sm font-medium">Email</span>
              <input type="email" required value={email} onChange={(e) => setEmail(e.target.value)} className="mt-1 block w-full rounded-md border border-border bg-background px-3 py-2 text-sm focus:border-primary focus:outline-none" />
            </label>
            <button disabled={loading} className="w-full rounded-md bg-[image:var(--gradient-gold)] px-4 py-3 text-sm font-semibold text-primary-foreground shadow-[var(--shadow-gold)] disabled:opacity-60">
              {loading ? "Sending..." : "Send reset link"}
            </button>
          </form>
        )}
      </div>
    </div>
  );
}