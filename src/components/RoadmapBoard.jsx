import { useState } from "react";
import {
  addQuarters,
  formatQuarterRange,
  getDomainKeys,
  getDomainNameMap,
  formatDomainLabel,
  HORIZONS,
  horizonOf,
  horizonQuarterOffset,
  initiativeMatchesFilter,
  isAtRiskStatus,
  isDoneStatus,
  isProgressTrackable,
  displayProgress,
  quarterIndex,
  quarterLabel,
  quarterOf,
  rowMatchesDomainFilter,
  summarizeDomain,
} from "../utils/roadmapUtils";
import { CONFIDENCE_LEVELS, confidenceClass, resolveConfidence } from "../config/confidenceConfig";
import { resolveStatus } from "../config/statusConfig";
import { ConfidenceBadge, DoneToggle } from "./RoadmapBits";

const DRAG_MIME = "application/x-roadmap-initiative";

/** At risk first, then by confidence, finished work last. */
function cardRank(item) {
  if (isDoneStatus(item.status)) return 100;
  if (isAtRiskStatus(item.status)) return 0;
  return 1 + CONFIDENCE_LEVELS.findIndex((c) => c.label === resolveConfidence(item.confidence));
}

/** Column an item shows in: unfinished work that ran past its end stays in Now as overdue. */
function boardColumn(item, today) {
  const h = horizonOf(item, today);
  if (h !== "past") return { column: h, overdue: false };
  if (isDoneStatus(item.status)) return { column: null, overdue: false };
  return { column: "now", overdue: true };
}

function horizonHeading(horizonId, now) {
  const q = addQuarters(now, horizonQuarterOffset(horizonId));
  return horizonId === "later" ? `${quarterLabel(q)} +` : quarterLabel(q);
}

function BoardCard({ item, domain, statuses, overdue, canEdit, onSelect, onToggleDone }) {
  const done = isDoneStatus(item.status);
  const risk = isAtRiskStatus(item.status);
  const progress = isProgressTrackable(item.status) ? displayProgress(item) : 0;
  const status = item.status ? resolveStatus(item.status, statuses) : null;
  const showStatus = status && !done && !/^in progress$|^future$/i.test(item.status);
  const className = [
    "board-card",
    `board-card--${confidenceClass(item.confidence)}`,
    done && "board-card--done",
    risk && "board-card--risk",
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <div
      className={className}
      role="button"
      tabIndex={0}
      draggable={canEdit}
      onDragStart={
        canEdit
          ? (e) => {
              e.dataTransfer.setData(DRAG_MIME, JSON.stringify({ domain, id: item.id }));
              e.dataTransfer.effectAllowed = "move";
            }
          : undefined
      }
      onClick={() => onSelect?.({ domain, id: item.id })}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onSelect?.({ domain, id: item.id });
        }
      }}
    >
      <div className="board-card__top">
        <DoneToggle item={item} domain={domain} onToggle={canEdit ? onToggleDone : undefined} />
        <span className="board-card__name">{item.name}</span>
      </div>
      <div className="board-card__meta">
        <span className="board-card__when">{formatQuarterRange(item.timeline)}</span>
        {!done ? <ConfidenceBadge value={item.confidence} compact /> : null}
        {overdue ? <span className="board-card__flag board-card__flag--overdue">Overdue</span> : null}
        {showStatus ? (
          <span className="board-card__flag" style={{ "--flag-color": status.color }}>
            {item.status}
          </span>
        ) : null}
      </div>
      {item.owner ? <div className="board-card__owner">{item.owner}</div> : null}
      {progress > 0 ? (
        <div
          className="board-card__progress"
          role="progressbar"
          aria-label="Progress"
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={progress}
          title={`${progress}% complete`}
        >
          <span className="board-card__progress-fill" style={{ width: `${progress}%` }} />
        </div>
      ) : null}
    </div>
  );
}

