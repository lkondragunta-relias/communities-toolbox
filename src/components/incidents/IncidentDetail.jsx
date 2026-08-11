import { useEffect, useRef } from "react";
import {
  formatDuration,
  formatEventRange,
  formatRevenue,
} from "../../utils/incidentUtils";

function Field({ label, children }) {
  return (
    <div className="detail__field">
      <span className="detail__field-label">{label}</span>
      <span className="detail__field-value">{children}</span>
    </div>
  );
}

export default function IncidentDetail({ entry, canEdit, onEdit, onDelete, onClose }) {
  const open = Boolean(entry);
  const panelRef = useRef(null);

  useEffect(() => {
    if (!open) return undefined;
    panelRef.current?.focus();
    const onKey = (e) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  return (
    <div
      className={`detail-overlay${open ? " is-open" : ""}`}
      onClick={onClose}
      role="presentation"
    >
      <aside
        ref={panelRef}
        tabIndex={-1}
        className="detail ops-detail"
        role="dialog"
        aria-modal="true"
        aria-label="Event details"
        onClick={(e) => e.stopPropagation()}
      >
        {entry ? (
          <>
            <header className="detail__head">
              <div className="detail__head-text">
                <span className="detail__id">
                  {entry.id} · {entry.domainLabel}
                </span>
                <h2 className="detail__title">{entry.title}</h2>
              </div>
              <button type="button" className="detail__close" aria-label="Close" onClick={onClose}>
                ×
              </button>
            </header>

            <div className="detail__badges">
              <span className="ops-pill" style={{ "--pill-color": entry.severity.color }}>
                {entry.severity.label}
              </span>
              <span className="ops-pill ops-pill--ghost" style={{ "--pill-color": entry.type.color }}>
                {entry.type.label}
              </span>
              <span className="ops-pill ops-pill--ghost" style={{ "--pill-color": entry.status.color }}>
                {entry.status.label}
              </span>
            </div>

            <div className="detail__body">
              <Field label="When">{formatEventRange(entry)}</Field>
              <Field label="Duration">
                {entry.ongoing ? "Ongoing" : formatDuration(entry.durationMinutes)}
              </Field>
              <Field label="Customer impact">{entry.customerImpact || "—"}</Field>
              <Field label="Revenue impact">{formatRevenue(entry.revenue)}</Field>
              <div className="detail__field detail__field--block">
                <span className="detail__field-label">Notes / cause</span>
                <p className="detail__desc">{entry.notes || "No notes recorded."}</p>
              </div>
              <div className="detail__field detail__field--block">
                <span className="detail__field-label">Links</span>
                {entry.links.length === 0 ? (
                  <p className="detail__desc">—</p>
                ) : (
                  <ul className="ops-detail__links">
                    {entry.links.map((link, i) => (
                      <li key={`${link.label}-${i}`}>
                        {link.url ? (
                          <a href={link.url} target="_blank" rel="noopener noreferrer">
                            {link.label}
                          </a>
                        ) : (
                          <span className="ops-detail__link-text">{link.label}</span>
                        )}
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </div>

            {canEdit ? (
              <footer className="detail__footer">
                <button
                  type="button"
                  className="detail__btn detail__btn--primary"
                  onClick={() => onEdit?.(entry)}
                >
                  Edit
                </button>
                <button
                  type="button"
                  className="detail__btn detail__btn--danger"
                  onClick={() => onDelete?.(entry)}
                >
                  Delete
                </button>
              </footer>
            ) : null}
          </>
        ) : null}
      </aside>
    </div>
  );
}
