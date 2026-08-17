/**
 * Communities Operations Timeline — data helpers.
 *
 * The backend row is deliberately dumb (11 text columns) so logging an event
 * takes a minute. Everything expensive — parsing "33 hrs" into a bar length,
 * turning "$$$" into an impact tier, laying events out on a time axis — happens
 * here so the sheet never has to.
 */
import {
  getEventColor,
  resolveIncidentSeverity,
  resolveIncidentStatus,
  resolveIncidentType,
  resolveIncidentTypeDefinitions,
} from "../config/incidentConfig";
import { getDomainNameMap } from "./roadmapUtils";

export const MINUTE_MS = 60 * 1000;
export const HOUR_MS = 60 * MINUTE_MS;
export const DAY_MS = 24 * HOUR_MS;

export const ZOOM_LEVELS = [
  { id: "month", label: "Months" },
  { id: "week", label: "Weeks" },
  { id: "day", label: "Days" },
  { id: "hour", label: "Hours" },
];

/* ------------------------------- parsing -------------------------------- */

/**
 * Accepts what people actually type or what Sheets hands back:
 * "2026-06-25", "2026-06-25 09:15", "6/25/26", "6/25/2026 9:15 PM", a Date,
 * or a full ISO timestamp. Bare dates are read as local midnight.
 */
export function parseIncidentDate(value) {
  if (!value && value !== 0) return null;
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value;

  const raw = String(value).trim();
  if (!raw) return null;

  // Explicit timezone (…Z / +05:30) — let the engine handle the offset.
  if (/\d{2}:\d{2}(:\d{2})?(\.\d+)?(Z|[+-]\d{2}:?\d{2})$/.test(raw)) {
    const d = new Date(raw);
    return Number.isNaN(d.getTime()) ? null : d;
  }

  let m = raw.match(/^(\d{4})-(\d{1,2})-(\d{1,2})(?:[T ](\d{1,2}):(\d{2}))?/);
  if (m) {
    return new Date(+m[1], +m[2] - 1, +m[3], +(m[4] || 0), +(m[5] || 0));
  }

  m = raw.match(/^(\d{1,2})[/.](\d{1,2})[/.](\d{2,4})(?:[ ,]+(\d{1,2}):(\d{2}))?\s*(am|pm)?/i);
  if (m) {
    const year = +m[3] < 100 ? 2000 + +m[3] : +m[3];
    let hours = +(m[4] || 0);
    const meridiem = (m[6] || "").toLowerCase();
    if (meridiem === "pm" && hours < 12) hours += 12;
    if (meridiem === "am" && hours === 12) hours = 0;
    return new Date(year, +m[1] - 1, +m[2], hours, +(m[5] || 0));
  }

  const fallback = new Date(raw);
  return Number.isNaN(fallback.getTime()) ? null : fallback;
}

/** True when the raw Date cell carried a time, not just a calendar day. */
export function dateValueHasTime(value) {
  if (value instanceof Date) return value.getHours() !== 0 || value.getMinutes() !== 0;
  return /\d{1,2}:\d{2}/.test(String(value || ""));
}

/**
 * "33 hrs" → 1980. Also handles "2h 30m", "45m", "1d 4h", "1:30" and a bare
 * number (read as hours, matching how people log "4" for a four-hour outage).
 * Returns null for blank / "ongoing" — the caller decides what that means.
 */
export function parseDurationMinutes(value) {
  if (value === 0) return 0;
  if (value === null || value === undefined) return null;
  if (typeof value === "number") return Math.round(value * 60);

  const raw = String(value).trim().toLowerCase();
  if (!raw || /^(ongoing|active|tbd|unknown|n\/?a|-|—)$/.test(raw)) return null;

  let total = 0;
  let matched = false;
  const re = /(\d+(?:\.\d+)?)\s*(days?|d|hours?|hrs?|h|minutes?|mins?|m)\b/g;
  let hit;
  while ((hit = re.exec(raw)) !== null) {
    matched = true;
    const amount = parseFloat(hit[1]);
    const unit = hit[2][0];
    if (unit === "d") total += amount * 1440;
    else if (unit === "h") total += amount * 60;
    else total += amount;
  }
  if (matched) return Math.round(total);

  const clock = raw.match(/^(\d+):(\d{2})$/);
  if (clock) return +clock[1] * 60 + +clock[2];

  const bare = parseFloat(raw.replace(/[^0-9.]/g, ""));
  return Number.isNaN(bare) ? null : Math.round(bare * 60);
}

