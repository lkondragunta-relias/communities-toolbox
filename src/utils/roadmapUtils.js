import { applyStatusToInitiative, DEFAULT_STATUSES } from "../config/statusConfig";
import { resolveConfidence } from "../config/confidenceConfig";

export const RESERVED_DATA_KEYS = new Set([
  "meta",
  "quarters",
  "teams",
  "cohorts",
  "domains",
  "statuses",
  "priorities",
  "cookiebotSites",
  "cookiebotReports",
  "incidents",
  "org",
]);
export const DEFAULT_INITIATIVE_COLOR = "#64748b";

function getStatusDefinitions(data) {
  return data?.statuses?.length ? data.statuses : DEFAULT_STATUSES;
}

/** Align bar edges with header quarter columns (1px border between each column). */
export function timelinePositionToCss(position, quarterCount) {
  const n = Math.max(1, quarterCount);
  const full = Math.floor(position);
  const frac = position - full;
  const colExpr = `((100% - ${Math.max(0, n - 1)}px) / ${n})`;
  if (n === 1) return `calc(${position} * 100%)`;
  return `calc(${full} * (${colExpr} + 1px) + ${frac} * ${colExpr})`;
}

export function getDomainKeys(data) {
  return Object.keys(data).filter(
    (key) => !RESERVED_DATA_KEYS.has(key) && Array.isArray(data[key])
  );
}

/** @deprecated use getDomainKeys */
export const getTeamKeys = getDomainKeys;

export function formatDomainLabel(domainId) {
  return domainId.charAt(0).toUpperCase() + domainId.slice(1);
}

/** Map of domain id -> display name, from the domain definitions in the payload. */
export function getDomainNameMap(data) {
  const map = {};
  if (Array.isArray(data?.domains)) {
    data.domains.forEach((d) => {
      if (d && d.id) map[d.id] = d.name || formatDomainLabel(d.id);
    });
  }
  return map;
}

/** Display name for a domain: its defined name, falling back to the capitalized id. */
export function getDomainLabel(data, domainId) {
  return getDomainNameMap(data)[domainId] || formatDomainLabel(domainId);
}

/** @deprecated use formatDomainLabel */
export const formatTeamLabel = formatDomainLabel;

export function getDomainsForFilter(data) {
  const domainNames = getDomainNameMap(data);
  const domains = [{ id: "all", label: "All domains" }];
  getDomainKeys(data).forEach((id) => {
    domains.push({ id, label: domainNames[id] || formatDomainLabel(id) });
  });
  return domains;
}

/** Parse sheet/API value into team id list (comma-separated or legacy single cohort). */
export function parseInitiativeTeams(item) {
  if (!item) return [];
  if (Array.isArray(item.teams)) {
    return item.teams.map((t) => String(t).trim()).filter(Boolean);
  }
  const raw = item.teams ?? item.cohort;
  if (!raw) return [];
  return String(raw)
    .split(/[,;]/)
    .map((t) => t.trim())
    .filter(Boolean);
}

export function initiativeMatchesTeamsFilter(item, selectedTeams) {
  if (!selectedTeams || selectedTeams.size === 0) return true;
  const assigned = parseInitiativeTeams(item);
  if (assigned.length === 0) return false;
  return [...selectedTeams].some((id) => assigned.includes(id));
}

export function withDefaultColor(item, statusDefinitions) {
  return applyStatusToInitiative(item, statusDefinitions);
}

export function initiativeMatchesStatusFilter(item, selectedStatuses) {
  if (!selectedStatuses || selectedStatuses.size === 0) return true;
  const status = String(item?.status || "").trim();
  if (!status) return false;
  return [...selectedStatuses].some(
    (label) => label.toLowerCase() === status.toLowerCase()
  );
}

