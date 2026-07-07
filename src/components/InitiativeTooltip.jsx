import { useCallback, useEffect, useRef, useState } from "react";
import { formatTimelineRange } from "../utils/roadmapUtils";
import { resolvePriority } from "../config/priorityConfig";

function positionTooltip(tooltipEl, target) {
  const rect = target.getBoundingClientRect();
  const gap = 8;
  const margin = 12;
  const tipRect = tooltipEl.getBoundingClientRect();
  let top = rect.top - tipRect.height - gap;
  let left = rect.left + rect.width / 2 - tipRect.width / 2;

  if (top < margin) {
    top = rect.bottom + gap;
  }
  left = Math.max(margin, Math.min(left, window.innerWidth - tipRect.width - margin));
  top = Math.max(margin, Math.min(top, window.innerHeight - tipRect.height - margin));

  tooltipEl.style.top = `${top}px`;
  tooltipEl.style.left = `${left}px`;
}

export default function InitiativeTooltip({
  item,
  target,
  domain,
  statuses = [],
  priorities = [],
  canEditStatus,
  canEdit,
  canDelete,
  onStatusChange,
  onEdit,
  onDelete,
  onDeleteStart,
  onDeleteError,
  onTooltipEnter,
  onTooltipLeave,
}) {
  const tooltipRef = useRef(null);
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState("");
  const [statusError, setStatusError] = useState("");
  const [localStatus, setLocalStatus] = useState("");

  useEffect(() => {
    if (!item || !target || !tooltipRef.current) return;

    positionTooltip(tooltipRef.current, target);

    const handleScroll = () => {
      if (tooltipRef.current && target) {
        positionTooltip(tooltipRef.current, target);
      }
    };

    window.addEventListener("scroll", handleScroll, true);
    return () => window.removeEventListener("scroll", handleScroll, true);
  }, [item, target, canDelete, canEditStatus, deleteError, statusError, localStatus]);

  // Reset transient state when the hovered initiative (or its status) changes.
  // Done during render — React's recommended alternative to a sync-setState effect.
  const resetKey = `${domain ?? ""}|${item?.id ?? ""}|${item?.status ?? ""}`;
  const [prevResetKey, setPrevResetKey] = useState(resetKey);
  if (resetKey !== prevResetKey) {
    setPrevResetKey(resetKey);
    setDeleteError("");
    setDeleting(false);
    setStatusError("");
    setLocalStatus(item?.status || "");
  }

  const handleDelete = useCallback(async () => {
    if (!item || !domain || !onDelete || deleting) return;
    const label = item.name || item.id;
    const confirmed = window.confirm(
      `Delete "${label}" (${item.id}) from the Google Sheet? This cannot be undone from the app.`
    );
    if (!confirmed) return;

    setDeleting(true);
    setDeleteError("");
    onDeleteStart?.();
    try {
      await onDelete({ team: domain, id: item.id });
    } catch (err) {
      onDeleteError?.();
      setDeleteError(err.message || "Failed to delete initiative.");
      setDeleting(false);
    }
  }, [deleting, domain, item, onDelete, onDeleteError, onDeleteStart]);

  const handleStatusSelect = useCallback(
    (e) => {
      const nextStatus = e.target.value;
      const currentStatus = localStatus || item?.status || "";
      if (!item || !domain || !onStatusChange || nextStatus === currentStatus) {
        return;
      }

      setLocalStatus(nextStatus);
      setStatusError("");

      void onStatusChange({ domain, id: item.id, status: nextStatus }).catch((err) => {
        setLocalStatus(item?.status || "");
        setStatusError(err.message || "Failed to update status.");
      });
    },
    [domain, item, localStatus, onStatusChange]
  );

  const displayStatus = localStatus || item?.status || "";

  const visible = Boolean(item && target);
  const interactive = visible && (canDelete || canEditStatus || canEdit);

  return (
    <div
      ref={tooltipRef}
      className={[
        "initiative-tooltip",
        visible && "is-visible",
        interactive && "initiative-tooltip--interactive",
      ]
        .filter(Boolean)
        .join(" ")}
      role="tooltip"
      hidden={!visible}
      onMouseEnter={onTooltipEnter}
      onMouseLeave={onTooltipLeave}
    >
      {item && (
        <>
          <span className="initiative-tooltip__name">{item.name}</span>
          {item.timeline ? (
            <span className="initiative-tooltip__timeline">
              {formatTimelineRange(item.timeline)}
            </span>
          ) : null}
          <div className="initiative-tooltip__badges">
            {displayStatus ? (
              <span className="initiative-tooltip__status-label">{displayStatus}</span>
            ) : null}
            {item.priority
              ? (() => {
                  const p = resolvePriority(item.priority, priorities);
                  return (
                    <span
                      className="initiative-tooltip__priority"
                      style={{ "--priority-color": p.color }}
                    >
                      {p.label}
                    </span>
                  );
                })()
              : null}
          </div>
          {item.owner ? (
            <span className="initiative-tooltip__owner">Owner: {item.owner}</span>
          ) : null}
          {item.description ? (
            <span className="initiative-tooltip__desc">{item.description}</span>
          ) : null}
          {item.link ? (
            <a
              className="initiative-tooltip__link"
              href={item.link}
              target="_blank"
              rel="noopener noreferrer"
            >
              Open link ↗
            </a>
          ) : null}
          {canEditStatus && statuses.length > 0 ? (
            <label className="initiative-tooltip__status-field">
              <span className="initiative-tooltip__status-field-label">Status</span>
              <select
                className="initiative-tooltip__status-select"
                value={localStatus}
                onChange={handleStatusSelect}
              >
                <option value="">—</option>
                {statuses.map((s) => (
                  <option key={s.id} value={s.label}>
                    {s.label}
                  </option>
                ))}
              </select>
              {statusError ? (
                <span className="initiative-tooltip__error">{statusError}</span>
              ) : null}
            </label>
          ) : null}
          {canEdit || canDelete ? (
            <div className="initiative-tooltip__actions">
              {canEdit ? (
                <button
                  type="button"
                  className="initiative-tooltip__edit"
                  disabled={deleting}
                  onClick={() =>
                    item && domain && onEdit?.({ domain, item })
                  }
                >
                  Edit
                </button>
              ) : null}
              {canDelete ? (
                <button
                  type="button"
                  className="initiative-tooltip__delete"
                  disabled={deleting}
                  onClick={handleDelete}
                >
                  {deleting ? "Deleting…" : "Delete"}
                </button>
              ) : null}
              {deleteError ? (
                <span className="initiative-tooltip__error">{deleteError}</span>
              ) : null}
            </div>
          ) : null}
        </>
      )}
    </div>
  );
}
