/** Canonical priority labels and badge colors (must match the sheet dropdown + Apps Script). */
export const DEFAULT_PRIORITIES = [
  { id: "High", label: "High", color: "#ef4444" },
  { id: "Medium", label: "Medium", color: "#f59e0b" },
  { id: "Low", label: "Low", color: "#38bdf8" },
];

export const DEFAULT_PRIORITY_COLOR = "#64748b";

function normalizePriorityKey(value) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, " ");
}

export function resolvePriorityDefinitions(apiPriorities) {
  if (Array.isArray(apiPriorities) && apiPriorities.length > 0) {
    return apiPriorities.map((p) => ({
      id: p.id || p.label,
      label: p.label || p.id,
      color: p.color || DEFAULT_PRIORITY_COLOR,
    }));
  }
  return DEFAULT_PRIORITIES;
}

/** Resolve a raw priority value to its canonical label + badge color. */
export function resolvePriority(value, definitions = DEFAULT_PRIORITIES) {
  const raw = String(value || "").trim();
  if (!raw) return { label: "", color: DEFAULT_PRIORITY_COLOR };
  const key = normalizePriorityKey(raw);
  const match = definitions.find((p) => normalizePriorityKey(p.label) === key);
  if (match) return { label: match.label, color: match.color };
  return { label: raw, color: DEFAULT_PRIORITY_COLOR };
}

export function getValidPriorityLabels(definitions = DEFAULT_PRIORITIES) {
  return definitions.map((p) => p.label);
}
