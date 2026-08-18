import Icon from "../Icon";
import { formatDuration } from "../../utils/incidentUtils";

const SIZE = 200;
const CENTER = SIZE / 2;
const RADIUS = 70;
const STROKE = 32;
const CIRCUMFERENCE = 2 * Math.PI * RADIUS;
// Below this, an in-ring "8%" label would overlap its neighbors more than it
// would inform, so it's left to the legend row instead.
const MIN_LABEL_PCT = 6;

const OTHER_MODE = { cause: "severity", severity: "cause" };
const MODE_TITLE = { cause: "Cause", severity: "Severity" };

/**
 * Large "Outage Breakdown" doughnut: percentages are downtime-minute shares
 * (never incident counts), sliced by cause or by severity. Pure SVG — no
 * chart library — following the app's existing no-dependency-icon pattern.
 */
export default function OutageBreakdownChart({ segments, totalMinutes, mode, onModeChange }) {
  const hasData = totalMinutes > 0 && segments.length > 0;

  // Cumulative offsets, with the last segment consuming the exact remainder
  // so the ring's seam never shows a rounding gap or overlap.
  let cumulative = 0;
  const arcs = hasData
    ? segments.map((seg, i) => {
        const length =
          i === segments.length - 1 ? CIRCUMFERENCE - cumulative : (seg.pct / 100) * CIRCUMFERENCE;
        const midFraction = (cumulative + length / 2) / CIRCUMFERENCE;
        const angle = midFraction * 2 * Math.PI;
        const arc = {
          ...seg,
          length,
          offset: cumulative,
          labelX: CENTER + RADIUS * Math.sin(angle),
          labelY: CENTER - RADIUS * Math.cos(angle),
        };
        cumulative += length;
        return arc;
      })
    : [];

  return (
    <section className="ops-panel ops-breakdown">
      <header className="ops-breakdown__head">
        <h3 className="ops-panel__title">Outage Breakdown</h3>
        <div className="ops-pill-row ops-breakdown__toggle">
          <button
            type="button"
            className={`ops-toggle${mode === "cause" ? " is-on" : ""}`}
            onClick={() => onModeChange("cause")}
          >
            By Cause
          </button>
          <button
            type="button"
            className={`ops-toggle${mode === "severity" ? " is-on" : ""}`}
            onClick={() => onModeChange("severity")}
          >
            By Severity
          </button>
        </div>
      </header>
      <p className="ops-panel__sub ops-breakdown__sub">
        By {MODE_TITLE[mode]} (based on downtime)
        <Icon name="info" className="ops-breakdown__info" size={13} />
      </p>

      <div className="ops-breakdown__body">
        <svg
          className="ops-breakdown__ring"
          viewBox={`0 0 ${SIZE} ${SIZE}`}
          role="img"
          aria-label={`Outage breakdown, ${formatDuration(totalMinutes)} total downtime`}
        >
          <circle cx={CENTER} cy={CENTER} r={RADIUS} fill="none" stroke="var(--border)" strokeWidth={STROKE} />
          {hasData ? (
            <>
              <g transform={`rotate(-90 ${CENTER} ${CENTER})`}>
                {arcs.map((arc) => (
                  <circle
                    key={arc.label}
                    cx={CENTER}
                    cy={CENTER}
                    r={RADIUS}
                    fill="none"
                    stroke={arc.color}
                    strokeWidth={STROKE}
                    strokeDasharray={`${arc.length} ${CIRCUMFERENCE - arc.length}`}
                    strokeDashoffset={-arc.offset}
                  />
                ))}
              </g>
              {arcs
                .filter((arc) => arc.pct >= MIN_LABEL_PCT)
                .map((arc) => (
                  <text
                    key={arc.label}
                    x={arc.labelX}
                    y={arc.labelY}
                    textAnchor="middle"
                    dominantBaseline="middle"
                    className="ops-breakdown__slice-label"
                  >
                    {Math.round(arc.pct)}%
                  </text>
                ))}
            </>
          ) : null}
          <text x={CENTER} y={CENTER - 4} textAnchor="middle" className="ops-breakdown__center-value">
            {formatDuration(totalMinutes)}
          </text>
          <text x={CENTER} y={CENTER + 16} textAnchor="middle" className="ops-breakdown__center-label">
            Total downtime
          </text>
        </svg>

        <div className="ops-breakdown__legend">
          {hasData ? (
            arcs.map((arc) => (
              <div className="ops-breakdown__row" key={arc.label}>
                <span className="ops-breakdown__dot" style={{ background: arc.color }} />
                <span className="ops-breakdown__row-label">{arc.label}</span>
                <span className="ops-breakdown__row-value">
                  {formatDuration(arc.minutes)} ({Math.round(arc.pct)}%)
                </span>
              </div>
            ))
          ) : (
            <p className="ops-empty ops-breakdown__empty">No downtime in this period.</p>
          )}
        </div>
      </div>

      <div className="ops-breakdown__tip">
        <Icon name="tip" className="ops-breakdown__tip-icon" size={18} />
        <p>
          Tip: Switch to "By {MODE_TITLE[OTHER_MODE[mode]]}" to see downtime % by{" "}
          {OTHER_MODE[mode]}.
        </p>
      </div>
    </section>
  );
}
