/**
 * How sure we are an initiative will happen. Kept separate from Status
 * (lifecycle) so "Future" work can still read as solid, likely, or speculative.
 * Must match CONFIDENCE_LEVELS in the Apps Script.
 */
export const CONFIDENCE_LEVELS = [
  { id: "Committed", label: "Committed", hint: "Solid — we're doing it" },
  { id: "Likely", label: "Likely", hint: "Good chance it happens" },
  { id: "Exploring", label: "Exploring", hint: "May not materialize" },
];

export const DEFAULT_CONFIDENCE = "Committed";

/** Canonical label for a raw value; blank or unknown values count as Committed. */
export function resolveConfidence(value) {
  const raw = String(value || "").trim().toLowerCase();
  const match = CONFIDENCE_LEVELS.find((c) => c.id.toLowerCase() === raw);
  return match ? match.label : DEFAULT_CONFIDENCE;
}

/** CSS modifier, e.g. "committed" / "likely" / "exploring". */
export function confidenceClass(value) {
  return resolveConfidence(value).toLowerCase();
}

export function getValidConfidenceLabels() {
  return CONFIDENCE_LEVELS.map((c) => c.label);
}
