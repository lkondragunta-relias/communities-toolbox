import { Fragment, useCallback, useEffect, useRef, useState } from "react";
import {
  buildYearSpans,
  dateToTimelinePosition,
  getRoadmapRows,
  rowMatchesDomainFilter,
  summarizeDomain,
  timelinePositionToCss,
} from "../utils/roadmapUtils";
import InitiativeBar from "./InitiativeBar";

const HEADER_ROWS = 2;

/** Calendar-quarter date bounds, keyed by quarter label (timezone-safe). */
const QUARTER_BOUNDS = {
  Q1: ["01-01", "03-31"],
  Q2: ["04-01", "06-30"],
  Q3: ["07-01", "09-30"],
  Q4: ["10-01", "12-31"],
};

function isoFromDate(date) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

function quarterStartISO(q) {
  const bounds = QUARTER_BOUNDS[q.label];
  return bounds ? `${q.year}-${bounds[0]}` : isoFromDate(q.start);
}

function quarterEndISO(q) {
  const bounds = QUARTER_BOUNDS[q.label];
  return bounds ? `${q.year}-${bounds[1]}` : isoFromDate(q.end);
}

function clampFrac(value, quarterCount) {
  return Math.max(0, Math.min(quarterCount, value));
}

/** Snap a raw drag (in quarter units) to whole quarters; always at least one. */
function snapSpan(startFrac, currentFrac, quarterCount) {
  const min = Math.min(startFrac, currentFrac);
  const max = Math.max(startFrac, currentFrac);
  const startQi = Math.max(0, Math.min(quarterCount - 1, Math.floor(min)));
  const endExcl = Math.max(startQi + 1, Math.min(quarterCount, Math.ceil(max)));
  return { startQi, endExcl };
}

