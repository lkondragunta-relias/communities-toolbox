/**
 * Communities Operations Timeline — event vocabulary.
 *
 * One row in the Incidents sheet = one operational event: an outage, a
 * degradation, a release, a migration, planned maintenance, a vendor problem.
 * Everything the dashboard colors, filters, or counts is defined here so the
 * sheet stays plain text ("Outage", "Critical", "Resolved").
 *
 * Sheet values are matched loosely: case, spacing, emoji and Slack shortcodes
 * (":red_circle: Critical") are all stripped before matching, so a row pasted
 * from Teams still lands on the right color.
 */

/** Types that are planned/expected work — not incidents, no downtime counted. */
export const INCIDENT_TYPES = [
  { id: "outage", label: "Outage", color: "#ef4444", planned: false },
  { id: "degradation", label: "Degradation", color: "#f59e0b", planned: false },
  { id: "integration", label: "Integration", color: "#e11d48", planned: false },
  { id: "security", label: "Security", color: "#c2410c", planned: false },
  { id: "vendor-issue", label: "Vendor Issue", color: "#db2777", planned: false },
  { id: "release", label: "Release", color: "#3b82f6", planned: true },
  { id: "infrastructure-change", label: "Infrastructure Change", color: "#8b5cf6", planned: true },
  { id: "migration", label: "Migration", color: "#a855f7", planned: true },
  { id: "maintenance", label: "Maintenance", color: "#94a3b8", planned: true },
];

export const INCIDENT_SEVERITIES = [
  { id: "critical", label: "Critical", color: "#dc2626", rank: 4 },
  { id: "high", label: "High", color: "#f97316", rank: 3 },
  { id: "medium", label: "Medium", color: "#eab308", rank: 2 },
  { id: "low", label: "Low", color: "#22c55e", rank: 1 },
];

export const INCIDENT_STATUSES = [
  { id: "active", label: "Active", color: "#dc2626", open: true },
  { id: "monitoring", label: "Monitoring", color: "#f59e0b", open: true },
  { id: "resolved", label: "Resolved", color: "#16a34a", open: false },
];

export const UNKNOWN_COLOR = "#64748b";

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
    // "Infra change" / "Infrastructure changes" — match on a leading word too.
    list.find((d) => {
      const label = normalizeToken(d.label);
      return label.startsWith(token) || token.startsWith(label);
    }) ||
    null
  );
}

/** Resolve a sheet Type value; unknown text is kept and treated as an incident. */
export function resolveIncidentType(value) {
  const hit = findDefinition(INCIDENT_TYPES, value);
  if (hit) return hit;
  const raw = String(value || "").trim();
  return { id: normalizeToken(raw) || "other", label: raw || "Other", color: UNKNOWN_COLOR, planned: false };
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
 * Bar color. Planned work (release / maintenance / infra change / migration)
 * is colored by its type so it never reads as a green "all clear" incident;
 * everything else is colored by severity, which is what leadership scans for.
 */
export function getEventColor(type, severity) {
  if (type?.planned) return type.color;
  return severity?.color || type?.color || UNKNOWN_COLOR;
}

/** Legend shown under the timeline: severities first, then planned types. */
export const TIMELINE_LEGEND = [
  ...INCIDENT_SEVERITIES.map((s) => ({ key: `sev-${s.id}`, label: s.label, color: s.color })),
  ...INCIDENT_TYPES.filter((t) => t.planned).map((t) => ({
    key: `type-${t.id}`,
    label: t.label,
    color: t.color,
    planned: true,
  })),
];

export const INCIDENT_TYPE_LABELS = INCIDENT_TYPES.map((t) => t.label);
export const INCIDENT_SEVERITY_LABELS = INCIDENT_SEVERITIES.map((s) => s.label);
export const INCIDENT_STATUS_LABELS = INCIDENT_STATUSES.map((s) => s.label);
