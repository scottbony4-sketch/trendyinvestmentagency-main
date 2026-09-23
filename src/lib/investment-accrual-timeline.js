const DAY_MS = 24 * 60 * 60 * 1000;

function asNumber(value, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function validDate(value) {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function startDateOf(investment) {
  return validDate(investment?.start_at || investment?.start_date || investment?.created_at);
}

function durationOf(investment) {
  return Math.max(1, asNumber(investment?.term_days || investment?.duration_days, 90));
}

function cycleDaysOf(investment) {
  return Math.max(1, asNumber(investment?.cycle_days, 7));
}

function dailyProfitOf(investment) {
  const direct = asNumber(investment?.daily_profit || investment?.daily_return);
  if (direct > 0) return direct;
  const weekly = asNumber(investment?.weekly_profit);
  if (weekly > 0) return weekly / cycleDaysOf(investment);
  return asNumber(investment?.plan_amount) * asNumber(investment?.profit_rate || investment?.roi_percent) / 100 / cycleDaysOf(investment);
}

function cycleBounds(investment, now) {
  const start = startDateOf(investment);
  const configuredStart = validDate(investment?.current_cycle_start);
  const configuredEnd = validDate(investment?.current_cycle_end);
  if (configuredStart && configuredEnd) return { start: configuredStart, end: configuredEnd };
  if (!start) return { start: null, end: null };
  const cycleDays = cycleDaysOf(investment);
  const elapsedCycles = Math.max(0, Math.floor((now.getTime() - start.getTime()) / (cycleDays * DAY_MS)));
  const currentStart = new Date(start.getTime() + elapsedCycles * cycleDays * DAY_MS);
  return { start: currentStart, end: new Date(currentStart.getTime() + cycleDays * DAY_MS) };
}

function cycleDay(investment, timestamp) {
  const bounds = cycleBounds(investment, timestamp);
  const cycleDays = cycleDaysOf(investment);
  if (!bounds.start) return 1;
  return Math.min(cycleDays, Math.max(1, Math.ceil((timestamp.getTime() - bounds.start.getTime()) / DAY_MS) + 1));
}

function recordedDailyRows(investment, rows) {
  const map = new Map();
  for (const row of Array.isArray(rows) ? rows : []) {
    if (!row || row.investment_id !== investment?.id || !row.earning_date) continue;
    const amount = asNumber(row.amount);
    if (!map.has(row.earning_date)) map.set(row.earning_date, amount);
  }
  return map;
}

function filterStart(now, filter) {
  if (filter === "24H") return new Date(now.getTime() - DAY_MS);
  if (filter === "7D") return new Date(now.getTime() - 7 * DAY_MS);
  if (filter === "30D") return new Date(now.getTime() - 30 * DAY_MS);
  if (filter === "90D") return new Date(now.getTime() - 90 * DAY_MS);
  return null;
}

export function getInvestmentAccrualTimeline(investment, earningRows = [], now = new Date(), filter = "ALL") {
  const current = validDate(now) || new Date();
  const start = startDateOf(investment);
  if (!start) return [];
  const end = validDate(investment?.maturity_date || investment?.end_at) || new Date(start.getTime() + durationOf(investment) * DAY_MS);
  const last = new Date(Math.min(current.getTime(), end.getTime()));
  if (last < start) return [{ timestamp: start.toISOString(), accruedProfit: 0, dailyAccrual: 0, cycleDay: 1, calculated: true }];

  const dailyProfit = dailyProfitOf(investment);
  const recorded = recordedDailyRows(investment, earningRows);
  const points = [];
  let cumulative = 0;
  const totalDays = Math.max(1, Math.ceil((end.getTime() - start.getTime()) / DAY_MS));
  const dayCount = Math.min(totalDays, Math.floor((last.getTime() - start.getTime()) / DAY_MS) + 1);

  for (let index = 0; index < dayCount; index += 1) {
    const timestamp = new Date(Math.min(start.getTime() + index * DAY_MS, last.getTime()));
    const dateKey = timestamp.toLocaleDateString("en-CA", { timeZone: "Africa/Nairobi" });
    const amount = recorded.has(dateKey) ? recorded.get(dateKey) : dailyProfit;
    cumulative += amount;
    points.push({
      timestamp: timestamp.toISOString(),
      accruedProfit: Number(cumulative.toFixed(6)),
      dailyAccrual: Number(amount.toFixed(6)),
      cycleDay: cycleDay(investment, timestamp),
      calculated: !recorded.has(dateKey),
    });
  }

  const windowStart = filterStart(current, filter);
  const filteredPoints = points.filter((point) => !windowStart || new Date(point.timestamp) >= windowStart);
  return filteredPoints.length > 0 ? filteredPoints : points.slice(-1);
}

export function getInvestmentEarningsSnapshot(investment, earningRows = [], now = new Date()) {
  const current = validDate(now) || new Date();
  const timeline = getInvestmentAccrualTimeline(investment, earningRows, current, "ALL");
  const bounds = cycleBounds(investment, current);
  const cycleDays = cycleDaysOf(investment);
  const dailyProfit = dailyProfitOf(investment);
  const cycleProfit = asNumber(investment?.weekly_profit) || dailyProfit * cycleDays;
  const latest = timeline[timeline.length - 1];
  const cycleStart = bounds.start || current;
  const cycleDayNumber = Math.min(cycleDays, Math.max(1, Math.ceil((current.getTime() - cycleStart.getTime()) / DAY_MS) + 1));
  const cycleEarnings = Math.min(cycleProfit, dailyProfit * cycleDayNumber);
  const status = investment?.status === "completed" || investment?.status === "matured"
    ? "matured"
    : investment?.status === "active"
      ? "active"
      : "inactive";

  return {
    currentEarnings: latest?.dailyAccrual || 0,
    dailyAccrual: dailyProfit,
    weeklyEarnings: cycleProfit,
    cycleDays,
    totalAccrued: asNumber(investment?.total_accrued_profit) || latest?.accruedProfit || 0,
    nextPayout: cycleProfit,
    cycleDay: cycleDayNumber,
    cycleEarnings,
    cycleTotal: cycleProfit,
    cycleStart,
    cycleEnd: bounds.end,
    status,
    timeline,
  };
}

export function formatCountdown(end, now = new Date()) {
  const endDate = validDate(end);
  if (!endDate) return "—";
  const remaining = endDate.getTime() - now.getTime();
  if (remaining <= 0) return "Matured";
  const days = Math.floor(remaining / DAY_MS);
  const hours = Math.floor((remaining % DAY_MS) / 3600000);
  const minutes = Math.floor((remaining % 3600000) / 60000);
  return `${days}d ${hours}h ${minutes}m`;
}