/** 1980 → "33h". Compact on purpose: these sit inside timeline bars. */
export function formatDuration(minutes) {
  if (minutes === null || minutes === undefined) return "—";
  const total = Math.max(0, Math.round(minutes));
  if (total < 60) return `${total}m`;
  const hours = Math.floor(total / 60);
  const mins = total % 60;
  if (hours < 48) return mins ? `${hours}h ${mins}m` : `${hours}h`;
  const days = Math.floor(hours / 24);
  const restHours = hours % 24;
  return restHours ? `${days}d ${restHours}h` : `${days}d`;
}

function tierFromAmount(amount) {
  if (amount >= 100000) return 4;
  if (amount >= 25000) return 3;
  if (amount >= 5000) return 2;
  if (amount > 0) return 1;
  return 0;
}

/**
 * Revenue impact is logged either as a dollar figure ("$52,000") or as a
 * quick tier ("$$$"). Both are kept: tiers can be logged in seconds, amounts
 * roll up into the KPI card.
 */
export function parseRevenue(value) {
  const raw = String(value ?? "").trim();
  if (!raw) return { raw: "", amount: 0, tier: 0, symbolic: false };
  if (/^\$+$/.test(raw)) return { raw, amount: 0, tier: Math.min(4, raw.length), symbolic: true };

  const digits = raw.replace(/[^0-9.]/g, "");
  if (digits && !Number.isNaN(Number(digits))) {
    const amount = Number(digits);
    return { raw, amount, tier: tierFromAmount(amount), symbolic: false };
  }
  return { raw, amount: 0, tier: 0, symbolic: true };
}

/** Black or white label text, whichever stays readable on a colored bar. */
export function contrastText(hex) {
  const clean = String(hex || "").replace("#", "");
  if (clean.length !== 6) return "#ffffff";
  const channel = (start) => {
    const v = parseInt(clean.slice(start, start + 2), 16) / 255;
    return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
  };
  const luminance = 0.2126 * channel(0) + 0.7152 * channel(2) + 0.0722 * channel(4);
  // Above ~0.3 relative luminance (ambers, greens, light grays) dark text wins
  // by a wide margin; below it — reds, blues, purples — white reads better.
  return luminance > 0.3 ? "#101418" : "#ffffff";
}

export function hexToRgba(hex, alpha) {
  const clean = String(hex || "").replace("#", "");
  if (clean.length !== 6) return `rgba(100, 116, 139, ${alpha})`;
  const r = parseInt(clean.slice(0, 2), 16);
  const g = parseInt(clean.slice(2, 4), 16);
  const b = parseInt(clean.slice(4, 6), 16);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

export function formatMoney(amount) {
  return `$${Math.round(amount).toLocaleString("en-US")}`;
}

/**
 * Links cell: one per line, or comma / semicolon / " / " separated.
 * "Incident Report" stays a plain label; "https://…" becomes a link;
 * "Jira | https://…" and "[Jira](https://…)" carry both.
 */
export function parseLinks(value) {
  const raw = String(value ?? "").trim();
  if (!raw) return [];
  // Split on newlines/commas/semicolons, then on a *spaced* slash
  // ("Incident Report / Slack"). A URL never contains a space, so its own
  // slashes are never touched.
  return raw
    .split(/[\n,;]+/)
    .flatMap((part) => part.split(/\s+\/\s+/))
    .map((part) => part.trim())
    .filter(Boolean)
    .map((part) => {
      const md = part.match(/^\[([^\]]+)\]\(([^)]+)\)$/);
      if (md) return { label: md[1].trim(), url: md[2].trim() };
      const piped = part.match(/^(.+?)\s*[|]\s*(https?:\/\/\S+)$/i);
      if (piped) return { label: piped[1].trim(), url: piped[2].trim() };
      const labeled = part.match(/^(.+?):\s*(https?:\/\/\S+)$/i);
      if (labeled) return { label: labeled[1].trim(), url: labeled[2].trim() };
      if (/^https?:\/\//i.test(part)) {
        let label = part;
        try {
          label = new URL(part).hostname.replace(/^www\./, "");
        } catch {
          /* keep the raw string */
        }
        return { label, url: part };
      }
      return { label: part, url: "" };
    });
}

