Scope: incremental updates on the existing mining platform. No redesign, no data reset.

## 1. Rebrand → TRENDY INVESTMENT AGENCY
- Replace "TRENDX" / any old name in: navbar/logo, footer, landing (`index.tsx`), `login`, `signup`, `forgot-password`, `reset-password`, dashboard headings, admin headings, notifications copy, all route `head()` titles, `__root.tsx` meta.
- Keep mining vocabulary (mining cycle, mining progress, mined balance, projected mining payout).

## 2. Mining plans (data migration + UI)
Seed/replace `investment_plans` to exactly these tiers, keyed by `plan_amount` + `duration_days`:
- 7d / 20%: 250→300, 500→600, 1000→1200, 5000→6000, 10000→12000
- 17d / 50%: 250→375, 500→750, 1000→1500, 5000→7500, 10000→15000
- 28d / 100%: 250→500, 500→1000, 1000→2000, 5000→10000, 10000→20000

Rules: whole numbers, `KSh` prefix everywhere, label totals as "Projected Mining Payout". Update `/invest` plan grid + `/deposit` to only allow those amount×duration combos.

## 3. Mining progress tracking
Update `investments` display (dashboard + `/invest` history card):
- Show plan, amount, duration, %, projected payout, start, end (= start + duration), remaining time countdown (d/h/m), progress %, status.
- Status enum surfaced in UI: Pending Payment, Payment Under Review, Active Mining, Completed, Withdraw Requested, Paid, Cancelled, Rejected (map from deposit + investment state).
- Progress = clamp((now − start)/(end − start), 0, 1); starts only after admin approves deposit (already the trigger behavior).
- On maturity: keep existing `claim_earnings`, but change to auto-credit full projected payout when `end_at` passes (one-shot), then mark completed. Add SQL function `mature_investments()` + call it lazily on dashboard load.
- Available balance = `profiles.balance`; active mining balance = sum of active `plan_amount` (display only, not withdrawable).

## 4. Withdrawals
- Min KSh 20 (settings default). Reject anything below.
- Only Mon–Fri Africa/Nairobi. Client + server check. Weekend → disable button + show notice.
- Withdrawal fee default 20%, admin-toggleable in `app_settings` (`withdrawal_fee_enabled` bool + existing `withdrawal_fee_percent`). Show charge + net on form.
- Whole numbers only.
- Status flow already exists (pending/approved/rejected) — add `paid` distinct from `approved` if not present.

## 5. Admin withdrawal controls
Extend admin withdrawal tab: search by name/phone/amount/date/status, approve/reject/mark paid buttons, manual open/close toggle in settings (`withdrawals_open` bool overrides weekend rule when false).

## 6. Referrals
- Codes: `FIRSTNAME + 4-digit random`, uppercase, unique, generated at signup from `full_name`. Backfill existing users via SQL update.
- No self-referral (check in signup).
- Referral link `/signup?ref=CODE` (already present) — add copy buttons for code + link.
- Signup: validate ref code exists before account create; auto-fill from `?ref`.
- Referral rewards: rename existing `referral_earnings.status` to include pending/approved/rejected/paid (add `status` column default 'approved' for backward compat with current auto-credit trigger, admin can override).
- Dashboard `/referrals`: show code, link, totals, pending/approved/paid reward sums, referral history table (name, phone, joined, first deposit status, reward status).

## 7. WhatsApp support
Shared `<WhatsAppButton />` component using `https://wa.me/254718757621?text=...`. Add to landing, login, signup, dashboard, admin, footer.

## 8. Admin user management
Add tabs/actions in admin: search (name/phone/email/code/status/date), profile drawer showing balance/deposits/withdrawals/active+completed cycles/referrals. Suspend/activate (existing `admin_set_user_status`), soft delete (add `deleted_at` column + policy filter), restore, deleted-users section. Super-admin (role `super_admin`) required for permanent delete.

## 9. Admin dashboard stats
Add counter cards: total/active/suspended/deleted users, pending/approved deposits, pending/paid withdrawals, active/completed cycles, totals for deposits, projected payouts, referral rewards, recent activity feed (from `admin_actions` + `transactions`).

## 10. Admin mining cycle management
New admin tab listing `investments` with filters (user/amount/plan/status/dates) and actions: activate, pause (new `paused` status), cancel, mark completed, mark paid.

## 11. Admin activity log
Existing `admin_actions` already logs. Add missing insertions in new admin actions (delete/restore/pay/cancel cycle/plan edit/settings change). Add `/admin` "Activity" tab.

## 12. Table UX
Reusable list features on new tables: search input, status filter, sort by date, client-side pagination (20/page), status badges, confirm dialogs (AlertDialog), toast notifications.

## Technical notes
- One migration: seed plans, add `withdrawal_fee_enabled`, `withdrawals_open`, `deleted_at`, `paused` support, `referral_earnings.status`, `super_admin` enum value if missing, `mature_investments()` fn.
- Copy-only rebrand handled in a batch of file edits.
- Weekend check server-side in a new `request_withdrawal` server fn to prevent bypass.
- No new dependencies.

## Out of scope this turn
Landing/marketing redesign, PDF/Excel/print exports, SMTP settings UI, email template editor, 2FA, logo/favicon upload, T&C/Privacy editor. Can follow in a later turn.
