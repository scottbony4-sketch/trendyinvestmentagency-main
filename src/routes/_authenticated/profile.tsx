import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";

export const Route = createFileRoute("/_authenticated/profile")({
  head: () => ({ meta: [{ title: "Profile — TRENDY INVESTMENT AGENCY" }] }),
  component: ProfilePage,
});

function ProfilePage() {
  const [form, setForm] = useState({ full_name: "", username: "", phone: "", country: "", address: "" });
  const [email, setEmail] = useState("");
  const [pwd, setPwd] = useState("");
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    (async () => {
      const { data: u } = await supabase.auth.getUser();
      if (!u.user) return;
      setEmail(u.user.email ?? "");
      const { data } = await supabase.from("profiles").select("full_name,username,phone,country,address").eq("id", u.user.id).maybeSingle();
      if (data) setForm({
        full_name: data.full_name ?? "", username: data.username ?? "",
        phone: data.phone ?? "", country: data.country ?? "", address: data.address ?? ""
      });
    })();
  }, []);

  const save = async (e: React.FormEvent) => {
    e.preventDefault(); setLoading(true);
    const { data: u } = await supabase.auth.getUser();
    if (!u.user) return;
    const { error } = await supabase.from("profiles").update(form).eq("id", u.user.id);
    setLoading(false);
    if (error) return toast.error(error.message);
    toast.success("Profile updated");
  };

  const changePwd = async () => {
    if (pwd.length < 6) return toast.error("Password must be at least 6 characters");
    const { error } = await supabase.auth.updateUser({ password: pwd });
    if (error) return toast.error(error.message);
    setPwd(""); toast.success("Password updated");
  };

  return (
    <div className="mx-auto w-full max-w-5xl space-y-6">
      <div className="rounded-2xl border border-border/60 bg-card/80 p-6 shadow-sm backdrop-blur-sm">
        <p className="text-xs font-semibold uppercase tracking-[0.2em] text-primary/80">Account</p>
        <h1 className="mt-2 text-3xl font-bold tracking-tight">Profile</h1>
        <p className="mt-2 text-sm text-muted-foreground">Manage your account details.</p>
      </div>

      <div className="grid gap-6 lg:grid-cols-[1.5fr_0.9fr]">
        <form onSubmit={save} className="rounded-2xl border border-border/60 bg-card p-6 shadow-[var(--shadow-gold)]/10">
          <div className="mb-6 flex items-center justify-between gap-4 border-b border-border/60 pb-4">
            <div>
              <p className="text-xs font-medium uppercase tracking-[0.18em] text-muted-foreground">Personal details</p>
              <h2 className="mt-1 text-xl font-semibold">Profile information</h2>
            </div>
          </div>

          <div className="grid gap-4 md:grid-cols-2">
            <div className="md:col-span-2">
              <Field label="Email" value={email} onChange={() => {}} disabled />
            </div>
            <Field label="Full name" value={form.full_name} onChange={(v) => setForm({ ...form, full_name: v })} />
            <Field label="Username" value={form.username} onChange={(v) => setForm({ ...form, username: v })} />
            <Field label="Phone" value={form.phone} onChange={(v) => setForm({ ...form, phone: v })} />
            <Field label="Country" value={form.country} onChange={(v) => setForm({ ...form, country: v })} />
            <div className="md:col-span-2">
              <Field label="Address" value={form.address} onChange={(v) => setForm({ ...form, address: v })} multiline />
            </div>
          </div>

          <div className="mt-6 flex justify-end">
            <button
              disabled={loading}
              className="rounded-md bg-[image:var(--gradient-gold)] px-5 py-2.5 text-sm font-semibold text-primary-foreground shadow-[var(--shadow-gold)] transition-transform duration-200 hover:-translate-y-0.5 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {loading ? "Saving…" : "Save changes"}
            </button>
          </div>
        </form>

        <div className="rounded-2xl border border-border/60 bg-card p-6 shadow-sm">
          <div className="mb-5">
            <p className="text-xs font-medium uppercase tracking-[0.18em] text-muted-foreground">Security</p>
            <h2 className="mt-1 text-xl font-semibold">Change password</h2>
          </div>

          <div className="space-y-4">
            <Field label="New password" type="password" value={pwd} onChange={setPwd} />
            <button
              type="button"
              onClick={changePwd}
              className="w-full rounded-md border border-primary/30 bg-primary/5 px-5 py-2.5 text-sm font-semibold text-primary transition-colors hover:bg-primary/10"
            >
              Update password
            </button>
          </div>
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
  disabled,
  multiline = false,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  type?: string;
  disabled?: boolean;
  multiline?: boolean;
}) {
  const baseClass = "mt-1 block w-full rounded-md border border-border bg-background px-3 py-2 text-sm transition-colors focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/20 disabled:cursor-not-allowed disabled:opacity-60";

  return (
    <label className="block">
      <span className="text-sm font-medium text-foreground">{label}</span>
      {multiline ? (
        <textarea
          value={value}
          onChange={(e) => onChange(e.target.value)}
          disabled={disabled}
          rows={4}
          className={`${baseClass} resize-none`}
        />
      ) : (
        <input
          type={type}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          disabled={disabled}
          className={baseClass}
        />
      )}
    </label>
  );
}