export function initiativeMatchesPriorityFilter(item, selectedPriorities) {
  if (!selectedPriorities || selectedPriorities.size === 0) return true;
  const priority = String(item?.priority || "").trim();
  if (!priority) return false;
  return [...selectedPriorities].some(
    (label) => label.toLowerCase() === priority.toLowerCase()
  );
}

export function initiativeMatchesConfidenceFilter(item, selectedConfidences) {
  if (!selectedConfidences || selectedConfidences.size === 0) return true;
  return selectedConfidences.has(resolveConfidence(item?.confidence));
}

export function isDoneStatus(status) {
  return /done|complete/i.test(String(status || "")) && !/close to done/i.test(String(status || ""));
}

export function isAtRiskStatus(status) {
  return /risk/i.test(String(status || ""));
}

/** Started but unfinished work: Done implies 100%, Future/blank implies not started. */
export function isProgressTrackable(status) {
  const s = String(status || "").trim();
  return Boolean(s) && !isDoneStatus(s) && !/^future$/i.test(s);
}

/** Whole-number percent 0-100, or null when the value is not a valid percentage. */
export function parseProgress(value) {
  const raw = String(value ?? "").trim().replace(/%$/, "").trim();
  if (!/^\d{1,3}$/.test(raw)) return null;
  const n = Number(raw);
  return n >= 0 && n <= 100 ? n : null;
}

/** Percent to display for an item: Done is always 100, otherwise the stored value clamped. */
export function displayProgress(item) {
  if (isDoneStatus(item?.status)) return 100;
  const n = Number(item?.progress);
  if (!Number.isFinite(n)) return 0;
  return Math.max(0, Math.min(100, Math.round(n)));
}

export function parseDate(value) {
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? null : d;
}

