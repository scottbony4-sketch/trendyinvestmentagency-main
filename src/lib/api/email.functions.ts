import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import {
  sendBrandEmail,
  buildDepositSubmittedEmail,
  buildDepositApprovedEmail,
  buildDepositRejectedEmail,
  buildWithdrawalRequestedEmail,
  buildWithdrawalApprovedEmail,
  buildWithdrawalRejectedEmail,
  buildWithdrawalPaidEmail,
  buildMiningCycleStartedEmail,
  buildMiningCycleCompletedEmail,
  buildDailyEarningEmail,
  buildReferralCommissionEmail,
  buildAccountStatusEmail,
  buildAdminAlertEmail,
} from "@/lib/server/email.server";

async function sendNotificationEmail({
  userId,
  subject,
  text,
  html,
  category,
  meta,
}: {
  userId: string;
  subject: string;
  text: string;
  html: string;
  category?: string;
  meta?: Record<string, any>;
}) {
  const { data: appSettings, error: settingsError } = await supabaseAdmin
    .from("app_settings")
    .select("email_notifications_enabled, email_notifications_deposits, email_notifications_withdrawals, email_notifications_mining, email_notifications_referrals, email_notifications_account")
    .eq("id", 1)
    .maybeSingle();

  if (settingsError) {
    return { success: false, skipped: true, error: settingsError.message };
  }

  const isEnabled = (appSettings as any)?.email_notifications_enabled !== false;
  const categoryEnabled = (() => {
    switch (category) {
      case "deposit_submitted":
      case "deposit_approved":
      case "deposit_rejected":
        return (appSettings as any)?.email_notifications_deposits !== false;
      case "withdrawal_requested":
      case "withdrawal_approved":
      case "withdrawal_rejected":
      case "withdrawal_paid":
        return (appSettings as any)?.email_notifications_withdrawals !== false;
      case "mining_started":
      case "mining_completed":
      case "daily_earning":
        return (appSettings as any)?.email_notifications_mining !== false;
      case "referral_commission":
        return (appSettings as any)?.email_notifications_referrals !== false;
      case "account_status":
        return (appSettings as any)?.email_notifications_account !== false;
      default:
        return true;
    }
  })();

  if (!isEnabled || !categoryEnabled) {
    return { success: false, skipped: true, error: "Notifications disabled" };
  }

  const { data: urow, error: uerr } = await supabaseAdmin
    .from("auth.users")
    .select("email")
    .eq("id", userId)
    .maybeSingle();

  const toEmail = (urow as any)?.email;
  if (uerr || !toEmail) return { success: false, skipped: true, error: uerr?.message || "User email not found" };

  const res = await sendBrandEmail({ to: toEmail, subject, text, html });
  const status = res.success ? "sent" : "failed";

  await supabaseAdmin.from("email_logs").insert({
    user_id: userId,
    to_email: toEmail,
    subject,
    body: res.success ? text : String(res.error ?? ""),
    status,
    meta: {
      event: category,
      ...meta,
      info: (res as any).info ?? null,
      error: (res as any).error ?? null,
    },
  });

  return { success: res.success, skipped: false };
}

async function sendAdminAlertEmail({
  title,
  message,
  note,
}: {
  title: string;
  message: string;
  note?: string;
}) {
  const { data: appSettings, error: settingsError } = await supabaseAdmin
    .from("app_settings")
    .select("email_notifications_enabled")
    .eq("id", 1)
    .maybeSingle();

  if (settingsError || (appSettings as any)?.email_notifications_enabled === false) {
    return { success: false, skipped: true, error: settingsError?.message || "Notifications disabled" };
  }

  const { data: adminUserRows, error: adminError } = await supabaseAdmin
    .from("user_roles")
    .select("user_id")
    .eq("role", "admin");

  if (adminError) {
    return { success: false, skipped: true, error: adminError.message };
  }

  const ids = (adminUserRows || []).map((row: any) => row.user_id).filter(Boolean);
  if (!ids.length) return { success: false, skipped: true, error: "No admins found" };

  const { data: users, error: usersError } = await supabaseAdmin
    .from("auth.users")
    .select("id, email")
    .in("id", ids);

  if (usersError) return { success: false, skipped: true, error: usersError.message };

  const recipients = (users || []).filter((user: any) => user.email).map((user: any) => ({ id: user.id, email: user.email }));
  if (!recipients.length) return { success: false, skipped: true, error: "No admin emails found" };

  const { subject, text, html } = buildAdminAlertEmail({ title, message, note });

  const results = await Promise.all(recipients.map(async (recipient) => {
    const res = await sendBrandEmail({ to: recipient.email, subject, text, html });
    const status = res.success ? "sent" : "failed";
    await supabaseAdmin.from("email_logs").insert({
      user_id: recipient.id,
      to_email: recipient.email,
      subject,
      body: res.success ? text : String(res.error ?? ""),
      status,
      meta: { event: "admin_alert", title, message, note, info: (res as any).info ?? null, error: (res as any).error ?? null },
    });
    return { success: res.success };
  }));

  return { success: results.some((result) => result.success), skipped: false };
}

