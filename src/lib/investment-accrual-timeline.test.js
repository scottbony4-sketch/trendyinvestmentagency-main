import test from "node:test";
import assert from "node:assert/strict";
import { getInvestmentAccrualTimeline, getInvestmentEarningsSnapshot } from "./investment-accrual-timeline.js";

const bronze = { id: "bronze", plan_amount: 100, profit_rate: 20, daily_profit: 20 / 7, weekly_profit: 20, duration_days: 90, start_at: "2026-09-01T00:00:00Z", end_at: "2026-11-30T00:00:00Z", status: "active" };
const silver = { ...bronze, id: "silver", plan_amount: 250, daily_profit: 50 / 7, weekly_profit: 50 };
const gold = { ...bronze, id: "gold", plan_amount: 500, daily_profit: 100 / 7, weekly_profit: 100 };

test("builds deterministic Bronze accrual points", () => {
  const points = getInvestmentAccrualTimeline(bronze, [], new Date("2026-09-07T00:00:00Z"), "ALL");
  assert.equal(points.length, 7);
  assert.equal(Number(points[6].accruedProfit.toFixed(2)), 20);
});

test("uses configured daily profit for Silver and Gold", () => {
  assert.equal(Number(getInvestmentEarningsSnapshot(silver, [], new Date("2026-09-05T00:00:00Z")).weeklyEarnings.toFixed(2)), 50);
  assert.equal(Number(getInvestmentEarningsSnapshot(gold, [], new Date("2026-09-05T00:00:00Z")).dailyAccrual.toFixed(2)), 14.29);
});

test("prefers recorded accrual rows over calculated values", () => {
  const rows = [{ investment_id: bronze.id, earning_date: "2026-09-01", amount: 3.25 }];
  const points = getInvestmentAccrualTimeline(bronze, rows, new Date("2026-09-01T00:00:00Z"), "ALL");
  assert.equal(points[0].accruedProfit, 3.25);
  assert.equal(points[0].calculated, false);
});
