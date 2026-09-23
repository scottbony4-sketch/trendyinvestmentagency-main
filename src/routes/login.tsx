import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";

export const Route = createFileRoute("/login")({
  head: () => ({ meta: [{ title: "Log in — TRENDY INVESTMENT AGENCY" }] }),
  component: LoginPage,
});

function LoginPage() {
  const navigate = useNavigate();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    try {
      const { error } = await supabase.auth.signInWithPassword({ email, password });
      if (error) return toast.error(error.message);

      toast.success("Welcome back!");
      await navigate({ to: "/dashboard" });
    } catch (error) {
      console.error("[login] sign-in failed", error);
      toast.error(error instanceof Error ? error.message : "Unable to log in. Please try again.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-[image:var(--gradient-hero)] flex items-center justify-center px-6 py-12">
      <div className="w-full max-w-md rounded-2xl border border-border/60 bg-card p-8 shadow-[var(--shadow-gold)]">
        <Link to="/" className="text-sm text-muted-foreground hover:text-foreground">← Back</Link>
        <h1 className="mt-4 text-2xl font-bold">Log in</h1>
        <form onSubmit={handleSubmit} className="mt-6 space-y-4">
          <label className="block">
            <span className="text-sm font-medium">Email</span>
            <input type="email" required value={email} onChange={(e) => setEmail(e.target.value)} className="mt-1 block w-full rounded-md border border-border bg-background px-3 py-2 text-sm focus:border-primary focus:outline-none" />
          </label>
          <label className="block">
            <span className="text-sm font-medium">Password</span>
            <input type="password" required value={password} onChange={(e) => setPassword(e.target.value)} className="mt-1 block w-full rounded-md border border-border bg-background px-3 py-2 text-sm focus:border-primary focus:outline-none" />
          </label>
          <button disabled={loading} className="w-full rounded-md bg-[image:var(--gradient-gold)] px-4 py-3 text-sm font-semibold text-primary-foreground shadow-[var(--shadow-gold)] disabled:opacity-60">
            {loading ? "Signing in..." : "Log in"}
          </button>
        </form>
        <p className="mt-6 text-center text-sm text-muted-foreground">
          New here?{" "}
          <Link to="/signup" className="font-semibold text-primary hover:underline">Create an account</Link>
        </p>
        <p className="mt-2 text-center text-sm">
          <Link to="/forgot-password" className="text-muted-foreground hover:text-primary">Forgot password?</Link>
        </p>
      </div>
    </div>
  );
}