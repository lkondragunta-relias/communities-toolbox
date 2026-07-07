/** Canonical status labels and bar colors (must match sheet dropdown + Apps Script). */
export const DEFAULT_STATUSES = [
  { id: "In Progress", label: "In Progress", color: "#3b82f6" },
  { id: "Close to done", label: "Close to done", color: "#86efac" },
  { id: "At Risk", label: "At Risk", color: "#fca5a5" },
  { id: "Done", label: "Done", color: "#16a34a" },
  { id: "Future", label: "Future", color: "#eab308" },
  { id: "Paused", label: "Paused", color: "#4b5563" },
];

// Cache lookups per definitions array — resolveStatus runs once per initiative
// per render, and rebuilding the Map each call is O(items × statuses).
const lookupCache = new WeakMap();

function buildLookup(definitions) {
  const cached = lookupCache.get(definitions);
  if (cached) return cached;
  const map = new Map();
  definitions.forEach((s) => {
    map.set(normalizeStatusKey(s.label), s);
    if (s.id) map.set(normalizeStatusKey(s.id), s);
  });
  lookupCache.set(definitions, map);
  return map;
}

export function normalizeStatusKey(value) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, " ");
}

export function resolveStatusDefinitions(apiStatuses) {
  if (Array.isArray(apiStatuses) && apiStatuses.length > 0) {
    return apiStatuses.map((s) => ({
      id: s.id || s.label,
      label: s.label || s.id,
      color: s.color || "#64748b",
    }));
  }
  return DEFAULT_STATUSES;
}

export function resolveStatus(statusValue, statusDefinitions = DEFAULT_STATUSES) {
  const raw = String(statusValue || "").trim();
  if (!raw) {
    return { label: "", color: "#64748b" };
  }

  const lookup = buildLookup(statusDefinitions);
  const match = lookup.get(normalizeStatusKey(raw));
  if (match) {
    return { label: match.label, color: match.color };
  }

  if (/^#[0-9A-Fa-f]{6}$/.test(raw)) {
    return { label: "", color: raw };
  }

  return { label: raw, color: "#64748b" };
}

export function applyStatusToInitiative(item, statusDefinitions) {
  if (!item) return item;
  const defs = statusDefinitions || DEFAULT_STATUSES;
  const { label, color } = resolveStatus(item.status ?? item.color, defs);
  return {
    ...item,
    status: label || item.status || "",
    color,
  };
}

export function getValidStatusLabels(statusDefinitions = DEFAULT_STATUSES) {
  return statusDefinitions.map((s) => s.label);
}
