import { useCallback, useState } from "react";
import {
  DAY_MS,
  contrastText,
  formatDuration,
  formatEventDate,
  positionInWindow,
} from "../../utils/incidentUtils";

const LANE_HEIGHT = 22;
const LANE_GAP = 5;
const TRACK_PADDING = 9;

/** Narrowest a tick column may get before the timeline starts scrolling. */
const MIN_TICK_PX = { month: 78, week: 62, day: 46 };

function rowHeight(laneCount) {
  return TRACK_PADDING * 2 + laneCount * LANE_HEIGHT + Math.max(0, laneCount - 1) * LANE_GAP;
}

/** "3 events · 12h down" — the sub-label under each domain name. */
function rowSummary(items) {
  const count = `${items.length} event${items.length === 1 ? "" : "s"}`;
  const down = items.reduce((sum, i) => sum + (i.isIncident ? i.effectiveMinutes || 0 : 0), 0);
  return down > 0 ? `${count} · ${formatDuration(down)} down` : count;
}

/** Color of the highest-severity incident in a row (planned work never wins). */
function worstColor(items) {
  let worst = null;
  items.forEach((item) => {
    if (item.type.planned) return;
    if (!worst || item.severity.rank > worst.severity.rank) worst = item;
  });
  return (worst || items[0])?.color || "#64748b";
}

function Tooltip({ hover }) {
  if (!hover) return null;
  const { entry, x, y, below } = hover;
  return (
    <div
      className={`ops-tip${below ? " ops-tip--below" : ""}`}
      style={{ left: x, top: y }}
      role="presentation"
    >
      <div className="ops-tip__head">
        <span className="ops-tip__dot" style={{ background: entry.color }} />
        <span className="ops-tip__title">{entry.title}</span>
      </div>
      <p className="ops-tip__meta">
        {entry.domainLabel} · {entry.type.label} · {entry.severity.label}
      </p>
      <p className="ops-tip__meta">
        {formatEventDate(entry)} ·{" "}
        {entry.ongoing ? "ongoing" : formatDuration(entry.durationMinutes)}
      </p>
      {entry.customerImpact ? <p className="ops-tip__impact">{entry.customerImpact}</p> : null}
      <p className="ops-tip__hint">Click for full details</p>
    </div>
  );
}