export default function RoadmapBoard({
  data,
  filterState,
  canEdit = false,
  onSelect,
  onToggleDone,
  onAddInCell,
  onMove,
  today = new Date(),
}) {
  const [dropTarget, setDropTarget] = useState(null);
  const now = quarterOf(today);
  const domainNames = getDomainNameMap(data);
  const statuses = data.statuses || [];
  const domains = getDomainKeys(data).filter((d) => rowMatchesDomainFilter(d, filterState));

  const handleDrop = (e, domain, horizonId) => {
    e.preventDefault();
    setDropTarget(null);
    let payload;
    try {
      payload = JSON.parse(e.dataTransfer.getData(DRAG_MIME));
    } catch {
      return;
    }
    if (!payload || payload.domain !== domain) return;
    const item = (data[domain] || []).find((p) => p.id === payload.id);
    const start = item ? quarterOf(item.timeline?.[0]) : null;
    if (!item || !start) return;
    const current = boardColumn(item, today).column;
    if (current === horizonId) return;
    const delta = horizonQuarterOffset(horizonId) - (quarterIndex(start) - quarterIndex(now));
    if (delta) onMove?.({ domain, item, quarters: delta });
  };

  return (
    <div className="board" role="table" aria-label="Roadmap board: now, next, later">
      <div className="board__row board__row--head" role="row">
        <div className="board__corner" role="columnheader">
          Domain
        </div>
        {HORIZONS.map((h) => (
          <div key={h.id} className={`board__head board__head--${h.id}`} role="columnheader">
            <span className="board__head-title">{h.label}</span>
            <span className="board__head-sub">{horizonHeading(h.id, now)}</span>
          </div>
        ))}
      </div>

      {domains.length === 0 ? (
        <p className="board__empty">No domains match the current filters.</p>
      ) : null}

      {domains.map((domain) => {
        const items = data[domain] || [];
        const summary = summarizeDomain(items, today);
        const byColumn = { now: [], next: [], later: [] };
        items.forEach((item) => {
          if (!initiativeMatchesFilter(item, domain, filterState)) return;
          const { column, overdue } = boardColumn(item, today);
          if (column) byColumn[column].push({ item, overdue });
        });
        Object.values(byColumn).forEach((list) =>
          list.sort((a, b) => cardRank(a.item) - cardRank(b.item))
        );

        return (
          <div key={domain} className="board__row" role="row">
            <div className="board__domain" role="rowheader">
              <span className="board__domain-name">
                {domainNames[domain] || formatDomainLabel(domain)}
              </span>
              <span className="board__chips">
                <span className="board__chip">{summary.inFlight} in flight</span>
                {summary.done ? (
                  <span className="board__chip board__chip--done">✓ {summary.done} done</span>
                ) : null}
                {summary.atRisk ? (
                  <span className="board__chip board__chip--risk">{summary.atRisk} at risk</span>
                ) : null}
                {summary.upcoming ? (
                  <span className="board__chip board__chip--muted">{summary.upcoming} coming up</span>
                ) : null}
              </span>
            </div>

            {HORIZONS.map((h) => {
              const key = `${domain}:${h.id}`;
              const cards = byColumn[h.id];
              return (
                <div
                  key={h.id}
                  role="cell"
                  className={`board__cell board__cell--${h.id}${
                    dropTarget === key ? " is-drop-target" : ""
                  }`}
                  onDragOver={
                    canEdit
                      ? (e) => {
                          if (!e.dataTransfer.types.includes(DRAG_MIME)) return;
                          e.preventDefault();
                          if (dropTarget !== key) setDropTarget(key);
                        }
                      : undefined
                  }
                  onDragLeave={canEdit ? () => setDropTarget(null) : undefined}
                  onDrop={canEdit ? (e) => handleDrop(e, domain, h.id) : undefined}
                >
                  {cards.map(({ item, overdue }) => (
                    <BoardCard
                      key={item.id}
                      item={item}
                      domain={domain}
                      statuses={statuses}
                      overdue={overdue}
                      canEdit={canEdit}
                      onSelect={onSelect}
                      onToggleDone={onToggleDone}
                    />
                  ))}
                  {cards.length === 0 && !canEdit ? (
                    <span className="board__cell-empty">—</span>
                  ) : null}
                  {canEdit && onAddInCell ? (
                    <button
                      type="button"
                      className="board__add"
                      onClick={() =>
                        onAddInCell({ domain, quarterOffset: horizonQuarterOffset(h.id) })
                      }
                      aria-label={`Add initiative to ${domainNames[domain] || domain}, ${h.label}`}
                    >
                      + Add
                    </button>
                  ) : null}
                </div>
              );
            })}
          </div>
        );
      })}
    </div>
  );
}