/* ------------------------------ normalizing ------------------------------ */

export function domainKeyOf(value) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, " ");
}

/**
 * One sheet row → everything the UI needs, already parsed and colored.
 * `nowMs` is passed in so a whole render pass shares one clock.
 */
export function normalizeIncident(
  raw,
  index,
  { domainNames = {}, nowMs = Date.now(), typeDefs = undefined } = {}
) {
  // `Start` is authoritative; `Date` is the original single-column form and is
  // still accepted so existing sheet rows keep working untouched.
  const rawStart = raw.start ?? raw.date ?? "";
  const rawEnd = raw.end ?? "";
  const start = parseIncidentDate(rawStart);
  const end = parseIncidentDate(rawEnd);
  const type = resolveIncidentType(raw.type, typeDefs);
  const severity = resolveIncidentSeverity(raw.severity);
  const status = resolveIncidentStatus(raw.status);
  const explicitDuration = parseDurationMinutes(raw.duration);

  const rawDomain = String(raw.domain || "").trim();
  const key = domainKeyOf(rawDomain) || "unassigned";
  const domainLabel = rawDomain || "Unassigned";

  const startMs = start ? start.getTime() : null;
  // An end before its start is bad data, not a negative event — ignore it and
  // fall back to the Duration column.
  const endValid = end && startMs !== null && end.getTime() >= startMs;
  const endMsGiven = endValid ? end.getTime() : null;
  const invertedRange = Boolean(end && startMs !== null && end.getTime() < startMs);

  // Start + End wins over Duration: two timestamps are unambiguous, and it is
  // what people actually know after an outage.
  const durationMinutes =
    endMsGiven !== null
      ? Math.round((endMsGiven - startMs) / MINUTE_MS)
      : explicitDuration;

  // No end and no duration on a still-open event means "running right now": the
  // bar grows to the current time instead of collapsing to a dot.
  const ongoing = durationMinutes === null && status.open;
  const elapsed = ongoing && startMs !== null ? Math.max(0, nowMs - startMs) : 0;
  const spanMs = durationMinutes !== null ? durationMinutes * MINUTE_MS : elapsed;

  return {
    id: String(raw.id || "").trim() || `row-${index + 1}`,
    title: String(raw.title || "").trim() || "(untitled event)",
    rawStart,
    rawEnd,
    rawDate: rawStart,
    hasTime: dateValueHasTime(rawStart),
    hasEndTime: dateValueHasTime(rawEnd),
    start,
    end: endMsGiven === null ? null : end,
    startMs,
    endMs: startMs === null ? null : startMs + spanMs,
    durationMinutes,
    durationFromRange: endMsGiven !== null,
    invertedRange,
    effectiveMinutes: durationMinutes !== null ? durationMinutes : Math.round(elapsed / MINUTE_MS),
    ongoing,
    domain: rawDomain,
    domainKey: key,
    domainLabel: domainNames[key] || domainLabel,
    type,
    severity,
    status,
    cause: String(raw.cause || "").trim(),
    customerImpact: String(raw.customerImpact || "").trim(),
    revenue: parseRevenue(raw.revenueImpact),
    notes: String(raw.notes || "").trim(),
    links: parseLinks(raw.links),
    rawLinks: String(raw.links ?? ""),
    color: getEventColor(type, severity),
    isIncident: !type.planned,
  };
}

/** All incidents from the payload, normalized and newest-first. */
export function getIncidents(data, nowMs = Date.now()) {
  const rows = Array.isArray(data?.incidents) ? data.incidents : [];
  const nameMap = getDomainNameMap(data || {});
  const domainNames = {};
  Object.entries(nameMap).forEach(([id, name]) => {
    domainNames[domainKeyOf(id)] = name;
    domainNames[domainKeyOf(name)] = name;
  });
  // Types come from the Incident Config tab, so a row's Type resolves against
  // the same list the filters and the Add form offer.
  const typeDefs = resolveIncidentTypeDefinitions(data?.incidentConfig);

  return rows
    .map((row, i) => normalizeIncident(row, i, { domainNames, nowMs, typeDefs }))
    .filter((row) => row.startMs !== null)
    .sort((a, b) => b.startMs - a.startMs);
}

