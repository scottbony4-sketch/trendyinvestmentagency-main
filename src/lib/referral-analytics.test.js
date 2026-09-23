import test from "node:test";
import assert from "node:assert/strict";
import { buildReferralAnalytics } from "./referral-analytics.js";

test("groups referrals by referrer and sums invested plans", () => {
  const referrals = [
    { id: "r1", referrer_id: "u1", referred_id: "u2", deposit_id: "d1", amount: 100, percent: 10, status: "approved", created_at: "2026-01-01T00:00:00.000Z" },
    { id: "r2", referrer_id: "u1", referred_id: "u3", deposit_id: "d2", amount: 120, percent: 12, status: "paid", created_at: "2026-01-02T00:00:00.000Z" },
  ];

  const profiles = [
    { id: "u1", full_name: "Alice", referral_code: "ALICE77", balance: 0, created_at: "2026-01-01T00:00:00.000Z" },
    { id: "u2", full_name: "Bob", referral_code: null, balance: 0, created_at: "2026-01-01T00:00:00.000Z" },
    { id: "u3", full_name: "Cara", referral_code: null, balance: 0, created_at: "2026-01-01T00:00:00.000Z" },
  ];

  const investments = [
    { id: "i1", user_id: "u2", plan_id: "p1", plan_amount: 500, status: "active", created_at: "2026-01-01T00:00:00.000Z" },
    { id: "i2", user_id: "u2", plan_id: "p2", plan_amount: 700, status: "active", created_at: "2026-01-01T00:00:00.000Z" },
    { id: "i3", user_id: "u3", plan_id: "p1", plan_amount: 300, status: "active", created_at: "2026-01-02T00:00:00.000Z" },
  ];

  const result = buildReferralAnalytics({ referrals, profiles, investments, investmentPlans: { p1: "Starter", p2: "VIP" } });

  assert.equal(result.length, 1);
  assert.equal(result[0].joinedUsers, 2);
  assert.equal(result[0].referralCode, "ALICE77");
  assert.deepEqual(result[0].planNames, ["Starter", "VIP"]);
  assert.equal(result[0].totalInvestedAmount, 1500);
});
