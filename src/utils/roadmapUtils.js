import { applyStatusToInitiative, DEFAULT_STATUSES } from "../config/statusConfig";

export const RESERVED_DATA_KEYS = new Set([
  "meta",
  "quarters",
  "teams",
  "cohorts",
  "statuses",
  "priorities",
  "cookiebotSites",
  "cookiebotReports",
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

/** @deprecated use formatDomainLabel */
export const formatTeamLabel = formatDomainLabel;

export function getDomainsForFilter(data) {
  const domains = [{ id: "all", label: "All domains" }];
  getDomainKeys(data).forEach((id) => {
    domains.push({ id, label: formatDomainLabel(id) });
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

export function getRoadmapRows(data, quarters) {
  const statusDefs = getStatusDefinitions(data);
  return getDomainKeys(data).map((key) => ({
    id: key,
    label: formatDomainLabel(key),
    initiatives: assignLanes(
      (data[key] || []).map((item) => withDefaultColor(item, statusDefs)),
      quarters
    ),
  }));
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
  if (filterState.domain !== "all" && category !== filterState.domain) return false;
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
  return true;
}

export function rowMatchesDomainFilter(category, filterState) {
  if (filterState.domain === "all") return true;
  return filterState.domain === category;
}

/** @deprecated use rowMatchesDomainFilter */
export const rowMatchesTeamFilter = rowMatchesDomainFilter;

export function isFilterActive(filterState) {
  return (
    filterState.domain !== "all" ||
    (filterState.initiatives && filterState.initiatives.size > 0) ||
    (filterState.teams && filterState.teams.size > 0) ||
    (filterState.statuses && filterState.statuses.size > 0) ||
    (filterState.priorities && filterState.priorities.size > 0)
  );
}

export function getQuarterRangeLabel(quarters) {
  if (!quarters.length) return "";
  const first = quarters[0];
  const last = quarters[quarters.length - 1];
  return `${first.label} ${first.year} — ${last.label} ${last.year}`;
}

export function getDomainScopeLabel(filterState) {
  if (!filterState || filterState.domain === "all") return "all domains";
  return formatDomainLabel(filterState.domain);
}

/** e.g. "Q1 2026 — Q4 2030 · all domains" from loaded data + active filters */
export function getSubtitle(quarters, filterState) {
  const range = getQuarterRangeLabel(quarters);
  const domainScope = getDomainScopeLabel(filterState);
  if (range && domainScope) return `${range} · ${domainScope}`;
  return range || domainScope || "";
}

export const INITIAL_FILTER_STATE = {
  domain: "all",
  initiatives: null,
  teams: null,
  statuses: null,
  priorities: null,
};
