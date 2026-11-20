export const metrics = [
  ["sessions", "Sessions"], ["totalUsers", "Total users"], ["newUsers", "New users"],
  ["purchaseRevenue", "Purchase revenue"], ["ecommercePurchases", "Purchases"],
  ["sessionKeyEventRate", "Conversion rate"], ["averagePurchaseRevenue", "Avg. order value"],
];

export function comparisonChange(key, current, previous) {
  if (!Number.isFinite(current) || !Number.isFinite(previous)) return null;
  if (key === "sessionKeyEventRate") return (current - previous) * 100;
  return previous > 0 ? (current - previous) / previous * 100 : null;
}

export function shiftDate(date, days) {
  const day = new Date(`${date}T00:00:00Z`);
  day.setUTCDate(day.getUTCDate() + days);
  return day.toISOString().slice(0, 10);
}

export function reportingDate(now, timeZone) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone, year: "numeric", month: "2-digit", day: "2-digit",
  }).formatToParts(now);
  const part = name => parts.find(item => item.type === name).value;
  return `${part("year")}-${part("month")}-${part("day")}`;
}

export function reportingWindows(today) {
  const range = (start, end) => ({ startDate: shiftDate(today, start), endDate: shiftDate(today, end) });
  return {
    day: range(-1, -1), prior_day: range(-8, -8), week: range(-7, -1),
    prior_week: range(-14, -8), yoy_day: range(-365, -365), yoy_week: range(-371, -365),
  };
}