export function formatDisplayDate(iso) {
  const d = parseDate(iso);
  if (!d) return iso;
  return d.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

export function formatTimelineRange(timeline) {
  if (!Array.isArray(timeline) || timeline.length < 2) return "";
  const [start, end] = timeline;
  if (!start || !end) return "";
  return `${formatDisplayDate(start)} — ${formatDisplayDate(end)}`;
}

export function parseQuarterEnd(value) {
  if (!value) return null;
  // Parse in UTC ("Z") to match how bare "YYYY-MM-DD" start dates are parsed;
  // a local-time suffix would shift quarter boundaries by a day in UTC-negative
  // timezones (e.g. a 2026-04-01 start rendering inside Q1 in New York).
  const normalized = String(value).includes("T") ? value : `${value}T23:59:59Z`;
  return parseDate(normalized);
}

const CALENDAR_QUARTERS = [
  { label: "Q1", start: "01-01", end: "03-31" },
  { label: "Q2", start: "04-01", end: "06-30" },
  { label: "Q3", start: "07-01", end: "09-30" },
  { label: "Q4", start: "10-01", end: "12-31" },
];

export function collectTimelineDates(data) {
  const dates = [];
  getDomainKeys(data).forEach((key) => {
    (data[key] || []).forEach((item) => {
      if (Array.isArray(item.timeline)) {
        item.timeline.forEach((value) => {
          const parsed = parseDate(value);
          if (parsed) dates.push(parsed);
        });
      }
    });
  });
  return dates;
}

export function getYearBoundsFromData(data) {
  const dates = collectTimelineDates(data);
  if (dates.length === 0) {
    const year = new Date().getFullYear();
    return { minYear: year, maxYear: year };
  }
  const years = dates.map((d) => d.getFullYear());
  return { minYear: Math.min(...years), maxYear: Math.max(...years) };
}

export function buildQuartersForYearRange(minYear, maxYear) {
  const raw = [];
  for (let year = minYear; year <= maxYear; year++) {
    CALENDAR_QUARTERS.forEach(({ label, start, end }) => {
      raw.push({
        year,
        label,
        start: `${year}-${start}`,
        end: `${year}-${end}`,
      });
    });
  }
  return raw;
}

export function generateQuartersFromData(data) {
  const { minYear, maxYear } = getYearBoundsFromData(data);
  return buildQuartersForYearRange(minYear, maxYear);
}

function parseQuartersRaw(raw) {
  const quarters = raw.map((q) => ({
    year: q.year,
    label: q.label,
    start: parseDate(q.start),
    end: parseQuarterEnd(q.end),
  }));
  if (quarters.some((q) => !q.start || !q.end)) {
    throw new Error("Each quarter needs valid start and end dates");
  }
  return quarters;
}

export function setQuartersFromData(data) {
  const raw =
    Array.isArray(data.quarters) && data.quarters.length > 0
      ? data.quarters
      : generateQuartersFromData(data);

  if (!raw.length) {
    throw new Error("Could not build quarters — add initiatives with timeline dates");
  }

  return parseQuartersRaw(raw);
}

/** Minimum span on the 0..quarterCount timeline (fraction of one quarter). */
const MIN_TIMELINE_SPAN = 0.06;

function startOfDay(date) {
  const d = new Date(date);
  d.setHours(0, 0, 0, 0);
  return d;
}

function daysInclusive(from, to) {
  const ms = startOfDay(to).getTime() - startOfDay(from).getTime();
  return Math.floor(ms / 86400000) + 1;
}

/** 0 at quarter start, 1 at quarter end — bar begins on the start date. */
export function fractionAtQuarterStart(date, quarter) {
  const qStart = startOfDay(quarter.start);
  const qEnd = startOfDay(quarter.end);
  const d = startOfDay(date);
  const clamped = d < qStart ? qStart : d > qEnd ? qEnd : d;
  const totalDays = daysInclusive(qStart, qEnd);
  const dayIndex = daysInclusive(qStart, clamped);
  return Math.max(0, Math.min(1, (dayIndex - 1) / totalDays));
}

/** 0 at quarter start, 1 at quarter end — bar ends through the end date. */
export function fractionAtQuarterEnd(date, quarter) {
  const qStart = startOfDay(quarter.start);
  const qEnd = startOfDay(quarter.end);
  const d = startOfDay(date);
  const clamped = d < qStart ? qStart : d > qEnd ? qEnd : d;
  const totalDays = daysInclusive(qStart, qEnd);
  const dayIndex = daysInclusive(qStart, clamped);
  return Math.max(0, Math.min(1, dayIndex / totalDays));
}

/**
 * Position on a timeline where each quarter is one unit (0 .. quarters.length).
 */
export function dateToTimelinePosition(date, quarters, edge = "start") {
  if (!quarters.length) return 0;
  const d = parseDate(date);
  if (!d) return 0;

  for (let i = 0; i < quarters.length; i++) {
    const q = quarters[i];
    if (d >= q.start && d <= q.end) {
      const frac =
        edge === "end" ? fractionAtQuarterEnd(d, q) : fractionAtQuarterStart(d, q);
      return i + frac;
    }
  }

  if (d < quarters[0].start) return 0;
  return quarters.length;
}

export function spansOverlap(a, b) {
  return !(a.endPos <= b.startPos || b.endPos <= a.startPos);
}

export function dateToColumn(date, quarters) {
  const pos = dateToTimelinePosition(date, quarters, "start");
  return Math.min(quarters.length, Math.max(1, Math.floor(pos) + 1));
}

export function timelineToSpan(timeline, quarters) {
  const quarterCount = quarters.length;
  const fallback = {
    start: 1,
    end: 2,
    startPos: 0,
    endPos: Math.min(1, quarterCount),
    quarterCount,
  };

  if (!quarterCount) return fallback;

  const start = parseDate(timeline[0]);
  const end = parseDate(timeline[1]);
  if (!start || !end) return fallback;

  let startPos = dateToTimelinePosition(start, quarters, "start");
  let endPos = dateToTimelinePosition(end, quarters, "end");

  if (endPos <= startPos) {
    endPos = Math.min(quarterCount, startPos + MIN_TIMELINE_SPAN);
  } else if (endPos - startPos < MIN_TIMELINE_SPAN) {
    endPos = Math.min(quarterCount, startPos + MIN_TIMELINE_SPAN);
  }

  const colStart = Math.min(quarterCount, Math.max(1, Math.floor(startPos) + 1));
  const colEnd = Math.min(
    quarterCount + 1,
    Math.max(colStart + 1, Math.ceil(endPos) + 1)
  );

  return {
    start: colStart,
    end: colEnd,
    startPos,
    endPos,
    quarterCount,
  };
}

export function assignLanes(initiatives, quarters) {
  const lanes = [];
  return initiatives.map((item) => {
    const span = timelineToSpan(item.timeline || [], quarters);
    let lane = 0;
    while (lanes[lane] && lanes[lane].some((placed) => spansOverlap(span, placed))) {
      lane++;
    }
    if (!lanes[lane]) lanes[lane] = [];
    lanes[lane].push({ startPos: span.startPos, endPos: span.endPos });
    return { ...item, span, lane };
  });
}

export function buildYearSpans(quarters) {
  const spans = [];
  let i = 0;
  while (i < quarters.length) {
    const year = quarters[i].year;
    let count = 0;
    while (i + count < quarters.length && quarters[i + count].year === year) count++;
    spans.push({ year, count, startCol: i + 2 });
    i += count;
  }
  return spans;
}

export function getAllInitiatives(data) {
  const statusDefs = getStatusDefinitions(data);
  return getDomainKeys(data).flatMap((key) =>
    (data[key] || []).map((item) => withDefaultColor(item, statusDefs))
  );
}

/** True when an initiative's dates overlap the visible quarter range at all. */
export function initiativeInRange(item, quarters) {
  if (!quarters.length) return true;
  const start = parseDate(item?.timeline?.[0]);
  const end = parseQuarterEnd(item?.timeline?.[1]);
  if (!start || !end) return true;
  return end >= quarters[0].start && start <= quarters[quarters.length - 1].end;
}

export function getRoadmapRows(data, quarters) {
  const statusDefs = getStatusDefinitions(data);
  const domainNames = getDomainNameMap(data);
  const first = quarters[0]?.start;
  const last = quarters[quarters.length - 1]?.end;
  return getDomainKeys(data).map((key) => {
    const all = data[key] || [];
    const visible = all.filter((item) => initiativeInRange(item, quarters));
    return {
      id: key,
      label: domainNames[key] || formatDomainLabel(key),
      hiddenCount: all.length - visible.length,
      initiatives: assignLanes(
        visible.map((item) => {
          const start = parseDate(item?.timeline?.[0]);
          const end = parseQuarterEnd(item?.timeline?.[1]);
          return {
            ...withDefaultColor(item, statusDefs),
            clippedStart: Boolean(first && start && start < first),
            clippedEnd: Boolean(last && end && end > last),
          };
        }),
        quarters
      ),
    };
  });
}

/** Counts for a domain's at-a-glance summary. */
export function summarizeDomain(items, today = new Date()) {
  let inFlight = 0;
  let done = 0;
  let atRisk = 0;
  let upcoming = 0;
  (items || []).forEach((item) => {
    const h = horizonOf(item, today);
    if (isDoneStatus(item.status)) {
      if (h === "now" || h === "past") done++;
      return;
    }
    if (isAtRiskStatus(item.status)) atRisk++;
    if (h === "now") inFlight++;
    else if (h === "next" || h === "later") upcoming++;
  });
  return { inFlight, done, atRisk, upcoming };
}

export function patchInitiativeInData(data, domain, initiativeId, updates) {
  if (!data || !domain) return data;
  const rows = data[domain];
  if (!Array.isArray(rows)) return data;
  const statusDefs = getStatusDefinitions(data);
  return {
    ...data,
    [domain]: rows.map((item) => {
      if (item.id !== initiativeId) return item;
      return withDefaultColor({ ...item, ...updates }, statusDefs);
    }),
  };
}

export function initiativeMatchesFilter(item, category, filterState) {
  if (!rowMatchesDomainFilter(category, filterState)) return false;
  if (
    filterState.initiatives &&
    filterState.initiatives.size > 0 &&
    !filterState.initiatives.has(item.id)
  ) {
    return false;
  }
  if (!initiativeMatchesTeamsFilter(item, filterState.teams)) return false;
  if (!initiativeMatchesStatusFilter(item, filterState.statuses)) return false;
  if (!initiativeMatchesPriorityFilter(item, filterState.priorities)) return false;
  if (!initiativeMatchesConfidenceFilter(item, filterState.confidences)) return false;
  return true;
}

export function rowMatchesDomainFilter(category, filterState) {
  const selected = filterState?.domains;
  return !selected || selected.size === 0 || selected.has(category);
}

/** Toggle one domain in a multi-select; "all" (or emptying it) clears the selection. */
export function toggleDomainSelection(selected, domainId) {
  if (!domainId || domainId === "all") return null;
  const next = new Set(selected || []);
  if (next.has(domainId)) next.delete(domainId);
  else next.add(domainId);
  return next.size > 0 ? next : null;
}

/** Filters that pick out individual initiatives (everything except the domain selection). */
export function isItemFilterActive(filterState) {
  return Boolean(
    (filterState.initiatives && filterState.initiatives.size > 0) ||
      (filterState.teams && filterState.teams.size > 0) ||
      (filterState.statuses && filterState.statuses.size > 0) ||
      (filterState.priorities && filterState.priorities.size > 0) ||
      (filterState.confidences && filterState.confidences.size > 0)
  );
}

/** @deprecated use rowMatchesDomainFilter */
export const rowMatchesTeamFilter = rowMatchesDomainFilter;

export function isFilterActive(filterState) {
  return Boolean(
    (filterState.domains && filterState.domains.size > 0) || isItemFilterActive(filterState)
  );
}

export function getQuarterRangeLabel(quarters) {
  if (!quarters.length) return "";
  const first = quarters[0];
  const last = quarters[quarters.length - 1];
  return `${first.label} ${first.year} — ${last.label} ${last.year}`;
}

export function getDomainScopeLabel(filterState) {
  const selected = filterState?.domains;
  if (!selected || selected.size === 0) return "all domains";
  return [...selected].map(formatDomainLabel).join(", ");
}

/** e.g. "Q1 2026 — Q4 2030 · all domains" from loaded data + active filters */
export function getSubtitle(quarters, filterState) {
  const range = getQuarterRangeLabel(quarters);
  const domainScope = getDomainScopeLabel(filterState);
  if (range && domainScope) return `${range} · ${domainScope}`;
  return range || domainScope || "";
}

export const INITIAL_FILTER_STATE = {
  domains: null,
  initiatives: null,
  teams: null,
  statuses: null,
  priorities: null,
  confidences: null,
};

/* ---------- Quarter math (calendar quarters, UTC) ---------- */

/** { year, q } (q = 1..4) for a date, defaulting to today. */
export function quarterOf(date = new Date()) {
  const d = date instanceof Date ? date : parseDate(date);
  if (!d) return null;
  return { year: d.getUTCFullYear(), q: Math.floor(d.getUTCMonth() / 3) + 1 };
}

/** Shift a { year, q } by n quarters. */
export function addQuarters({ year, q }, n) {
  const idx = year * 4 + (q - 1) + n;
  return { year: Math.floor(idx / 4), q: (idx % 4) + 1 };
}

export function quarterIndex({ year, q }) {
  return year * 4 + (q - 1);
}

export function quarterStartISO({ year, q }) {
  return `${year}-${String((q - 1) * 3 + 1).padStart(2, "0")}-01`;
}

export function quarterEndISO({ year, q }) {
  const month = q * 3;
  const lastDay = new Date(Date.UTC(year, month, 0)).getUTCDate();
  return `${year}-${String(month).padStart(2, "0")}-${String(lastDay).padStart(2, "0")}`;
}

export function quarterLabel({ year, q }) {
  return `Q${q} ${year}`;
}

/** "Q4 2026" → { year: 2026, q: 4 }. */
export function parseQuarterLabel(label) {
  const m = /^Q([1-4])\s+(\d{4})$/.exec(String(label || "").trim());
  return m ? { year: Number(m[2]), q: Number(m[1]) } : null;
}

/** Quarter label range for an initiative, e.g. "Q4 2026 → Q1 2027" (or one label). */
export function formatQuarterRange(timeline) {
  if (!Array.isArray(timeline) || timeline.length < 2) return "";
  const a = quarterOf(timeline[0]);
  const b = quarterOf(timeline[1]);
  if (!a || !b) return "";
  if (quarterIndex(a) === quarterIndex(b)) return quarterLabel(a);
  return `${quarterLabel(a)} → ${quarterLabel(b)}`;
}

/** True when the dates fall exactly on quarter boundaries. */
export function isQuarterAligned(timeline) {
  if (!Array.isArray(timeline) || timeline.length < 2) return true;
  const a = quarterOf(timeline[0]);
  const b = quarterOf(timeline[1]);
  if (!a || !b) return true;
  return timeline[0] === quarterStartISO(a) && timeline[1] === quarterEndISO(b);
}

/** Shift an initiative's dates by whole quarters, keeping day-of-quarter offsets. */
export function shiftTimelineByQuarters(timeline, n) {
  if (!n || !Array.isArray(timeline) || timeline.length < 2) return timeline;
  return timeline.map((iso) => {
    const d = parseDate(iso);
    if (!d) return iso;
    const qs = quarterOf(d);
    const offsetDays = Math.round((d - parseDate(quarterStartISO(qs))) / 86400000);
    const target = addQuarters(qs, n);
    const base = parseDate(quarterStartISO(target));
    const shifted = new Date(base.getTime() + offsetDays * 86400000);
    const end = parseDate(quarterEndISO(target));
    const clamped = shifted > end ? end : shifted;
    return clamped.toISOString().slice(0, 10);
  });
}

/**
 * The default "useful" window: last quarter through four quarters ahead,
 * as raw quarter rows (same shape as buildQuartersForYearRange).
 */
export function buildFocusQuartersRaw(today = new Date(), before = 1, after = 4) {
  const now = quarterOf(today);
  const raw = [];
  for (let i = -before; i <= after; i++) {
    const qq = addQuarters(now, i);
    raw.push({ year: qq.year, label: `Q${qq.q}`, start: quarterStartISO(qq), end: quarterEndISO(qq) });
  }
  return raw;
}

/* ---------- Now / Next / Later ---------- */

export const HORIZONS = [
  { id: "now", label: "Now", hint: "This quarter" },
  { id: "next", label: "Next", hint: "Next quarter" },
  { id: "later", label: "Later", hint: "After that" },
];

/**
 * Which column an initiative belongs in: "now" if it overlaps this quarter,
 * "next" if it starts next quarter, "later" if beyond, "past" if it ended.
 */
export function horizonOf(item, today = new Date()) {
  const tl = item?.timeline;
  const now = quarterIndex(quarterOf(today));
  const start = Array.isArray(tl) ? quarterOf(tl[0]) : null;
  const end = Array.isArray(tl) ? quarterOf(tl[1]) : null;
  if (!start || !end) return "later";
  const s = quarterIndex(start);
  const e = quarterIndex(end);
  if (e < now) return "past";
  if (s <= now) return "now";
  if (s === now + 1) return "next";
  return "later";
}

/** Quarter offset (relative to now) that a horizon column represents. */
export function horizonQuarterOffset(horizonId) {
  return horizonId === "now" ? 0 : horizonId === "next" ? 1 : 2;
}
