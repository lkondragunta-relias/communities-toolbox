import {
  formatTimelineRange,
  initiativeMatchesFilter,
  isAtRiskStatus,
  isDoneStatus,
  isItemFilterActive,
  timelinePositionToCss,
} from "../utils/roadmapUtils";
import { confidenceClass } from "../config/confidenceConfig";
import { DoneToggle } from "./RoadmapBits";

export default function InitiativeBar({
  item,
  category,
  filterState,
  onShowTooltip,
  onHideTooltip,
  onSelect,
  onToggleDone,
}) {
  // Domain selection hides whole rows, so only item-level filters highlight bars.
  const filterActive = isItemFilterActive(filterState);
  const matched = filterActive && initiativeMatchesFilter(item, category, filterState);
  const dimmed = filterActive && !matched;

  const className = [
    "initiative",
    matched && "initiative--matched",
    dimmed && "initiative--dimmed",
    `initiative--${confidenceClass(item.confidence)}`,
    isDoneStatus(item.status) && "initiative--done",
    isAtRiskStatus(item.status) && "initiative--risk",
    item.clippedStart && "initiative--clip-start",
    item.clippedEnd && "initiative--clip-end",
  ]
    .filter(Boolean)
    .join(" ");

  const description = item.description || "";
  const timeline = formatTimelineRange(item.timeline);
  const ariaParts = [item.name, timeline, description].filter(Boolean);
  const ariaLabel = ariaParts.join(" — ");

  const quarterCount = item.span.quarterCount || 1;
  const startPos = item.span.startPos ?? 0;
  const endPos = item.span.endPos ?? 1;
  const left = timelinePositionToCss(startPos, quarterCount);
  const width = `calc(${timelinePositionToCss(endPos, quarterCount)} - ${left})`;

  return (
    <div
      className={className}
      style={{
        "--accent": item.color,
        "--lane": item.lane,
        left,
        width,
      }}
      tabIndex={0}
      role={onSelect ? "button" : undefined}
      aria-label={ariaLabel}
      onMouseEnter={(e) => onShowTooltip(item, e.currentTarget, category)}
      onMouseLeave={onHideTooltip}
      onFocus={(e) => onShowTooltip(item, e.currentTarget, category)}
      onBlur={onHideTooltip}
      onClick={onSelect ? () => onSelect({ domain: category, id: item.id }) : undefined}
      onKeyDown={
        onSelect
          ? (e) => {
              if (e.key === "Enter" || e.key === " ") {
                e.preventDefault();
                onSelect({ domain: category, id: item.id });
              }
            }
          : undefined
      }
    >
      <DoneToggle item={item} domain={category} onToggle={onToggleDone} size="sm" />
      <span className="initiative__name">{item.name}</span>
    </div>
  );
}