export default function IncidentTimeline({
  rows,
  ticks,
  groups,
  window: timeWindow,
  zoom,
  nowMs,
  selectedId,
  onSelect,
}) {
  const [hover, setHover] = useState(null);

  const columns = ticks
    .map((t) => `minmax(0, ${(t.endMs - t.startMs) / DAY_MS}fr)`)
    .join(" ");
  // Below this the timeline scrolls sideways instead of squashing columns.
  const minWidth = `calc(var(--ops-label-w) + ${ticks.length * (MIN_TICK_PX[zoom] || 60)}px)`;
  const nowPct =
    nowMs >= timeWindow.startMs && nowMs <= timeWindow.endMs
      ? positionInWindow(nowMs, timeWindow)
      : null;

  const handleEnter = useCallback((event, entry) => {
    const rect = event.currentTarget.getBoundingClientRect();
    // Near the top of the viewport there is no room above the bar — flip under it.
    const below = rect.top < 170;
    setHover({
      entry,
      x: Math.min(Math.max(rect.left + rect.width / 2, 150), window.innerWidth - 160),
      y: below ? rect.bottom : rect.top,
      below,
    });
  }, []);

  const handleLeave = useCallback(() => setHover(null), []);

  return (
    <div className="ops-timeline">
      <div className="ops-timeline__scroll theme-scroll">
        <div className="ops-timeline__inner" style={{ minWidth }}>
          <div className="ops-timeline__head">
            <div className="ops-timeline__label-col ops-timeline__head-label">Domain / System</div>
            <div className="ops-timeline__head-cols">
              <div className="ops-timeline__groups" style={{ gridTemplateColumns: columns }}>
                {groups.map((group) => (
                  <div
                    key={group.key}
                    className="ops-timeline__group"
                    style={{ gridColumn: `span ${group.span}` }}
                  >
                    {group.label}
                  </div>
                ))}
              </div>
              <div className="ops-timeline__ticks" style={{ gridTemplateColumns: columns }}>
                {ticks.map((tick) => (
                  <div
                    key={tick.key}
                    className={[
                      "ops-timeline__tick",
                      tick.weekend && "is-weekend",
                      tick.sub === "Sun" && "is-sunday",
                    ]
                      .filter(Boolean)
                      .join(" ")}
                  >
                    <span className="ops-timeline__tick-label">{tick.label}</span>
                    {tick.sub ? <span className="ops-timeline__tick-sub">{tick.sub}</span> : null}
                  </div>
                ))}
              </div>
            </div>
          </div>

          <div className="ops-timeline__body">
            {nowPct !== null ? (
              <div
                className="ops-timeline__now"
                style={{
                  left: `calc(var(--ops-label-w) + (100% - var(--ops-label-w)) * ${nowPct / 100})`,
                }}
              >
                <span className="ops-timeline__now-caret" />
              </div>
            ) : null}

            {rows.map((row) => (
              <div className="ops-row" key={row.key} style={{ height: `${rowHeight(row.laneCount)}px` }}>
                <div
                  className="ops-timeline__label-col ops-row__label"
                  title={row.label}
                  // Accent = the worst thing that happened to this domain in view.
                  style={{ "--row-accent": worstColor(row.items) }}
                >
                  <span className="ops-row__swatch" aria-hidden="true" />
                  <span className="ops-row__label-body">
                    <span className="ops-row__label-text">{row.label}</span>
                    <span className="ops-row__label-sub">{rowSummary(row.items)}</span>
                  </span>
                </div>
                <div className="ops-row__track">
                  <div className="ops-row__lines" style={{ gridTemplateColumns: columns }}>
                    {ticks.map((tick) => (
                      <span
                        key={tick.key}
                        className={`ops-row__line${tick.weekend ? " is-weekend" : ""}`}
                      />
                    ))}
                  </div>

                  {row.items.map((entry) => {
                    const left = positionInWindow(entry.startMs, timeWindow);
                    const right = positionInWindow(
                      Math.max(entry.endMs ?? entry.startMs, entry.startMs),
                      timeWindow
                    );
                    const clippedStart = entry.startMs < timeWindow.startMs;
                    const clippedEnd = (entry.endMs ?? entry.startMs) > timeWindow.endMs;
                    // Only the worst events get a solid fill; everything else is
                    // tinted, so a busy month reads as texture rather than noise.
                    const solid = entry.severity.rank === 4 && !entry.type.planned;
                    const classes = [
                      "ops-bar",
                      solid ? "ops-bar--solid" : "ops-bar--tint",
                      entry.type.planned && "ops-bar--planned",
                      entry.ongoing && "ops-bar--ongoing",
                      selectedId === entry.id && "is-selected",
                      clippedStart && "is-clipped-start",
                      clippedEnd && "is-clipped-end",
                    ]
                      .filter(Boolean)
                      .join(" ");

                    return (
                      <button
                        type="button"
                        key={entry.id}
                        className={classes}
                        style={{
                          left: `${left}%`,
                          width: `${Math.max(right - left, 0)}%`,
                          top: `${TRACK_PADDING + entry.lane * (LANE_HEIGHT + LANE_GAP)}px`,
                          height: `${LANE_HEIGHT}px`,
                          "--bar-color": entry.color,
                          "--bar-text": contrastText(entry.color),
                        }}
                        onMouseEnter={(e) => handleEnter(e, entry)}
                        onMouseLeave={handleLeave}
                        onFocus={(e) => handleEnter(e, entry)}
                        onBlur={handleLeave}
                        onClick={() => onSelect?.(entry.id)}
                        aria-label={`${entry.title} — ${entry.domainLabel}, ${entry.severity.label}, ${
                          entry.ongoing ? "ongoing" : formatDuration(entry.durationMinutes)
                        }`}
                      >
                        <span className="ops-bar__title">{entry.title}</span>
                        <span className="ops-bar__dur">
                          {entry.ongoing ? "ongoing" : formatDuration(entry.durationMinutes)}
                        </span>
                      </button>
                    );
                  })}
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
      <Tooltip hover={hover} />
    </div>
  );
}