/** Next free sequential id (INC-0001, INC-0002, …) — the form never asks. */
export function nextIncidentId(rows) {
  let max = 0;
  (rows || []).forEach((row) => {
    const m = String(row?.id || "").match(/(\d+)\s*$/);
    if (m) max = Math.max(max, parseInt(m[1], 10));
  });
  return `INC-${String(max + 1).padStart(4, "0")}`;
}

/* ------------------------------- filtering ------------------------------- */

export const INITIAL_INCIDENT_FILTERS = {
  year: "all",
  domains: null,
  severities: null,
  types: null,
  statuses: null,
  // { [type label]: Set<cause label> } — one entry per type that has a cause
  // selected, so the pill rows stay in step with a config-driven type list.
  causes: null,
  search: "",
};

export function getIncidentYears(entries) {
  const years = new Set();
  entries.forEach((e) => years.add(new Date(e.startMs).getFullYear()));
  return [...years].sort((a, b) => b - a);
}

function matchesSet(set, value) {
  return !set || set.size === 0 || set.has(value);
}

/** Type labels that currently have at least one cause pill selected. */
function selectedCauseTypes(causes) {
  if (!causes) return [];
  return Object.keys(causes).filter((label) => causes[label] && causes[label].size > 0);
}

/**
 * Cause pills narrow within a type and union across types: picking "Bot Attack"
 * under Outage and "Release" under Track Event shows both, rather than asking
 * one event to be of two types at once.
 */
function matchesCauses(entry, causes) {
  const active = selectedCauseTypes(causes);
  if (active.length === 0) return true;
  const set = causes[entry.type.label];
  return Boolean(set && set.size > 0 && set.has(entry.cause));
}

export function filterIncidents(entries, filters) {
  const query = String(filters.search || "").trim().toLowerCase();
  return entries.filter((e) => {
    if (filters.year !== "all" && new Date(e.startMs).getFullYear() !== Number(filters.year)) {
      return false;
    }
    if (!matchesSet(filters.domains, e.domainKey)) return false;
    if (!matchesSet(filters.severities, e.severity.label)) return false;
    if (!matchesSet(filters.types, e.type.label)) return false;
    if (!matchesSet(filters.statuses, e.status.label)) return false;
    if (!matchesCauses(e, filters.causes)) return false;
    if (query) {
      const haystack = [
        e.title,
        e.domainLabel,
        e.customerImpact,
        e.notes,
        e.type.label,
        e.cause,
        e.id,
      ]
        .join(" ")
        .toLowerCase();
      if (!haystack.includes(query)) return false;
    }
    return true;
  });
}

export function isIncidentFilterActive(filters) {
  return (
    filters.year !== "all" ||
    (filters.domains && filters.domains.size > 0) ||
    (filters.severities && filters.severities.size > 0) ||
    (filters.types && filters.types.size > 0) ||
    (filters.statuses && filters.statuses.size > 0) ||
    selectedCauseTypes(filters.causes).length > 0 ||
    Boolean(String(filters.search || "").trim())
  );
}

/* -------------------------------- summary -------------------------------- */

/**
 * KPI numbers. `scoped` respects the active filters; `all` is every event, so
 * an open incident from last year still shows up on the "Open" card.
 */
function countBySeverity(entries) {
  const counts = { Critical: 0, High: 0, Medium: 0, Low: 0, Other: 0 };
  entries.forEach((e) => {
    const key = e.severity.label;
    if (counts[key] === undefined) counts.Other += 1;
    else counts[key] += 1;
  });
  return counts;
}

/** "High: 4 · Medium: 5 · Low: 3" — only the severities actually present. */
export function formatSeverityBreakdown(counts, short = false) {
  const labels = short
    ? { Critical: "Crit", High: "High", Medium: "Med", Low: "Low", Other: "Other" }
    : { Critical: "Critical", High: "High", Medium: "Medium", Low: "Low", Other: "Other" };
  return Object.keys(counts)
    .filter((key) => counts[key] > 0)
    .map((key) => `${labels[key]}: ${counts[key]}`)
    .join(" · ");
}

