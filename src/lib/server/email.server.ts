import process from "node:process";
import nodemailer from "nodemailer";

const EMAIL_FROM = process.env.EMAIL_FROM || `TRENDY INVESTMENT AGENCY <no-reply@trendyinvestmentagency.app>`;
const EMAIL_BRAND_NAME = process.env.EMAIL_BRAND_NAME || "TRENDY INVESTMENT AGENCY";

let transporter: nodemailer.Transporter | null = null;

function getTransporter() {
  if (transporter) return transporter;

  const SMTP_HOST = process.env.SMTP_HOST;
  const SMTP_PORT = process.env.SMTP_PORT ? Number(process.env.SMTP_PORT) : undefined;
  const SMTP_USER = process.env.SMTP_USER;
  const SMTP_PASS = process.env.SMTP_PASS;

  if (!SMTP_HOST || !SMTP_PORT || !SMTP_USER || !SMTP_PASS) {
    return null;
  }

  transporter = nodemailer.createTransport({
    host: SMTP_HOST,
    port: SMTP_PORT,
    secure: SMTP_PORT === 465,
    auth: {
      user: SMTP_USER,
      pass: SMTP_PASS,
    },
  });

  return transporter;
}

function buildEmailShell({ title, body, ctaLabel, ctaUrl, footerNote }: { title: string; body: string; ctaLabel?: string; ctaUrl?: string; footerNote?: string }) {
  const safeUrl = ctaUrl || process.env.PUBLIC_URL || "#";
  const ctaMarkup = ctaLabel && ctaUrl
    ? `<p style="margin: 0 0 24px;"><a href="${safeUrl}" style="color: #1f61ff; text-decoration: none; font-weight: 600;">${ctaLabel}</a></p>`
    : "";

  return {
    html: `
      <div style="font-family: system-ui, sans-serif; color: #111; line-height: 1.6;">
        <div style="background: linear-gradient(90deg, #f5b301 0%, #f59e0b 100%); padding: 18px 24px; border-radius: 12px 12px 0 0; color: #111; font-weight: 700; letter-spacing: 0.02em;">
          ${EMAIL_BRAND_NAME}
        </div>
        <div style="padding: 24px; border: 1px solid #e5e7eb; border-top: 0; border-radius: 0 0 12px 12px; background: #fff;">
          <p style="font-size: 18px; font-weight: 700; margin: 0 0 16px;">${title}</p>
          <div style="margin: 0 0 12px; white-space: pre-line;">${body}</div>
          ${ctaMarkup}
          <hr style="border: none; border-top: 1px solid #e5e7eb; margin: 24px 0;" />
          <p style="margin: 0; font-size: 14px; color: #6b7280;">${footerNote || `Thank you for choosing ${EMAIL_BRAND_NAME}.`}</p>
        </div>
      </div>
    `,
  };
}

function createLink(path: string) {
  const base = (process.env.PUBLIC_URL || "").replace(/\/$/, "");
  const relativePath = path.startsWith("/") ? path : `/${path}`;
  if (!base) return `#${relativePath}`;
  return `${base}${relativePath}`;
}

export function formatAmount(amount: number) {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(Number(amount ?? 0));
}

