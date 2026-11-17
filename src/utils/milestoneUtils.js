import { isMilestoneDate } from "../config/milestoneConfig.js";

export function milestoneQuarter(date) {
  return isMilestoneDate(date) ? Math.ceil(Number(date.slice(5, 7)) / 3) : null;
}

export function formatMilestoneDate(date, full = false) {
  if (!isMilestoneDate(date)) return "Invalid date";
  const [year, month, day] = date.split("-").map(Number);
  return new Intl.DateTimeFormat("en-US", {
    month: full ? "long" : "short", day: full ? "numeric" : "2-digit",
    ...(full ? { year: "numeric" } : {}), timeZone: "UTC",
  }).format(new Date(Date.UTC(year, month - 1, day)));
}

export function filterMilestones(items, { year, quarter, domainIds }) {
  return items.filter(item =>
    (year === "all" || item.date.slice(0, 4) === String(year)) &&
    (quarter === "all" || milestoneQuarter(item.date) === Number(quarter)) &&
    (!domainIds.length || item.domainIds.some(id => domainIds.includes(id)))
  );
}

export function groupMilestones(items) {
  const groups = new Map();
  [...items].sort((a, b) => b.date.localeCompare(a.date) || a.id.localeCompare(b.id)).forEach(item => {
    const year = item.date.slice(0, 4);
    const quarter = milestoneQuarter(item.date);
    const key = `${year}-Q${quarter}`;
    if (!groups.has(key)) groups.set(key, { key, year, quarter, items: [] });
    groups.get(key).items.push(item);
  });
  return [...groups.values()];
}
