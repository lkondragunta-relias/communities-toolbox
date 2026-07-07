import { useEffect, useRef } from "react";
import {
  formatDomainLabel,
  formatTimelineRange,
  parseInitiativeTeams,
} from "../utils/roadmapUtils";
import { resolveStatus } from "../config/statusConfig";
import { resolvePriority } from "../config/priorityConfig";

function Field({ label, children }) {
  return (
    <div className="detail__field">
      <span className="detail__field-label">{label}</span>
      <span className="detail__field-value">{children}</span>
    </div>
  );
}

export default function ProjectDetail({
  data,
  selected,
  canEdit,
  canDelete,
  onEdit,
  onDelete,
  onClose,
}) {
  const item = selected
    ? (data[selected.domain] || []).find((p) => p.id === selected.id)
    : null;

  const open = Boolean(item);
  const panelRef = useRef(null);

  // Keyboard support: move focus into the drawer and close on Escape.
  useEffect(() => {
    if (!open) return undefined;
    panelRef.current?.focus();
    const onKey = (e) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  const statuses = data.statuses || [];
  const priorities = data.priorities || [];
  const status = item ? resolveStatus(item.status, statuses) : null;
  const priority = item?.priority ? resolvePriority(item.priority, priorities) : null;
  const teamLabels = new Map((data.teams || []).map((t) => [t.id, t.label || t.id]));
  const teams = item ? parseInitiativeTeams(item).map((id) => teamLabels.get(id) || id) : [];

  return (
    <div className={`detail-overlay${open ? " is-open" : ""}`} onClick={onClose} role="presentation">
      <aside
        ref={panelRef}
        tabIndex={-1}
        className="detail"
        role="dialog"
        aria-modal="true"
        aria-label="Project details"
        onClick={(e) => e.stopPropagation()}
      >
        {item ? (
          <>
            <header className="detail__head">
              <div className="detail__head-text">
                <span className="detail__id">{item.id}</span>
                <h2 className="detail__title">{item.name}</h2>
              </div>
              <button type="button" className="detail__close" aria-label="Close" onClick={onClose}>
                ×
              </button>
            </header>

            <div className="detail__badges">
              {item.status ? (
                <span className="detail__pill" style={{ "--pill-color": status.color }}>
                  {item.status}
                </span>
              ) : null}
              {priority ? (
                <span className="detail__priority" style={{ "--priority-color": priority.color }}>
                  {priority.label} priority
                </span>
              ) : null}
            </div>

            <div className="detail__body">
              <Field label="Domain">{formatDomainLabel(item.domain || selected.domain)}</Field>
              <Field label="Timeline">{formatTimelineRange(item.timeline) || "—"}</Field>
              <Field label="Owner">{item.owner || "—"}</Field>
              <Field label="Teams">{teams.length ? teams.join(", ") : "—"}</Field>
              {typeof item.progress === "number" ? (
                <Field label="Progress">
                  <span className="detail__progress">
                    <span className="detail__progress-bar" style={{ width: `${item.progress}%` }} />
                    <span className="detail__progress-text">{item.progress}%</span>
                  </span>
                </Field>
              ) : null}
              <Field label="Link">
                {item.link ? (
                  <a href={item.link} target="_blank" rel="noopener noreferrer">
                    {item.link}
                  </a>
                ) : (
                  "—"
                )}
              </Field>
              <div className="detail__field detail__field--block">
                <span className="detail__field-label">Description</span>
                <p className="detail__desc">{item.description || "No description."}</p>
              </div>
            </div>

            {(canEdit || canDelete) && (
              <footer className="detail__footer">
                {canEdit ? (
                  <button
                    type="button"
                    className="detail__btn detail__btn--primary"
                    onClick={() => onEdit?.({ domain: selected.domain, item })}
                  >
                    Edit
                  </button>
                ) : null}
                {canDelete ? (
                  <button
                    type="button"
                    className="detail__btn detail__btn--danger"
                    onClick={() => onDelete?.({ team: selected.domain, id: item.id })}
                  >
                    Delete
                  </button>
                ) : null}
              </footer>
            )}
          </>
        ) : null}
      </aside>
    </div>
  );
}
