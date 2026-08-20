/**
 * Communities Operations Timeline — event vocabulary.
 *
 * One row in the Incidents sheet = one operational event.
 * Two top-level types: Outage (affects uptime) and Track Event (context only).
 *
 * The lists below are only the fallback. The live vocabulary comes from the
 * "Incident Config" tab (Section / Outage Cause / Track Event Cause columns),
 * which the backend hands over as `data.incidentConfig` — see
 * resolveIncidentVocabulary(). Editing that tab is how the Type and Cause
 * dropdowns change; nothing here needs touching.
 */

/** The two top-level event types. */
export const INCIDENT_TYPES = [
  { id: "outage", label: "Outage", color: "#ef4444", planned: false },
  { id: "track-event", label: "Track Event", color: "#3b82f6", planned: true },
];

export const INCIDENT_SEVERITIES = [
  { id: "critical", label: "Critical", color: "#dc2626", rank: 4 },
  { id: "high", label: "High", color: "#f97316", rank: 3 },
  { id: "medium", label: "Medium", color: "#eab308", rank: 2 },
  { id: "low", label: "Low", color: "#22c55e", rank: 1 },
  { id: "informational", label: "Informational", color: "#94a3b8", rank: 0 },
];

export const INCIDENT_STATUSES = [
  { id: "active", label: "Active", color: "#dc2626", open: true },
  { id: "investigating", label: "Investigating", color: "#3b82f6", open: true },
  { id: "monitoring", label: "Monitoring", color: "#f59e0b", open: true },
  { id: "resolved", label: "Resolved", color: "#16a34a", open: false },
];

export const UNKNOWN_COLOR = "#64748b";

export const DEFAULT_OUTAGE_CAUSES = [
  { id: "cdn-akamai", label: "CDN / Akamai", color: "#ef4444" },
  { id: "application-failure", label: "Application Failure", color: "#dc2626" },
  { id: "hosting-issue", label: "Hosting Issue", color: "#f97316" },
  { id: "database", label: "Database", color: "#14b8a6" },
  { id: "third-party-dependency", label: "Third-Party Dependency", color: "#0ea5e9" },
  { id: "bot-attack", label: "Bot Attack", color: "#c2410c" },
  { id: "network-issue", label: "Network Issue", color: "#6366f1" },
  { id: "security-issue", label: "Security Issue", color: "#a855f7" },
  { id: "server-degradation", label: "Server Degradation", color: "#ec4899" },
  { id: "unknown", label: "Unknown", color: "#94a3b8" },
  { id: "other-outage", label: "Other", color: "#64748b" },
];

export const DEFAULT_TRACK_EVENT_CAUSES = [
  { id: "release", label: "Release", color: "#3b82f6" },
  { id: "hotfix", label: "Hotfix", color: "#6366f1" },
  { id: "rollback", label: "Rollback", color: "#eab308" },
  { id: "infra-change", label: "Infra Change", color: "#a855f7" },
  { id: "scheduled-maintenance", label: "Scheduled Maintenance", color: "#94a3b8" },
  { id: "migration", label: "Migration", color: "#10b981" },
  { id: "security-incident", label: "Security Incident", color: "#e11d48" },
  { id: "functional-issue", label: "Functional Issue", color: "#22d3ee" },
  { id: "partial-degradation", label: "Partial Degradation", color: "#f59e0b" },
  { id: "capacity-change", label: "Capacity Change", color: "#0ea5e9" },
  { id: "other-track", label: "Other", color: "#64748b" },
];

/** Fallback domain list for a workbook with no Incident Config "Domain" column yet. */
export const DEFAULT_DOMAINS = [
  "Relias Academy",
  "Nurse ECommerce & Edu",
  "Nurse Home & Jobs",
  "FreeCME",
  "Clinician",
  "WCEI",
  "Academy Portals",
  "RLP",
  "RLMS",
];

/** Distinct colors per domain for the breakdown doughnut chart. */
export const DOMAIN_COLORS = {
  "relias academy":         "#6366f1", // indigo
  "nurse ecommerce & edu":  "#f59e0b", // amber
  "nurse home & jobs":      "#10b981", // emerald
  "freecme":                "#3b82f6", // blue
  "clinician":              "#ec4899", // pink
  "wcei":                   "#8b5cf6", // violet
  "academy portals":        "#14b8a6", // teal
  "rlp":                    "#f97316", // orange
  "rlms":                   "#06b6d4", // cyan
  "multiple":               "#a855f7", // purple
  "infrastructure":         "#84cc16", // lime
  "other":                  "#64748b", // slate fallback
};