/** "RLMS, RLP, Relias Academy + 4" */
export function formatDomainList(labels, max = 3) {
  const sorted = [...labels].sort((a, b) => a.localeCompare(b));
  if (sorted.length === 0) return "None affected";
  if (sorted.length <= max) return sorted.join(", ");
  return `${sorted.slice(0, max).join(", ")} + ${sorted.length - max}`;
}

export function computeIncidentStats(scoped, all) {
  const open = all.filter((e) => e.status.open && e.isIncident);
  const incidents = scoped.filter((e) => e.isIncident);
  const highPlus = incidents.filter((e) => e.severity.rank >= 3);
  const critical = incidents.filter((e) => e.severity.rank === 4);

  const downtimeMinutes = incidents.reduce((sum, e) => sum + (e.effectiveMinutes || 0), 0);

  let revenueAmount = 0;
  let symbolicCount = 0;
  scoped.forEach((e) => {
    if (e.revenue.symbolic && e.revenue.tier > 0) symbolicCount += 1;
    revenueAmount += e.revenue.amount;
  });

  const resolved = incidents.filter((e) => !e.status.open && e.durationMinutes !== null);
  const mttrMinutes = resolved.length
    ? Math.round(resolved.reduce((sum, e) => sum + e.durationMinutes, 0) / resolved.length)
    : null;

  const domainLabels = [...new Set(incidents.map((e) => e.domainLabel))];

  return {
    openCount: open.length,
    activeCount: open.filter((e) => e.status.id === "active").length,
    monitoringCount: open.filter((e) => e.status.id === "monitoring").length,
    openSeverity: countBySeverity(open),
    incidentCount: incidents.length,
    severity: countBySeverity(incidents),
    highPlusCount: highPlus.length,
    criticalCount: critical.length,
    plannedCount: scoped.length - incidents.length,
    downtimeMinutes,
    revenueAmount,
    symbolicCount,
    mttrMinutes,
    domainCount: domainLabels.length,
    domainLabels,
    totalCount: scoped.length,
  };
}

/* ------------------------------ time window ------------------------------ */

export function startOfDay(ms) {
  const d = new Date(ms);
  d.setHours(0, 0, 0, 0);
  return d;
}

export function startOfWeek(ms) {
  const d = startOfDay(ms);
  const day = d.getDay(); // 0 = Sunday
  d.setDate(d.getDate() - day);
  return d;
}

export function startOfMonth(ms) {
  const d = new Date(ms);
  return new Date(d.getFullYear(), d.getMonth(), 1);
}

const WEEKS_IN_VIEW = 12;
const DAYS_IN_VIEW = 7;
const MONTHS_IN_VIEW = 12;

/**
 * The slice of time the timeline draws. Month zoom snaps to the selected
 * calendar year so "2026" means Jan–Dec; week zoom centers on the anchor,
 * while day zoom ends on the anchor date.
 */
export function buildTimelineWindow(zoom, anchorMs, year = "all") {
  if (zoom === "hour") {
    const start = startOfDay(anchorMs);
    const end = new Date(start);
    end.setDate(end.getDate() + 1);
    return { startMs: start.getTime(), endMs: end.getTime() };
  }

  if (zoom === "day") {
    const start = startOfDay(anchorMs);
    start.setDate(start.getDate() - DAYS_IN_VIEW + 1);
    const end = new Date(start);
    end.setDate(end.getDate() + DAYS_IN_VIEW);
    return { startMs: start.getTime(), endMs: end.getTime() };
  }

  if (zoom === "week") {
    const start = startOfWeek(anchorMs);
    start.setDate(start.getDate() - 7 * (Math.floor(WEEKS_IN_VIEW / 2) - 1));
    const end = new Date(start);
    end.setDate(end.getDate() + 7 * WEEKS_IN_VIEW);
    return { startMs: start.getTime(), endMs: end.getTime() };
  }

  if (year !== "all" && Number.isFinite(Number(year))) {
    const y = Number(year);
    return { startMs: new Date(y, 0, 1).getTime(), endMs: new Date(y + 1, 0, 1).getTime() };
  }

  const anchor = new Date(anchorMs);
  const start = new Date(anchor.getFullYear(), anchor.getMonth() - (MONTHS_IN_VIEW - 1), 1);
  const end = new Date(anchor.getFullYear(), anchor.getMonth() + 1, 1);
  return { startMs: start.getTime(), endMs: end.getTime() };
}