export async function sendBrandEmail({
  to,
  subject,
  text,
  html,
}: {
  to: string;
  subject: string;
  text: string;
  html: string;
}) {
  const mailTransport = getTransporter();

  if (!mailTransport) {
    return {
      success: false,
      error: "Missing email configuration. Set SMTP_HOST, SMTP_PORT, SMTP_USER and SMTP_PASS in your environment.",
    };
  }

  try {
    const info = await mailTransport.sendMail({
      from: EMAIL_FROM,
      to,
      subject,
      text,
      html,
    });

    return { success: true, info };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

export function buildDepositSubmittedEmail({ amount, depositId }: { amount: number; depositId?: string }) {
  const formattedAmount = formatAmount(amount);
  const subject = `${EMAIL_BRAND_NAME}: Deposit received`;
  const text = `Hello,

We received your deposit request of ${formattedAmount}. Waiting for approval.
${depositId ? `Deposit reference: ${depositId}
` : ""}
You will receive an update as soon as it is reviewed.

Thank you for choosing ${EMAIL_BRAND_NAME}.`;
  const { html } = buildEmailShell({
    title: "Deposit received",
    body: `We received your deposit request of ${formattedAmount}. Waiting for approval.${depositId ? `\n\nDeposit reference: ${depositId}` : ""}\n\nYou will receive an update as soon as it is reviewed.`,
    ctaLabel: "Open your dashboard",
    ctaUrl: createLink("/dashboard"),
  });
  return { subject, text, html };
}

export function buildDepositApprovedEmail({ amount, depositId }: { amount: number; depositId?: string }) {
  const formattedAmount = formatAmount(amount);
  const subject = `${EMAIL_BRAND_NAME}: Deposit approved`;
  const text = `Hello,

Your deposit of ${formattedAmount} has been approved by ${EMAIL_BRAND_NAME}.
${depositId ? `Deposit reference: ${depositId}
` : ""}
Your funds are now available in your account balance.

Thank you for investing with ${EMAIL_BRAND_NAME}.`;
  const { html } = buildEmailShell({
    title: "Deposit approved",
    body: `Your deposit of ${formattedAmount} has been approved by ${EMAIL_BRAND_NAME}.${depositId ? `\n\nDeposit reference: ${depositId}` : ""}\n\nYour funds are now available in your account balance.`,
    ctaLabel: "View your dashboard",
    ctaUrl: createLink("/dashboard"),
  });
  return { subject, text, html };
}

export function buildDepositRejectedEmail({ amount, reason }: { amount: number; reason?: string }) {
  const formattedAmount = formatAmount(amount);
  const subject = `${EMAIL_BRAND_NAME}: Deposit update`;
  const text = `Hello,

Your deposit of ${formattedAmount} was reviewed and could not be approved.
${reason ? `Reason: ${reason}\n` : ""}
Please contact support if you need help resolving the issue.

Thank you for choosing ${EMAIL_BRAND_NAME}.`;
  const { html } = buildEmailShell({
    title: "Deposit update",
    body: `Your deposit of ${formattedAmount} was reviewed and could not be approved.${reason ? `\n\nReason: ${reason}` : ""}\n\nPlease contact support if you need help resolving the issue.`,
    ctaLabel: "Contact support",
    ctaUrl: createLink("/support"),
  });
  return { subject, text, html };
}

export function buildWithdrawalRequestedEmail({ amount, phone, netAmount, feePct }: { amount: number; phone?: string; netAmount?: number; feePct?: number }) {
  const formattedAmount = formatAmount(amount);
  const formattedNet = typeof netAmount === 'number' ? formatAmount(netAmount) : null;
  const subject = `${EMAIL_BRAND_NAME}: Withdrawal requested`;
  const text = `Hello,

Your withdrawal request for ${formattedAmount} has been received and is pending review.
${formattedNet ? `Net to receive: ${formattedNet} (${feePct ?? 0}% fee)\n` : ""}
${phone ? `Destination phone: ${phone}\n` : ""}
We will update you once the payout has been processed.

Thank you for choosing ${EMAIL_BRAND_NAME}.`;
  const { html } = buildEmailShell({
    title: "Withdrawal requested",
    body: `Your withdrawal request for ${formattedAmount} has been received and is pending review.${formattedNet ? `\n\nNet to receive: ${formattedNet} (${feePct ?? 0}% fee)` : ""}${phone ? `\n\nDestination phone: ${phone}` : ""}\n\nWe will update you once the payout has been processed.`,
    ctaLabel: "View transactions",
    ctaUrl: createLink("/withdraw"),
  });
  return { subject, text, html };
}

export function buildWithdrawalApprovedEmail({ amount, payoutMpesaCode, note, netAmount, feePct }: { amount: number; payoutMpesaCode?: string; note?: string; netAmount?: number; feePct?: number }) {
  const formattedAmount = formatAmount(amount);
  const formattedNet = typeof netAmount === 'number' ? formatAmount(netAmount) : null;
  const subject = `${EMAIL_BRAND_NAME}: Withdrawal approved`;
  const text = `Hello,

Your withdrawal request for ${formattedAmount} has been approved by ${EMAIL_BRAND_NAME}.
${formattedNet ? `Net to receive: ${formattedNet} (${feePct ?? 0}% fee)\n` : ""}${payoutMpesaCode ? `M-Pesa transaction code: ${payoutMpesaCode}\n` : ""}${note ? `Admin note: ${note}\n` : ""}
We will finalize the payment shortly.

Thank you for choosing ${EMAIL_BRAND_NAME}.`;
  const { html } = buildEmailShell({
    title: "Withdrawal approved",
    body: `Your withdrawal request for ${formattedAmount} has been approved by ${EMAIL_BRAND_NAME}.${formattedNet ? `\n\nNet to receive: ${formattedNet} (${feePct ?? 0}% fee)` : ""}${payoutMpesaCode ? `\n\nM-Pesa transaction code: ${payoutMpesaCode}` : ""}${note ? `\n\nAdmin note: ${note}` : ""}\n\nWe will finalize the payment shortly.`,
    ctaLabel: "Review payout status",
    ctaUrl: createLink("/withdraw"),
  });
  return { subject, text, html };
}

export function buildWithdrawalRejectedEmail({ amount, reason }: { amount: number; reason?: string }) {
  const formattedAmount = formatAmount(amount);
  const subject = `${EMAIL_BRAND_NAME}: Withdrawal update`;
  const text = `Hello,

Your withdrawal request for ${formattedAmount} was reviewed and could not be approved.
${reason ? `Reason: ${reason}\n` : ""}
Please contact support if you need help.

Thank you for choosing ${EMAIL_BRAND_NAME}.`;
  const { html } = buildEmailShell({
    title: "Withdrawal update",
    body: `Your withdrawal request for ${formattedAmount} was reviewed and could not be approved.${reason ? `\n\nReason: ${reason}` : ""}\n\nPlease contact support if you need help.`,
    ctaLabel: "Contact support",
    ctaUrl: createLink("/support"),
  });
  return { subject, text, html };
}

export function buildWithdrawalPaidEmail({ amount, payoutMpesaCode, note, netAmount, feePct }: { amount: number; payoutMpesaCode?: string; note?: string; netAmount?: number; feePct?: number }) {
  const formattedAmount = formatAmount(amount);
  const formattedNet = typeof netAmount === 'number' ? formatAmount(netAmount) : null;
  const subject = `${EMAIL_BRAND_NAME}: Withdrawal paid`;
  const text = `Hello,

Your withdrawal request for ${formattedAmount} has been marked as paid by ${EMAIL_BRAND_NAME}.
${formattedNet ? `Net paid: ${formattedNet} (${feePct ?? 0}% fee)\n` : ""}${payoutMpesaCode ? `M-Pesa transaction code: ${payoutMpesaCode}\n` : ""}${note ? `Admin note: ${note}\n` : ""}

Thank you for using ${EMAIL_BRAND_NAME}.`;
  const { html } = buildEmailShell({
    title: "Withdrawal paid",
    body: `Your withdrawal request for ${formattedAmount} has been marked as paid by ${EMAIL_BRAND_NAME}.${formattedNet ? `\n\nNet paid: ${formattedNet} (${feePct ?? 0}% fee)` : ""}${payoutMpesaCode ? `\n\nM-Pesa transaction code: ${payoutMpesaCode}` : ""}${note ? `\n\nAdmin note: ${note}` : ""}`,
    ctaLabel: "View transaction history",
    ctaUrl: createLink("/withdraw"),
  });
  return { subject, text, html };
}

export function buildMiningCycleStartedEmail({ amount, planName, durationDays }: { amount: number; planName?: string; durationDays?: number }) {
  const formattedAmount = formatAmount(amount);
  const subject = `${EMAIL_BRAND_NAME}: Mining cycle started`;
  const text = `Hello,

Your mining cycle for ${formattedAmount} has started successfully.
${planName ? `Plan: ${planName}\n` : ""}${durationDays ? `Duration: ${durationDays} days\n` : ""}
Your projected payout will be reflected in your dashboard shortly.

Thank you for choosing ${EMAIL_BRAND_NAME}.`;
  const { html } = buildEmailShell({
    title: "Mining cycle started",
    body: `Your mining cycle for ${formattedAmount} has started successfully.${planName ? `\n\nPlan: ${planName}` : ""}${durationDays ? `\n\nDuration: ${durationDays} days` : ""}\n\nYour projected payout will be reflected in your dashboard shortly.`,
    ctaLabel: "Open dashboard",
    ctaUrl: createLink("/dashboard"),
  });
  return { subject, text, html };
}

export function buildMiningCycleCompletedEmail({ amount, payout, planName }: { amount: number; payout?: number; planName?: string }) {
  const formattedAmount = formatAmount(amount);
  const payoutAmount = payout !== undefined ? formatAmount(payout) : null;
  const subject = `${EMAIL_BRAND_NAME}: Mining cycle completed`;
  const text = `Hello,

Your mining cycle for ${formattedAmount} has completed successfully.${planName ? `\nPlan: ${planName}` : ""}${payoutAmount ? `\nProjected payout: ${payoutAmount}` : ""}

Thank you for trusting ${EMAIL_BRAND_NAME}.`;
  const { html } = buildEmailShell({
    title: "Mining cycle completed",
    body: `Your mining cycle for ${formattedAmount} has completed successfully.${planName ? `\n\nPlan: ${planName}` : ""}${payoutAmount ? `\n\nProjected payout: ${payoutAmount}` : ""}`,
    ctaLabel: "Review earnings",
    ctaUrl: createLink("/dashboard"),
  });
  return { subject, text, html };
}

export function buildDailyEarningEmail({ amount, earningDate }: { amount: number; earningDate?: string }) {
  const formattedAmount = formatAmount(amount);
  const subject = `${EMAIL_BRAND_NAME}: Daily earning credited`;
  const text = `Hello,

A daily earning of ${formattedAmount} has been credited to your account.${earningDate ? `\nDate: ${earningDate}` : ""}

Thank you for investing with ${EMAIL_BRAND_NAME}.`;
  const { html } = buildEmailShell({
    title: "Daily earning credited",
    body: `A daily earning of ${formattedAmount} has been credited to your account.${earningDate ? `\n\nDate: ${earningDate}` : ""}`,
    ctaLabel: "View balance",
    ctaUrl: createLink("/dashboard"),
  });
  return { subject, text, html };
}

export function buildReferralCommissionEmail({ amount, percent }: { amount: number; percent?: number }) {
  const formattedAmount = formatAmount(amount);
  const subject = `${EMAIL_BRAND_NAME}: Referral commission received`;
  const text = `Hello,

You received a referral commission of ${formattedAmount}.${percent ? `\nCommission rate: ${percent}%` : ""}

Thank you for growing the ${EMAIL_BRAND_NAME} community.`;
  const { html } = buildEmailShell({
    title: "Referral commission received",
    body: `You received a referral commission of ${formattedAmount}.${percent ? `\n\nCommission rate: ${percent}%` : ""}`,
    ctaLabel: "See your rewards",
    ctaUrl: createLink("/dashboard"),
  });
  return { subject, text, html };
}

export function buildAccountStatusEmail({ status, note }: { status: string; note?: string }) {
  const subject = `${EMAIL_BRAND_NAME}: Account update`;
  const text = `Hello,

Your account status has been updated to ${status}.${note ? `\n\n${note}` : ""}

Thank you for choosing ${EMAIL_BRAND_NAME}.`;
  const { html } = buildEmailShell({
    title: "Account update",
    body: `Your account status has been updated to ${status}.${note ? `\n\n${note}` : ""}`,
    ctaLabel: "Open dashboard",
    ctaUrl: createLink("/dashboard"),
  });
  return { subject, text, html };
}

export function buildAdminAlertEmail({ title, message, note }: { title: string; message: string; note?: string }) {
  const subject = `${EMAIL_BRAND_NAME}: ${title}`;
  const text = `Hello,

${message}${note ? `\n\n${note}` : ""}

Please review the latest activity in ${EMAIL_BRAND_NAME}.`;
  const { html } = buildEmailShell({
    title,
    body: `${message}${note ? `\n\n${note}` : ""}`,
    ctaLabel: "Open admin panel",
    ctaUrl: createLink("/admin"),
    footerNote: "This message was generated by the TRENDY INVESTMENT AGENCY admin system.",
  });
  return { subject, text, html };
}