export const sendDepositSubmittedEmail = createServerFn({ method: "POST" })
  .validator(z.object({ depositId: z.string() }))
  .handler(async ({ data }) => {
    const { depositId } = data;
    const { data: dep, error: depErr } = await supabaseAdmin.from("deposits").select("*").eq("id", depositId).maybeSingle();
    if (depErr || !dep) throw depErr ?? new Error("Deposit not found");
    const userId = (dep as any).user_id;
    const { subject, text, html } = buildDepositSubmittedEmail({ amount: Number((dep as any).amount), depositId });
    return sendNotificationEmail({ userId, subject, text, html, category: "deposit_submitted", meta: { deposit_id: depositId } });
  });

export const sendDepositApprovedEmail = createServerFn({ method: "POST" })
  .validator(z.object({ depositId: z.string() }))
  .handler(async ({ data }) => {
    const { depositId } = data;
    const { data: dep, error: depErr } = await supabaseAdmin.from("deposits").select("*").eq("id", depositId).maybeSingle();
    if (depErr || !dep) throw depErr ?? new Error("Deposit not found");
    const userId = (dep as any).user_id;
    const { subject, text, html } = buildDepositApprovedEmail({ amount: Number((dep as any).amount), depositId });
    return sendNotificationEmail({ userId, subject, text, html, category: "deposit_approved", meta: { deposit_id: depositId } });
  });

export const sendDepositRejectedEmail = createServerFn({ method: "POST" })
  .validator(z.object({ depositId: z.string() }))
  .handler(async ({ data }) => {
    const { depositId } = data;
    const { data: dep, error: depErr } = await supabaseAdmin.from("deposits").select("*").eq("id", depositId).maybeSingle();
    if (depErr || !dep) throw depErr ?? new Error("Deposit not found");
    const userId = (dep as any).user_id;
    const { subject, text, html } = buildDepositRejectedEmail({ amount: Number((dep as any).amount), reason: (dep as any).admin_note });
    return sendNotificationEmail({ userId, subject, text, html, category: "deposit_rejected", meta: { deposit_id: depositId } });
  });

export const sendWithdrawalRequestedEmail = createServerFn({ method: "POST" })
  .validator(z.object({ withdrawalId: z.string() }))
  .handler(async ({ data }) => {
    const { withdrawalId } = data;
    const { data: w, error: wErr } = await supabaseAdmin.from("withdrawals").select("*").eq("id", withdrawalId).maybeSingle();
    if (wErr || !w) throw wErr ?? new Error("Withdrawal not found");
    const userId = (w as any).user_id;
    const { data: appSettings } = await supabaseAdmin.from("app_settings").select("withdrawal_fee_enabled, withdrawal_fee_percent").eq("id", 1).maybeSingle();
    const feeEnabled = (appSettings as any)?.withdrawal_fee_enabled !== false;
    const feePct = feeEnabled ? Number((appSettings as any)?.withdrawal_fee_percent ?? 5) : 0;
    const gross = Number((w as any).amount);
    const fee = Math.floor((gross * feePct) / 100);
    const net = Math.max(0, Math.floor(gross) - fee);
    const { subject, text, html } = buildWithdrawalRequestedEmail({ amount: gross, phone: (w as any).mpesa_phone, netAmount: net, feePct });
    return sendNotificationEmail({ userId, subject, text, html, category: "withdrawal_requested", meta: { withdrawal_id: withdrawalId, net_amount: net, fee_percent: feePct } });
  });

export const sendWithdrawalApprovedEmail = createServerFn({ method: "POST" })
  .validator(z.object({ withdrawalId: z.string() }))
  .handler(async ({ data }) => {
    const { withdrawalId } = data;
    const { data: w, error: wErr } = await supabaseAdmin.from("withdrawals").select("*").eq("id", withdrawalId).maybeSingle();
    if (wErr || !w) throw wErr ?? new Error("Withdrawal not found");
    const userId = (w as any).user_id;
    const { data: appSettings } = await supabaseAdmin.from("app_settings").select("withdrawal_fee_enabled, withdrawal_fee_percent").eq("id", 1).maybeSingle();
    const feeEnabled = (appSettings as any)?.withdrawal_fee_enabled !== false;
    const feePct = feeEnabled ? Number((appSettings as any)?.withdrawal_fee_percent ?? 5) : 0;
    const gross = Number((w as any).amount);
    const fee = Math.floor((gross * feePct) / 100);
    const net = Math.max(0, Math.floor(gross) - fee);
    const { subject, text, html } = buildWithdrawalApprovedEmail({ amount: gross, payoutMpesaCode: (w as any).payout_mpesa_code, note: (w as any).admin_note, netAmount: net, feePct });
    return sendNotificationEmail({ userId, subject, text, html, category: "withdrawal_approved", meta: { withdrawal_id: withdrawalId, net_amount: net, fee_percent: feePct } });
  });