/** How far prev/next moves the window, in ms. */
export function windowStep(zoom, window) {
  if (zoom === "hour") return DAY_MS;
  if (zoom === "day") return DAYS_IN_VIEW * DAY_MS;
  if (zoom === "week") return WEEKS_IN_VIEW * 7 * DAY_MS;
  return window.endMs - window.startMs;
}

const MONTH_SHORT = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const DAY_SHORT = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

/**
 * Column ticks. Each carries its real duration so the grid can size columns
 * proportionally (`fr` units) — a 28-day February must not be as wide as March,
 * or bars would drift away from their headers.
 */
export function buildTicks(window, zoom) {
  const ticks = [];
  if (zoom === "hour") {
    const cursor = new Date(window.startMs);
    while (cursor.getTime() < window.endMs) {
      const nextMs = Math.min(cursor.getTime() + HOUR_MS, window.endMs);
      ticks.push({
        key: `h-${cursor.getTime()}`,
        startMs: cursor.getTime(),
        endMs: nextMs,
        label: cursor.toLocaleTimeString("en-US", { hour: "numeric" }),
        sub: "",
        group: cursor.toLocaleDateString("en-US", {
          weekday: "long",
          month: "short",
          day: "numeric",
          year: "numeric",
        }),
      });
      cursor.setTime(nextMs);
    }
    return ticks;
  }

  if (zoom === "day") {
    const cursor = startOfDay(window.startMs);
    while (cursor.getTime() < window.endMs) {
      const next = new Date(cursor);
      next.setDate(next.getDate() + 1);
      ticks.push({
        key: `d-${cursor.getTime()}`,
        startMs: cursor.getTime(),
        endMs: Math.min(next.getTime(), window.endMs),
        label: String(cursor.getDate()),
        sub: DAY_SHORT[cursor.getDay()],
        group: `${MONTH_SHORT[cursor.getMonth()]} ${cursor.getFullYear()}`,
        weekend: cursor.getDay() === 0 || cursor.getDay() === 6,
      });
      cursor.setDate(cursor.getDate() + 1);
    }
    return ticks;
  }

  if (zoom === "week") {
    const cursor = startOfWeek(window.startMs);
    while (cursor.getTime() < window.endMs) {
      const next = new Date(cursor);
      next.setDate(next.getDate() + 7);
      ticks.push({
        key: `w-${cursor.getTime()}`,
        startMs: cursor.getTime(),
        endMs: Math.min(next.getTime(), window.endMs),
        label: `${MONTH_SHORT[cursor.getMonth()]} ${cursor.getDate()}`,
        sub: "",
        group: `${MONTH_SHORT[cursor.getMonth()]} ${cursor.getFullYear()}`,
      });
      cursor.setDate(cursor.getDate() + 7);
    }
    return ticks;
  }

  const cursor = startOfMonth(window.startMs);
  while (cursor.getTime() < window.endMs) {
    const next = new Date(cursor.getFullYear(), cursor.getMonth() + 1, 1);
    ticks.push({
      key: `m-${cursor.getTime()}`,
      startMs: cursor.getTime(),
      endMs: Math.min(next.getTime(), window.endMs),
      label: MONTH_SHORT[cursor.getMonth()],
      sub: "",
      group: String(cursor.getFullYear()),
    });
    cursor.setMonth(cursor.getMonth() + 1);
  }
  return ticks;
}

/** Collapse consecutive ticks that share a group into one header cell. */
export function buildTickGroups(ticks) {
  const groups = [];
  ticks.forEach((tick) => {
    const last = groups[groups.length - 1];
    if (last && last.label === tick.group) last.span += 1;
    else groups.push({ label: tick.group, span: 1, key: `${tick.group}-${tick.key}` });
  });
  return groups;
}

/* -------------------------------- layout --------------------------------- */

/** Percent offset of a timestamp inside the window (clamped to 0–100). */
export function positionInWindow(ms, window) {
  const span = window.endMs - window.startMs;
  if (span <= 0) return 0;
  return Math.max(0, Math.min(100, ((ms - window.startMs) / span) * 100));
}