export default function RoadmapGrid({
  data,
  quarters,
  filterState,
  onShowTooltip,
  onHideTooltip,
  onSelect,
  canCreate = false,
  onCreateRange,
  onToggleDone,
  today = new Date(),
}) {
  // Unselected domains are hidden outright rather than faded out.
  const rows = getRoadmapRows(data, quarters).filter((row) =>
    rowMatchesDomainFilter(row.id, filterState)
  );
  const quarterCount = quarters.length;
  const todayInRange =
    quarterCount > 0 && today >= quarters[0].start && today <= quarters[quarterCount - 1].end;
  const todayPos = todayInRange ? dateToTimelinePosition(today, quarters, "start") : null;
  const currentQi = todayInRange ? Math.min(quarterCount - 1, Math.floor(todayPos)) : -1;
  const yearSpans = buildYearSpans(quarters);

  const dragRef = useRef(null);
  const [dragging, setDragging] = useState(false);
  const [overlay, setOverlay] = useState(null);

  const computeFrac = useCallback(
    (clientX) => {
      const rect = dragRef.current?.rect;
      if (!rect || rect.width === 0) return 0;
      return clampFrac(((clientX - rect.left) / rect.width) * quarterCount, quarterCount);
    },
    [quarterCount]
  );

  const buildOverlay = useCallback(() => {
    const drag = dragRef.current;
    if (!drag) return null;
    const { startQi, endExcl } = snapSpan(drag.startFrac, drag.currentFrac, quarterCount);
    return {
      domain: drag.domain,
      startQi,
      endExcl,
      startLabel: `${quarters[startQi].label} ${quarters[startQi].year}`,
      endLabel: `${quarters[endExcl - 1].label} ${quarters[endExcl - 1].year}`,
    };
  }, [quarterCount, quarters]);

  const handleTrackMouseDown = useCallback(
    (e, row) => {
      if (!canCreate || e.button !== 0) return;
      // Don't start a selection when grabbing an existing bar.
      if (e.target.closest(".initiative")) return;
      const rect = e.currentTarget.getBoundingClientRect();
      const frac = clampFrac(((e.clientX - rect.left) / rect.width) * quarterCount, quarterCount);
      dragRef.current = {
        rect,
        domain: row.id,
        startFrac: frac,
        currentFrac: frac,
        startClientX: e.clientX,
        moved: false,
      };
      setDragging(true);
      setOverlay(buildOverlay());
      e.preventDefault();
    },
    [canCreate, quarterCount, buildOverlay]
  );

  useEffect(() => {
    if (!dragging) return undefined;

    const cancel = () => {
      dragRef.current = null;
      setDragging(false);
      setOverlay(null);
    };
    const onMove = (e) => {
      const drag = dragRef.current;
      if (!drag) return;
      if (Math.abs(e.clientX - drag.startClientX) > 4) drag.moved = true;
      drag.currentFrac = computeFrac(e.clientX);
      setOverlay(buildOverlay());
    };
    const onUp = () => {
      const drag = dragRef.current;
      // Only a real drag creates a range — a stray click on empty track
      // shouldn't pop the Add modal.
      if (drag && drag.moved && onCreateRange) {
        const { startQi, endExcl } = snapSpan(drag.startFrac, drag.currentFrac, quarterCount);
        onCreateRange({
          domain: drag.domain,
          timelineStart: quarterStartISO(quarters[startQi]),
          timelineEnd: quarterEndISO(quarters[endExcl - 1]),
        });
      }
      cancel();
    };
    const onKeyDown = (e) => {
      if (e.key === "Escape") cancel();
    };

    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
    window.addEventListener("keydown", onKeyDown);
    return () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [dragging, computeFrac, buildOverlay, onCreateRange, quarterCount, quarters]);

  return (
    <div
      className="roadmap__grid"
      style={{
        gridTemplateColumns: `var(--label-width) repeat(${quarterCount}, minmax(var(--quarter-min), 1fr))`,
        gridTemplateRows: `auto auto repeat(${rows.length}, minmax(68px, auto))`,
      }}
    >
      <div
        className="roadmap__corner"
        style={{ gridColumn: "1", gridRow: `1 / ${HEADER_ROWS + 1}` }}
      />

      {yearSpans.map(({ year, count, startCol }) => (
        <div
          key={year}
          className="year-cell"
          style={{ gridColumn: `${startCol} / span ${count}`, gridRow: "1" }}
        >
          {year}
        </div>
      ))}

      {quarters.map((q, i) => (
        <div
          key={`${q.year}-${q.label}-${i}`}
          className={`quarter-cell${i === currentQi ? " quarter-cell--current" : ""}`}
          style={{ gridColumn: String(i + 2), gridRow: "2" }}
        >
          {q.label}
          {i === currentQi ? <span className="quarter-cell__now">Now</span> : null}
        </div>
      ))}

      {currentQi >= 0 ? (
        <div
          className="roadmap__current-col"
          aria-hidden="true"
          style={{ gridColumn: String(currentQi + 2), gridRow: `${HEADER_ROWS + 1} / -1` }}
        />
      ) : null}

      {todayPos != null && rows.length > 0 ? (
        <div
          className="roadmap__today-layer"
          aria-hidden="true"
          style={{ gridColumn: "2 / -1", gridRow: `2 / -1` }}
        >
          <div
            className="roadmap__today-line"
            style={{ left: timelinePositionToCss(todayPos, quarterCount) }}
          >
            <span className="roadmap__today-flag">Today</span>
          </div>
        </div>
      ) : null}

      {rows.map((row, rowIndex) => {
        const gridRow = HEADER_ROWS + rowIndex + 1;
        const laneCount = Math.max(1, ...row.initiatives.map((item) => item.lane + 1));
        const rowOverlay = overlay && overlay.domain === row.id ? overlay : null;
        const summary = summarizeDomain(data[row.id], today);

        return (
          <Fragment key={row.id}>
            <div
              className="roadmap__row-label"
              style={{ gridColumn: "1", gridRow: String(gridRow) }}
            >
              <span className="roadmap__row-name">{row.label}</span>
              <span className="roadmap__row-stats">
                {summary.inFlight ? <span>{summary.inFlight} in flight</span> : null}
                {summary.done ? (
                  <span className="roadmap__row-stat--done">✓ {summary.done} done</span>
                ) : null}
                {summary.atRisk ? (
                  <span className="roadmap__row-stat--risk">{summary.atRisk} at risk</span>
                ) : null}
              </span>
            </div>
            <div
              className="roadmap__track"
              style={{
                gridColumn: "2 / -1",
                gridRow: String(gridRow),
                "--quarter-count": quarterCount,
                "--lane-count": laneCount,
              }}
            >
              <div
                className={`roadmap__track-canvas${canCreate ? " roadmap__track-canvas--creatable" : ""}`}
                onMouseDown={canCreate ? (e) => handleTrackMouseDown(e, row) : undefined}
              >
                {rowOverlay ? (
                  <div
                    className="roadmap__range-select"
                    style={{
                      left: timelinePositionToCss(rowOverlay.startQi, quarterCount),
                      width: `calc(${timelinePositionToCss(rowOverlay.endExcl, quarterCount)} - ${timelinePositionToCss(rowOverlay.startQi, quarterCount)})`,
                    }}
                  >
                    <span className="roadmap__range-select-label">
                      {rowOverlay.startLabel}
                      {rowOverlay.endLabel !== rowOverlay.startLabel
                        ? ` – ${rowOverlay.endLabel}`
                        : ""}
                    </span>
                  </div>
                ) : null}
                {row.initiatives.map((item) => (
                  <InitiativeBar
                    key={item.id}
                    item={item}
                    category={row.id}
                    filterState={filterState}
                    onShowTooltip={onShowTooltip}
                    onHideTooltip={onHideTooltip}
                    onSelect={onSelect}
                    onToggleDone={onToggleDone}
                  />
                ))}
              </div>
            </div>
          </Fragment>
        );
      })}
    </div>
  );
}