/**
 * Map legacy type values (pre-refactor) to the new two-type model.
 * Called when reading existing sheet rows so old data keeps working.
 */
const LEGACY_TYPE_MAP = {
  outage: "Outage",
  degradation: "Outage",
  integration: "Outage",
  security: "Outage",
  "vendor issue": "Outage",
  "vendor-issue": "Outage",
  "bot attack": "Outage",
  release: "Track Event",
  "infrastructure change": "Track Event",
  "infrastructure-change": "Track Event",
  "infra change": "Track Event",
  migration: "Track Event",
  maintenance: "Track Event",
  "scheduled maintenance": "Track Event",
  hotfix: "Track Event",
  "track event": "Track Event",
  "track-event": "Track Event",
};

/**
 * Drop emoji, Slack shortcodes and punctuation so "🔴 Critical",
 * ":red_circle: Critical" and "critical" all normalize to "critical".
 */
export function normalizeToken(value) {
  return String(value ?? "")
    .replace(/:[a-z0-9_+-]+:/gi, " ")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim()
    .toLowerCase();
}

function findDefinition(list, value) {
  const token = normalizeToken(value);
  if (!token) return null;
  return (
    list.find((d) => normalizeToken(d.id) === token || normalizeToken(d.label) === token) ||
    list.find((d) => {
      const label = normalizeToken(d.label);
      return label.startsWith(token) || token.startsWith(label);
    }) ||
    null
  );
}

/** Resolve a sheet Type value; maps legacy values to Outage/Track Event. */
export function resolveIncidentType(value, typeDefs = INCIDENT_TYPES) {
  const defs = typeDefs && typeDefs.length ? typeDefs : INCIDENT_TYPES;
  const raw = String(value || "").trim();
  const token = normalizeToken(raw);

  // Direct match on the configured types
  const hit = findDefinition(defs, raw);
  if (hit) return hit;

  // Legacy type mapping
  const mapped = LEGACY_TYPE_MAP[token];
  if (mapped) return findDefinition(defs, mapped) || defs[0];

  // Unknown — treat as Outage (unplanned)
  return { id: token || "other", label: raw || "Other", color: UNKNOWN_COLOR, planned: false };
}

/* ------------------ Config-sheet driven Type / Cause lists ----------------- */

/** Fallback colors for types and causes the code has never heard of. */
const TYPE_PALETTE = ["#ef4444", "#3b82f6", "#a855f7", "#14b8a6", "#f97316"];
const CAUSE_PALETTE = [
  "#ef4444", "#f97316", "#eab308", "#22c55e", "#14b8a6",
  "#3b82f6", "#6366f1", "#a855f7", "#ec4899", "#64748b",
];

const ALL_DEFAULT_CAUSES = [...DEFAULT_OUTAGE_CAUSES, ...DEFAULT_TRACK_EVENT_CAUSES];

/** Config-tab values, trimmed and de-duplicated — a blank row is not an option. */
function cleanList(values) {
  if (!Array.isArray(values)) return [];
  const seen = new Set();
  const out = [];
  values.forEach((value) => {
    const label = String(value ?? "").trim();
    if (!label) return;
    const token = normalizeToken(label);
    if (!token || seen.has(token)) return;
    seen.add(token);
    out.push(label);
  });
  return out;
}

function slugOf(label, fallback) {
  return normalizeToken(label).replace(/\s+/g, "-") || fallback;
}

/**
 * The Type options, straight from the config tab's Section column. Types the
 * app already knows keep their color and their planned/unplanned meaning; a
 * type added in the sheet is drawn from the palette and counts as an incident.
 */
export function resolveIncidentTypeDefinitions(config) {
  const configured = cleanList(config?.types);
  const labels = configured.length ? configured : cleanList(config?.sections);
  if (labels.length === 0) return INCIDENT_TYPES;

  return labels.map((label, i) => {
    const known = findDefinition(INCIDENT_TYPES, label);
    if (known) return { ...known, label };
    return {
      id: slugOf(label, `type-${i + 1}`),
      label,
      color: TYPE_PALETTE[i % TYPE_PALETTE.length],
      planned: false,
    };
  });
}