export function overlapsWindow(entry, window) {
  const end = Math.max(entry.endMs ?? entry.startMs, entry.startMs);
  return entry.startMs < window.endMs && end >= window.startMs;
}

/**
 * Stack overlapping events in a domain row. `minSpanMs` keeps very short
 * events (which still render at a minimum bar width) from being packed onto
 * the same lane and visually colliding.
 */
export function assignIncidentLanes(entries, minSpanMs = 0) {
  const lanes = [];
  const placed = entries
    .slice()
    .sort((a, b) => a.startMs - b.startMs)
    .map((entry) => {
      const start = entry.startMs;
      const end = Math.max(entry.endMs ?? start, start + minSpanMs);
      let lane = 0;
      while (lanes[lane] !== undefined && lanes[lane] > start) lane += 1;
      lanes[lane] = end;
      return { ...entry, lane, laneStart: start, laneEnd: end };
    });
  return { entries: placed, laneCount: Math.max(1, lanes.length) };
}

/** Timeline rows: one per domain with at least one event inside the window. */
export function buildTimelineRows(entries, window, { minSpanMs = 0 } = {}) {
  const byDomain = new Map();
  entries.forEach((entry) => {
    if (!overlapsWindow(entry, window)) return;
    if (!byDomain.has(entry.domainKey)) {
      byDomain.set(entry.domainKey, { key: entry.domainKey, label: entry.domainLabel, items: [] });
    }
    byDomain.get(entry.domainKey).items.push(entry);
  });

  return [...byDomain.values()]
    .sort((a, b) => a.label.localeCompare(b.label))
    .map((row) => {
      const { entries: items, laneCount } = assignIncidentLanes(row.items, minSpanMs);
      return { ...row, items, laneCount };
    });
}

/* -------------------------------- display -------------------------------- */

export function formatEventDate(entry, { withTime = true } = {}) {
  if (!entry?.start) return "—";
  const date = entry.start.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
  if (!withTime || !entry.hasTime) return date;
  const time = entry.start.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
  return `${date}, ${time}`;
}

export function formatEventRange(entry) {
  if (!entry?.start) return "—";
  const start = formatEventDate(entry);
  if (entry.ongoing) return `${start} → ongoing`;
  if (!entry.durationMinutes) return start;
  const end = new Date(entry.endMs);
  const sameDay = end.toDateString() === entry.start.toDateString();
  const endLabel = sameDay
    ? end.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" })
    : end.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" }) +
      (entry.hasEndTime || entry.hasTime
        ? `, ${end.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" })}`
        : "");
  return `${start} → ${endLabel}`;
}

export function formatWindowLabel(window) {
  const opts = { month: "short", day: "numeric", year: "numeric" };
  const start = new Date(window.startMs).toLocaleDateString("en-US", opts);
  const end = new Date(window.endMs - 1).toLocaleDateString("en-US", opts);
  if (start === end) return start;
  return `${start} – ${end}`;
}

export function formatRevenue(revenue) {
  if (!revenue || !revenue.raw) return "—";
  if (revenue.symbolic) return revenue.raw;
  return formatMoney(revenue.amount);
}

/* --------------------------------- export -------------------------------- */

const CSV_HEADERS = [
  "ID",
  "Start",
  "End",
  "Domain",
  "Title",
  "Type",
  "Cause",
  "Severity",
  "Duration",
  "Customer Impact",
  "Revenue Impact",
  "Status",
  "Notes",
  "Links",
];

function csvCell(value) {
  const text = String(value ?? "");
  return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

/** Export exactly the sheet's columns, so a round-trip back into it is clean. */
export function incidentsToCsv(entries) {
  const lines = [CSV_HEADERS.join(",")];
  entries.forEach((e) => {
    lines.push(
      [
        e.id,
        e.rawStart,
        e.rawEnd,
        e.domain,
        e.title,
        e.type.label,
        e.cause,
        e.severity.label,
        e.durationMinutes === null ? (e.ongoing ? "Ongoing" : "") : formatDuration(e.durationMinutes),
        e.customerImpact,
        e.revenue.raw,
        e.status.label,
        e.notes,
        e.rawLinks.replace(/\n/g, " / "),
      ]
        .map(csvCell)
        .join(",")
    );
  });
  return lines.join("\n");
}

export function downloadCsv(filename, csv) {
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}
