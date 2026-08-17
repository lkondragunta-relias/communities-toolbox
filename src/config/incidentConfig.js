/**
 * Communities Operations Timeline — event vocabulary.
 *
 * One row in the Incidents sheet = one operational event.
 * Two top-level types: Outage (affects uptime) and Track Event (context only).
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
];

export const INCIDENT_STATUSES = [
  { id: "active", label: "Active", color: "#dc2626", open: true },
  { id: "monitoring", label: "Monitoring", color: "#f59e0b", open: true },
  { id: "resolved", label: "Resolved", color: "#16a34a", open: false },
];

export const UNKNOWN_COLOR = "#64748b";

export const DEFAULT_OUTAGE_CAUSES = [
  { id: "cdn-akamai", label: "CDN / Akamai", color: "#ef4444" },
  { id: "application-failure", label: "Application Failure", color: "#dc2626" },
  { id: "hosting-issue", label: "Hosting Issue", color: "#f97316" },
  { id: "bot-attack", label: "Bot Attack", color: "#c2410c" },
  { id: "infra-degradation", label: "Infra Degradation", color: "#f59e0b" },
  { id: "other-outage", label: "Other", color: "#64748b" },
];

export const DEFAULT_TRACK_EVENT_CAUSES = [
  { id: "release", label: "Release", color: "#3b82f6" },
  { id: "hotfix", label: "Hotfix", color: "#6366f1" },
  { id: "infra-change", label: "Infra Change", color: "#a855f7" },
  { id: "scheduled-maintenance", label: "Scheduled Maintenance", color: "#94a3b8" },
  { id: "security-incident", label: "Security Incident", color: "#e11d48" },
  { id: "partial-degradation", label: "Partial Degradation", color: "#f59e0b" },
  { id: "functional-issue", label: "Functional Issue", color: "#22d3ee" },
  { id: "migration", label: "Migration", color: "#10b981" },
  { id: "other-track", label: "Other", color: "#64748b" },
];

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
export function resolveIncidentType(value) {
  const raw = String(value || "").trim();
  const token = normalizeToken(raw);

  // Direct match on new two-type model
  const hit = findDefinition(INCIDENT_TYPES, raw);
  if (hit) return hit;

  // Legacy type mapping
  const mapped = LEGACY_TYPE_MAP[token];
  if (mapped) return INCIDENT_TYPES.find((t) => t.label === mapped) || INCIDENT_TYPES[0];

  // Unknown — treat as Outage (unplanned)
  return { id: token || "other", label: raw || "Other", color: UNKNOWN_COLOR, planned: false };
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

/** Legend shown under the timeline. */
export const TIMELINE_LEGEND = [
  ...INCIDENT_SEVERITIES.map((s) => ({ key: `sev-${s.id}`, label: s.label, color: s.color })),
  { key: "type-track-event", label: "Track Event", color: "#3b82f6", planned: true },
];

export const INCIDENT_TYPE_LABELS = INCIDENT_TYPES.map((t) => t.label);
export const INCIDENT_SEVERITY_LABELS = INCIDENT_SEVERITIES.map((s) => s.label);
export const INCIDENT_STATUS_LABELS = INCIDENT_STATUSES.map((s) => s.label);
export const DEFAULT_OUTAGE_CAUSE_LABELS = DEFAULT_OUTAGE_CAUSES.map((c) => c.label);
export const DEFAULT_TRACK_EVENT_CAUSE_LABELS = DEFAULT_TRACK_EVENT_CAUSES.map((c) => c.label);
