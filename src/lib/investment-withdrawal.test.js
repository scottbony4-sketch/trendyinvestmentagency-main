import test from "node:test";
import assert from "node:assert/strict";
import { getWithdrawalUnlockDate, getWithdrawalUnlockState, aggregateInvestmentEarnings, getWithdrawalAvailabilityReason, calculateInvestmentPlanMetrics, calculateWithdrawalFee, summarizePortfolioBalance, getAvailableWithdrawalBalance, getPlanProgress } from "./investment-withdrawal.js";

test("uses the activation day for 7-day plans", () => {
  const start = "2026-07-01T00:00:00Z";
  assert.equal(getWithdrawalUnlockDate(start, 7), "2026-07-01");
});

test("uses day 7 for 17-day plans", () => {
  const start = "2026-07-01T00:00:00Z";
  assert.equal(getWithdrawalUnlockDate(start, 17), "2026-07-07");
});

test("uses day 21 for 28-day plans", () => {
  const start = "2026-07-01T00:00:00Z";
  assert.equal(getWithdrawalUnlockDate(start, 28), "2026-07-21");
});

test("only unlocks after the calculated date", () => {
  const start = "2026-07-01T00:00:00Z";
  assert.equal(getWithdrawalUnlockState(start, 17, new Date("2026-07-06T12:00:00Z")).isUnlocked, false);
  assert.equal(getWithdrawalUnlockState(start, 17, new Date("2026-07-07T12:00:00Z")).isUnlocked, true);
});

test("aggregates duplicate earnings once and keeps withdrawable amounts separate", () => {
  const investment = { id: "inv-1", duration_days: 7, start_at: "2026-07-01T00:00:00Z" };
  const rows = [
    { investment_id: "inv-1", earning_date: "2026-07-01", amount: 100, added_to_balance: false },
    { investment_id: "inv-1", earning_date: "2026-07-01", amount: 100, added_to_balance: false },
    { investment_id: "inv-1", earning_date: "2026-07-02", amount: 120, added_to_balance: true },
  ];
  const result = aggregateInvestmentEarnings(investment, rows, new Date("2026-07-02T00:00:00Z"));
  assert.equal(result.accumulated, 220);
  assert.equal(result.withdrawable, 220);
  assert.equal(result.locked, 0);
});

test("counts unlocked pending earnings as available to withdraw", () => {
  const investment = { id: "inv-2", duration_days: 7, start_at: "2026-07-01T00:00:00Z" };
  const rows = [
    { investment_id: "inv-2", earning_date: "2026-07-01", amount: 100, added_to_balance: false },
    { investment_id: "inv-2", earning_date: "2026-07-02", amount: 80, added_to_balance: false },
  ];
  const result = aggregateInvestmentEarnings(investment, rows, new Date("2026-07-08T00:00:00Z"));
  assert.equal(result.accumulated, 180);
  assert.equal(result.withdrawable, 180);
  assert.equal(result.locked, 0);
});

test("calculates equal daily earnings from the expected total return", () => {
  const metrics = calculateInvestmentPlanMetrics({ amount: 250, roiPercent: 40, durationDays: 7 });
  assert.equal(metrics.totalProfit, 100);
  assert.equal(metrics.totalReturn, 350);
  assert.equal(metrics.dailyEarning, 50);
  assert.equal(metrics.dailyEarning * 7, metrics.totalReturn);
});

test("handles rounding by placing any remainder on the last day", () => {
  const metrics = calculateInvestmentPlanMetrics({ amount: 100, roiPercent: 10, durationDays: 3 });
  assert.equal(metrics.totalProfit, 10);
  assert.equal(metrics.totalReturn, 110);
  assert.equal(metrics.dailyEarning, 36);
  assert.equal(metrics.finalDayEarning, 38);
  assert.equal(metrics.dailyEarning * 2 + metrics.finalDayEarning, metrics.totalReturn);
});

test("keeps the available balance anchored to the profile balance instead of double counting locked earnings", () => {
  const summary = summarizePortfolioBalance(500, [{ accumulated: 200, withdrawable: 100, locked: 100 }]);
  assert.equal(summary.availableBalance, 500);
  assert.equal(summary.accumulatedEarnings, 200);
  assert.equal(summary.withdrawableEarnings, 100);
  assert.equal(summary.lockedEarnings, 100);
});

test("returns a clear reason for blocked withdrawal", () => {
  const reason = getWithdrawalAvailabilityReason(100, 200, [{ locked: 50, isUnlocked: false }]);
  assert.match(reason, /locked/);
});

test("uses the profile balance as the withdrawable amount", () => {
  const available = getAvailableWithdrawalBalance(500, [{ withdrawable: 200, locked: 100, isUnlocked: false }]);
  assert.equal(available, 500);
});

test("calculates progress from the plan duration when end date is missing", () => {
  const progress = getPlanProgress("2026-07-01T00:00:00Z", null, 7, new Date("2026-07-04T00:00:00Z"));
  assert.equal(progress, 43);
});

test("locks a 90-day principal until the maturity date", () => {
  assert.equal(getWithdrawalUnlockDate("2026-07-06T00:00:00Z", 90), "2026-10-03");
  assert.equal(getWithdrawalUnlockState("2026-07-06T00:00:00Z", 90, new Date("2026-10-02T12:00:00Z")).isUnlocked, false);
  assert.equal(getWithdrawalUnlockState("2026-07-06T00:00:00Z", 90, new Date("2026-10-03T12:00:00Z")).isUnlocked, true);
});

test("calculates the USD withdrawal fee without rounding the requested amount", () => {
  assert.deepEqual(calculateWithdrawalFee(100, 1), { fee: 1, netAmount: 99 });
});

test("uses the USD 20% weekly profit and 7-day accrual model for Bronze", () => {
  const metrics = calculateInvestmentPlanMetrics({ amount: 100, roiPercent: 20, durationDays: 90 });
  assert.equal(metrics.weeklyProfit, 20);
  assert.equal(metrics.dailyEarning, 20 / 7);
  assert.equal(metrics.completeCycles, 12);
  assert.equal(metrics.remainingDays, 6);
  assert.equal(metrics.totalProfit, 257.14);
});

test("uses the USD 20% weekly profit and 7-day accrual model for Silver", () => {
  const metrics = calculateInvestmentPlanMetrics({ amount: 250, roiPercent: 20, durationDays: 90 });
  assert.equal(metrics.weeklyProfit, 50);
  assert.equal(metrics.dailyEarning, 50 / 7);
  assert.equal(metrics.completeCycles, 12);
  assert.equal(metrics.remainingDays, 6);
  assert.equal(metrics.totalProfit, 642.86);
});

test("uses the USD 20% weekly profit and 7-day accrual model for Gold", () => {
  const metrics = calculateInvestmentPlanMetrics({ amount: 500, roiPercent: 20, durationDays: 90 });
  assert.equal(metrics.weeklyProfit, 100);
  assert.equal(metrics.dailyEarning, 100 / 7);
  assert.equal(metrics.completeCycles, 12);
  assert.equal(metrics.remainingDays, 6);
  assert.equal(metrics.totalProfit, 1285.71);
});