/**
 * Cause options for one type. The config tab keeps one column per type
 * ("Outage Cause", "Track Event Cause"), so a type added there brings its own
 * cause list with it and nothing here has to change.
 */
export function resolveCauseDefinitions(config, typeLabel) {
  const token = normalizeToken(typeLabel);
  const byType = config?.causesByType || {};
  const fromSheet = cleanList(
    byType[token] ||
      byType[String(typeLabel || "").trim()] ||
      (token === "outage" ? config?.outageCauses : null) ||
      (token === "track event" ? config?.trackEventCauses : null)
  );

  const fallback =
    token === "track event"
      ? DEFAULT_TRACK_EVENT_CAUSES
      : token === "outage"
        ? DEFAULT_OUTAGE_CAUSES
        : [];
  const labels = fromSheet.length ? fromSheet : fallback.map((c) => c.label);

  return labels.map((label, i) => {
    const known = findDefinition(ALL_DEFAULT_CAUSES, label);
    return {
      id: known ? known.id : slugOf(label, `cause-${i + 1}`),
      label,
      color: known ? known.color : CAUSE_PALETTE[i % CAUSE_PALETTE.length],
    };
  });
}

/**
 * Domain/system options straight from the config tab's Domain column (falls
 * back to the built-in list for a workbook without one). Kept separate from
 * `getDomainNameMap` (roadmap projects' Domains sheet) — this is the
 * Incidents-side vocabulary, which may include systems that have no roadmap
 * projects at all.
 */
export function resolveIncidentDomainDefinitions(config) {
  const configured = cleanList(config?.domains);
  return configured.length ? configured : DEFAULT_DOMAINS.slice();
}

/**
 * Everything the Operations view needs to render Type and Cause: the type list
 * plus, for each type, its own cause list — both sourced from the config tab.
 */
export function resolveIncidentVocabulary(config) {
  const types = resolveIncidentTypeDefinitions(config);
  const causesByType = {};
  types.forEach((type) => {
    causesByType[type.label] = resolveCauseDefinitions(config, type.label);
  });
  return {
    types,
    typeLabels: types.map((t) => t.label),
    causesByType,
  };
}

/** Legend for a config-driven type list: severities plus every planned type. */
export function buildTimelineLegend(types = INCIDENT_TYPES) {
  return [
    ...INCIDENT_SEVERITIES.map((s) => ({ key: `sev-${s.id}`, label: s.label, color: s.color })),
    ...types
      .filter((t) => t.planned)
      .map((t) => ({ key: `type-${t.id}`, label: t.label, color: t.color, planned: true })),
  ];
}

/** Resolve a sheet Severity value; blank/unknown sorts below Low. */
export function resolveIncidentSeverity(value) {
  const hit = findDefinition(INCIDENT_SEVERITIES, value);
  if (hit) return hit;
  const raw = String(value || "").trim();
  return { id: normalizeToken(raw) || "unspecified", label: raw || "Unspecified", color: UNKNOWN_COLOR, rank: 0 };
}

/** Resolve a sheet Status value; blank/unknown is never counted as open. */
export function resolveIncidentStatus(value) {
  const hit = findDefinition(INCIDENT_STATUSES, value);
  if (hit) return hit;
  const raw = String(value || "").trim();
  return { id: normalizeToken(raw) || "unknown", label: raw || "Unknown", color: UNKNOWN_COLOR, open: false };
}

/**
 * Bar color. Track Events (planned) colored by type; Outages colored by severity.
 */
export function getEventColor(type, severity) {
  if (type?.planned) return type.color;
  return severity?.color || type?.color || UNKNOWN_COLOR;
}

// Type and cause label lists are no longer constants — they come from the
// config tab via resolveIncidentVocabulary(), and the legend from
// buildTimelineLegend() above.
export const INCIDENT_SEVERITY_LABELS = INCIDENT_SEVERITIES.map((s) => s.label);
export const INCIDENT_STATUS_LABELS = INCIDENT_STATUSES.map((s) => s.label);
