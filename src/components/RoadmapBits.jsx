import { CONFIDENCE_LEVELS, confidenceClass, resolveConfidence } from "../config/confidenceConfig";
import { isDoneStatus } from "../utils/roadmapUtils";

/** Small pill showing how sure we are an initiative will happen. */
export function ConfidenceBadge({ value, compact = false }) {
  const label = resolveConfidence(value);
  const hint = CONFIDENCE_LEVELS.find((c) => c.label === label)?.hint || "";
  return (
    <span
      className={`confidence-badge confidence-badge--${confidenceClass(value)}${
        compact ? " confidence-badge--compact" : ""
      }`}
      title={hint}
    >
      {label}
    </span>
  );
}

/**
 * One-click "mark done" circle. Shows ✓ in green when done; clicking again
 * moves the initiative back to In Progress.
 */
export function DoneToggle({ item, domain, onToggle, size = "md", withLabel = false }) {
  const done = isDoneStatus(item?.status);
  if (!onToggle) {
    return done ? (
      <span className={`done-toggle done-toggle--${size} is-done is-static`} aria-label="Done">
        ✓
      </span>
    ) : null;
  }
  const label = done ? "Done — click to reopen" : "Mark done";
  return (
    <button
      type="button"
      className={`done-toggle done-toggle--${size}${done ? " is-done" : ""}${
        withLabel ? " done-toggle--labelled" : ""
      }`}
      title={label}
      aria-label={`${label}: ${item?.name || ""}`}
      aria-pressed={done}
      onClick={(e) => {
        e.stopPropagation();
        onToggle({ domain, item });
      }}
      onMouseDown={(e) => e.stopPropagation()}
    >
      <span className="done-toggle__mark" aria-hidden="true">
        {done ? "✓" : ""}
      </span>
      {withLabel ? <span className="done-toggle__text">{done ? "Done" : "Mark done"}</span> : null}
    </button>
  );
}

/** Key explaining bar styles, shown above the timeline and board. */
export function RoadmapLegend() {
  return (
    <div className="roadmap-legend" aria-label="Legend">
      <span className="roadmap-legend__item">
        <span className="roadmap-legend__swatch roadmap-legend__swatch--committed" /> Committed
      </span>
      <span className="roadmap-legend__item">
        <span className="roadmap-legend__swatch roadmap-legend__swatch--likely" /> Likely
      </span>
      <span className="roadmap-legend__item">
        <span className="roadmap-legend__swatch roadmap-legend__swatch--exploring" /> Exploring
      </span>
      <span className="roadmap-legend__item">
        <span className="roadmap-legend__swatch roadmap-legend__swatch--done">✓</span> Done
      </span>
      <span className="roadmap-legend__item">
        <span className="roadmap-legend__swatch roadmap-legend__swatch--risk" /> At risk
      </span>
    </div>
  );
}
