import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { WhatsAppInline } from "@/components/WhatsAppSupport";
import { buildReferralLink, normalizeReferralCode } from "@/lib/referral";
import { getSiteUrl } from "@/lib/site-url";

export const Route = createFileRoute("/signup")({
  head: () => ({ meta: [{ title: "Sign up — TRENDY INVESTMENT AGENCY" }] }),
  validateSearch: (s: Record<string, unknown>): { ref?: string; referral_code?: string } => ({
    ref: typeof s.ref === "string" ? s.ref : undefined,
    referral_code: typeof s.referral_code === "string" ? s.referral_code : undefined,
  }),
  component: SignupPage,
});

function SignupPage() {
  const navigate = useNavigate();
  const { ref, referral_code: referralCodeParam } = Route.useSearch();
  const [form, setForm] = useState({
    full_name: "",
    phone: "",
    email: "",
    password: "",
    referral_code: "",
  });
  const [loading, setLoading] = useState(false);

  const validateReferralCode = async (value: string) => {
    const normalizedCode = normalizeReferralCode(value);
    if (!normalizedCode) return { ok: true, normalizedCode };

    try {
      const { data, error } = await supabase.rpc("validate_referral_code", {
        p_code: normalizedCode,
      });

      if (!error) {
        const profile = Array.isArray(data) ? data[0] : data;
        if (profile?.id) {
          return { ok: true, normalizedCode, referrerId: profile.id };
        }
      } else {
        console.warn("[signup] RPC validation failed; falling back to profile lookup", {
          message: error.message,
          code: error.code,
          normalizedCode,
        });
      }

      const { data: fallbackData, error: fallbackError } = await supabase
        .from("profiles")
        .select("id")
        .eq("referral_code", normalizedCode)
        .is("deleted_at", null)
        .maybeSingle();

      if (fallbackError) {
        console.error("[signup] referral validation query failed", fallbackError);
        return {
          ok: false,
          message: "We couldn't verify the referral code right now. Please try again.",
        };
      }

      if (!fallbackData?.id) {
        return { ok: false, message: "Invalid referral code. Please check the invite code and try again." };
      }

      return { ok: true, normalizedCode, referrerId: fallbackData.id };
    } catch (error) {
      console.error("[signup] referral validation error", error);
      return {
        ok: false,
        message: "We couldn't verify the referral code right now. Please try again.",
      };
    }
  };

  useEffect(() => {
    const initialCode = normalizeReferralCode(referralCodeParam || ref || "");
    if (initialCode) setForm((f) => ({ ...f, referral_code: initialCode }));
  }, [ref, referralCodeParam]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (form.password.length < 6) return toast.error("Password must be at least 6 characters");
    if (!form.full_name.trim()) return toast.error("Enter your full name");
    const normalizedReferralCode = normalizeReferralCode(form.referral_code);
    setLoading(true);

    if (normalizedReferralCode) {
      const validation = await validateReferralCode(normalizedReferralCode);
      if (!validation.ok) {
        setLoading(false);
        return toast.error(validation.message || "We couldn't verify the referral code right now.");
      }
    }

    const { error } = await supabase.auth.signUp({
      email: form.email,
      password: form.password,
      options: {
        emailRedirectTo: getSiteUrl() || undefined,
        data: {
          full_name: form.full_name,
          phone: form.phone,
          ...(normalizedReferralCode ? { referral_code: normalizedReferralCode } : {}),
        },
      },
    });
    setLoading(false);
    if (error) return toast.error(error.message);
    toast.success("Account created! Check your email to confirm, then log in.");
    navigate({ to: "/login" });
  };

  return (
    <div className="min-h-screen bg-[image:var(--gradient-hero)] flex items-center justify-center px-6 py-12">
      <div className="w-full max-w-md rounded-2xl border border-border/60 bg-card p-8 shadow-[var(--shadow-gold)]">
        <Link to="/" className="text-sm text-muted-foreground hover:text-foreground">
          ← Back
        </Link>
        <h1 className="mt-4 text-2xl font-bold">Create your account</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Start mining with TRENDY INVESTMENT AGENCY today.
        </p>
        <form onSubmit={handleSubmit} className="mt-6 space-y-4">
          <Field
            label="Full name"
            value={form.full_name}
            onChange={(v) => setForm({ ...form, full_name: v })}
            required
          />
          <Field
            label="Phone (M-Pesa)"
            value={form.phone}
            onChange={(v) => setForm({ ...form, phone: v })}
            required
            placeholder="07XXXXXXXX"
          />
          <Field
            label="Email"
            type="email"
            value={form.email}
            onChange={(v) => setForm({ ...form, email: v })}
            required
          />
          <Field
            label="Password"
            type="password"
            value={form.password}
            onChange={(v) => setForm({ ...form, password: v })}
            required
          />
          <Field
            label="Referral code (optional)"
            value={form.referral_code}
            onChange={(v) =>
              setForm((prev) => ({ ...prev, referral_code: normalizeReferralCode(v) }))
            }
            placeholder="ABCD1234"
          />
          <div className="rounded-xl border border-primary/20 bg-primary/5 p-3 text-xs text-muted-foreground">
            {form.referral_code
              ? `Your invite code is ${form.referral_code}. You&apos;ll earn rewards when friends join.`
              : "Use a referral code from a friend to start earning rewards."}
          </div>
          <button
            disabled={loading}
            className="w-full rounded-md bg-[image:var(--gradient-gold)] px-4 py-3 text-sm font-semibold text-primary-foreground shadow-[var(--shadow-gold)] disabled:opacity-60"
          >
            {loading ? "Creating..." : "Sign up"}
          </button>
        </form>
        <p className="mt-6 text-center text-sm text-muted-foreground">
          Already have an account?{" "}
          <Link to="/login" className="font-semibold text-primary hover:underline">
            Log in
          </Link>
        </p>
        <div className="mt-4 flex justify-center">
          <WhatsAppInline />
        </div>
      </div>
    </div>
  );
}

function Field({
  label,
  value,
  onChange,
  type = "text",
  required,
  placeholder,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  type?: string;
  required?: boolean;
  placeholder?: string;
}) {
  return (
    <label className="block">
      <span className="text-sm font-medium">{label}</span>
      <input
        type={type}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        required={required}
        placeholder={placeholder}
        className="mt-1 block w-full rounded-md border border-border bg-background px-3 py-2 text-sm focus:border-primary focus:outline-none"
      />
    </label>
  );
}