export const sendWithdrawalRejectedEmail = createServerFn({ method: "POST" })
  .validator(z.object({ withdrawalId: z.string() }))
  .handler(async ({ data }) => {
    const { withdrawalId } = data;
    const { data: w, error: wErr } = await supabaseAdmin.from("withdrawals").select("*").eq("id", withdrawalId).maybeSingle();
    if (wErr || !w) throw wErr ?? new Error("Withdrawal not found");
    const userId = (w as any).user_id;
    const { subject, text, html } = buildWithdrawalRejectedEmail({ amount: Number((w as any).amount), reason: (w as any).admin_note });
    return sendNotificationEmail({ userId, subject, text, html, category: "withdrawal_rejected", meta: { withdrawal_id: withdrawalId } });
  });

export const sendWithdrawalPaidEmail = createServerFn({ method: "POST" })
  .validator(z.object({ withdrawalId: z.string() }))
  .handler(async ({ data }) => {
    const { withdrawalId } = data;
    const { data: w, error: wErr } = await supabaseAdmin.from("withdrawals").select("*").eq("id", withdrawalId).maybeSingle();
    if (wErr || !w) throw wErr ?? new Error("Withdrawal not found");
    const userId = (w as any).user_id;
    const { data: appSettings } = await supabaseAdmin.from("app_settings").select("withdrawal_fee_enabled, withdrawal_fee_percent").eq("id", 1).maybeSingle();
    const feeEnabled = (appSettings as any)?.withdrawal_fee_enabled !== false;
    const feePct = feeEnabled ? Number((appSettings as any)?.withdrawal_fee_percent ?? 5) : 0;
    const gross = Number((w as any).amount);
    const fee = Math.floor((gross * feePct) / 100);
    const net = Math.max(0, Math.floor(gross) - fee);
    const { subject, text, html } = buildWithdrawalPaidEmail({ amount: gross, payoutMpesaCode: (w as any).payout_mpesa_code, note: (w as any).admin_note, netAmount: net, feePct });
    return sendNotificationEmail({ userId, subject, text, html, category: "withdrawal_paid", meta: { withdrawal_id: withdrawalId, net_amount: net, fee_percent: feePct } });
  });

export const sendMiningCycleStartedEmail = createServerFn({ method: "POST" })
  .validator(z.object({ investmentId: z.string() }))
  .handler(async ({ data }) => {
    const { investmentId } = data;
    const { data: inv, error: invErr } = await supabaseAdmin.from("investments").select("*").eq("id", investmentId).maybeSingle();
    if (invErr || !inv) throw invErr ?? new Error("Investment not found");
    const userId = (inv as any).user_id;
    const { subject, text, html } = buildMiningCycleStartedEmail({ amount: Number((inv as any).plan_amount), planName: (inv as any).plan_name, durationDays: Number((inv as any).duration_days) });
    return sendNotificationEmail({ userId, subject, text, html, category: "mining_started", meta: { investment_id: investmentId } });
  });

export const sendMiningCycleCompletedEmail = createServerFn({ method: "POST" })
  .validator(z.object({ investmentId: z.string() }))
  .handler(async ({ data }) => {
    const { investmentId } = data;
    const { data: inv, error: invErr } = await supabaseAdmin.from("investments").select("*").eq("id", investmentId).maybeSingle();
    if (invErr || !inv) throw invErr ?? new Error("Investment not found");
    const userId = (inv as any).user_id;
    const { subject, text, html } = buildMiningCycleCompletedEmail({ amount: Number((inv as any).plan_amount), payout: Number((inv as any).projected_payout), planName: (inv as any).plan_name });
    return sendNotificationEmail({ userId, subject, text, html, category: "mining_completed", meta: { investment_id: investmentId } });
  });

export const sendDailyEarningEmail = createServerFn({ method: "POST" })
  .validator(z.object({ userId: z.string(), amount: z.number(), earningDate: z.string().optional() }))
  .handler(async ({ data }) => {
    const { subject, text, html } = buildDailyEarningEmail({ amount: data.amount, earningDate: data.earningDate });
    return sendNotificationEmail({ userId: data.userId, subject, text, html, category: "daily_earning" });
  });

export const sendReferralCommissionEmail = createServerFn({ method: "POST" })
  .validator(z.object({ userId: z.string(), amount: z.number(), percent: z.number().optional() }))
  .handler(async ({ data }) => {
    const { subject, text, html } = buildReferralCommissionEmail({ amount: data.amount, percent: data.percent });
    return sendNotificationEmail({ userId: data.userId, subject, text, html, category: "referral_commission" });
  });

export const sendAccountStatusEmail = createServerFn({ method: "POST" })
  .validator(z.object({ userId: z.string(), status: z.string(), note: z.string().optional() }))
  .handler(async ({ data }) => {
    const { subject, text, html } = buildAccountStatusEmail({ status: data.status, note: data.note });
    return sendNotificationEmail({ userId: data.userId, subject, text, html, category: "account_status" });
  });

export const sendAdminAlertEmailFn = createServerFn({ method: "POST" })
  .validator(z.object({ title: z.string(), message: z.string(), note: z.string().optional() }))
  .handler(async ({ data }) => {
    return sendAdminAlertEmail({ title: data.title, message: data.message, note: data.note });
  });

export default {};