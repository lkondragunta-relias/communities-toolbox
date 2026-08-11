import { useCallback, useEffect, useRef, useState } from "react";
import {
  INCIDENT_SEVERITIES,
  INCIDENT_SEVERITY_LABELS,
  INCIDENT_STATUSES,
  INCIDENT_STATUS_LABELS,
  INCIDENT_TYPES,
  INCIDENT_TYPE_LABELS,
} from "../../config/incidentConfig";
import { parseDurationMinutes } from "../../utils/incidentUtils";
import { validateIncidentForm } from "../../services/sheetsApi";

const DURATION_PRESETS = ["15m", "30m", "1h", "2h", "4h", "8h", "24h"];
const REVENUE_PRESETS = ["$", "$$", "$$$", "$$$$"];

const EMPTY_FORM = {
  id: "",
  startDate: "",
  startTime: "",
  endDate: "",
  endTime: "",
  domain: "",
  title: "",
  type: "Outage",
  severity: "High",
  duration: "",
  ongoing: false,
  customerImpact: "",
  revenueImpact: "",
  status: "Resolved",
  notes: "",
  links: "",
};

function todayISO() {
  const d = new Date();
  const pad = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function nowTime() {
  const d = new Date();
  const pad = (n) => String(n).padStart(2, "0");
  return `${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export default function IncidentModal({
  mode = "add",
  initialValues = null,
  domainOptions = [],
  adminToken,
  onUnlock,
  onLock,
  onClose,
  onSave,
}) {
  const isEdit = mode === "edit";
  const unlocked = Boolean(adminToken);
  const [tokenInput, setTokenInput] = useState("");
  const [form, setForm] = useState(() => ({
    ...EMPTY_FORM,
    startDate: todayISO(),
    ...(initialValues || {}),
  }));
  const [errors, setErrors] = useState({});
  const panelRef = useRef(null);

  useEffect(() => {
    panelRef.current?.focus();
    const onKey = (e) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const update = useCallback((name, value) => {
    setForm((prev) => ({ ...prev, [name]: value }));
    setErrors((prev) => {
      const next = { ...prev };
      delete next[name];
      return next;
    });
  }, []);

  const handleUnlock = useCallback(
    (e) => {
      e.preventDefault();
      const trimmed = tokenInput.trim();
      if (trimmed) onUnlock?.(trimmed);
    },
    [onUnlock, tokenInput]
  );

  const handleSubmit = useCallback(
    (e) => {
      e.preventDefault();
      const { errors: found, valid } = validateIncidentForm(form, {
        validTypes: INCIDENT_TYPE_LABELS,
        validSeverities: INCIDENT_SEVERITY_LABELS,
        validStatuses: INCIDENT_STATUS_LABELS,
        parseDuration: parseDurationMinutes,
      });
      if (!valid) {
        setErrors(found);
        return;
      }

      // "Still ongoing" is stored with no end and no duration on an open status —
      // the dashboard grows the bar to the current time from there.
      const ongoing = Boolean(form.ongoing);
      const status = ongoing && form.status === "Resolved" ? "Active" : form.status;
      const stamp = (date, time) => (date ? (time ? `${date} ${time}` : date) : "");

      onSave?.({
        id: form.id,
        start: stamp(form.startDate, form.startTime),
        end: ongoing ? "" : stamp(form.endDate, form.endTime),
        domain: form.domain.trim(),
        title: form.title.trim(),
        type: form.type,
        severity: form.severity,
        // With an end timestamp the duration is derived, so the column is left
        // blank rather than storing a value that could drift out of agreement.
        duration: ongoing || form.endDate ? "" : form.duration.trim(),
        customerImpact: form.customerImpact.trim(),
        revenueImpact: form.revenueImpact.trim(),
        status,
        notes: form.notes.trim(),
        links: form.links.trim(),
      });
      onClose();
    },
    [form, onSave, onClose]
  );

  const error = (name) =>
    errors[name] ? <span className="admin-field__error">{errors[name]}</span> : null;

  return (
    <div className="admin-modal" role="presentation">
      <aside
        ref={panelRef}
        tabIndex={-1}
        className="admin-modal__panel ops-modal"
        role="dialog"
        aria-labelledby="ops-modal-title"
        aria-modal="true"
      >
        <header className="admin-modal__header">
          <div className="admin-modal__header-text">
            <h2 id="ops-modal-title" className="admin-modal__title">
              {isEdit ? "Edit event" : "Add event"}
            </h2>
            <p className="admin-modal__subtitle">
              {isEdit ? `Updating ${form.id}` : "Outage, incident, release or change — about a minute"}
            </p>
          </div>
          <button type="button" className="admin-modal__close" aria-label="Close" onClick={onClose}>
            <span aria-hidden="true">×</span>
          </button>
        </header>

        {!unlocked ? (
          <form className="admin-modal__form" onSubmit={handleUnlock}>
            <div className="admin-modal__scroll theme-scroll">
              <p className="admin-modal__hint">
                Enter the admin token to log events. It stays unlocked for this browser session.
              </p>
              <label className="admin-field">
                <span className="admin-field__label">Admin token</span>
                <input
                  type="password"
                  className="admin-field__input"
                  value={tokenInput}
                  onChange={(e) => setTokenInput(e.target.value)}
                  autoComplete="off"
                  required
                />
              </label>
            </div>
            <footer className="admin-modal__footer">
              <button type="button" className="admin-btn admin-btn--ghost" onClick={onClose}>
                Cancel
              </button>
              <button type="submit" className="admin-btn admin-btn--primary">
                Unlock
              </button>
            </footer>
          </form>
        ) : (
          <form className="admin-modal__form" onSubmit={handleSubmit}>
            <div className="admin-modal__scroll theme-scroll">
              <div className="ops-when">
                <label className="admin-field ops-when__field">
                  <span className="admin-field__label">
                    Started <span className="admin-field__req">*</span>
                  </span>
                  <div className="ops-field-inline">
                    <input
                      type="date"
                      className="admin-field__input"
                      value={form.startDate}
                      onChange={(e) => update("startDate", e.target.value)}
                      required
                    />
                    <input
                      type="time"
                      className="admin-field__input ops-field-time"
                      aria-label="Start time"
                      value={form.startTime}
                      onChange={(e) => update("startTime", e.target.value)}
                    />
                    <button
                      type="button"
                      className="ops-chip"
                      title="Set to right now"
                      onClick={() =>
                        setForm((p) => ({ ...p, startDate: todayISO(), startTime: nowTime() }))
                      }
                    >
                      Now
                    </button>
                  </div>
                  {error("startDate") || error("startTime")}
                </label>

                <label className="admin-field ops-when__field">
                  <span className="admin-field__label">Ended</span>
                  <div className="ops-field-inline">
                    <input
                      type="date"
                      className="admin-field__input"
                      value={form.endDate}
                      onChange={(e) => update("endDate", e.target.value)}
                      disabled={form.ongoing}
                    />
                    <input
                      type="time"
                      className="admin-field__input ops-field-time"
                      aria-label="End time"
                      value={form.endTime}
                      onChange={(e) => update("endTime", e.target.value)}
                      disabled={form.ongoing}
                    />
                    <button
                      type="button"
                      className="ops-chip"
                      title="Set to right now"
                      disabled={form.ongoing}
                      onClick={() =>
                        setForm((p) => ({ ...p, endDate: todayISO(), endTime: nowTime() }))
                      }
                    >
                      Now
                    </button>
                  </div>
                  <span className="admin-field__hint-inline">
                    {form.endDate
                      ? "Duration is calculated from these two times."
                      : "Leave blank and set a duration instead, or mark it ongoing."}
                  </span>
                  {error("endDate") || error("endTime")}
                </label>
              </div>

              <label className="admin-field">
                <span className="admin-field__label">
                  Domain / system <span className="admin-field__req">*</span>
                </span>
                <input
                  type="text"
                  className="admin-field__input"
                  list="ops-domain-options"
                  value={form.domain}
                  onChange={(e) => update("domain", e.target.value)}
                  placeholder="e.g. Relias Academy"
                  required
                />
                <datalist id="ops-domain-options">
                  {domainOptions.map((d) => (
                    <option key={d} value={d} />
                  ))}
                </datalist>
                {error("domain")}
              </label>

              <label className="admin-field">
                <span className="admin-field__label">
                  Title <span className="admin-field__req">*</span>
                </span>
                <input
                  type="text"
                  className="admin-field__input"
                  value={form.title}
                  onChange={(e) => update("title", e.target.value)}
                  placeholder="e.g. Session Expiry"
                  required
                />
                {error("title")}
              </label>

              <div className="admin-field-row">
                <label className="admin-field">
                  <span className="admin-field__label">
                    Type <span className="admin-field__req">*</span>
                  </span>
                  <select
                    className="admin-field__input"
                    value={form.type}
                    onChange={(e) => update("type", e.target.value)}
                  >
                    {INCIDENT_TYPES.map((t) => (
                      <option key={t.id} value={t.label}>
                        {t.label}
                      </option>
                    ))}
                  </select>
                  {error("type")}
                </label>

                <label className="admin-field">
                  <span className="admin-field__label">
                    Severity <span className="admin-field__req">*</span>
                  </span>
                  <select
                    className="admin-field__input"
                    value={form.severity}
                    onChange={(e) => update("severity", e.target.value)}
                  >
                    {INCIDENT_SEVERITIES.map((s) => (
                      <option key={s.id} value={s.label}>
                        {s.label}
                      </option>
                    ))}
                  </select>
                  {error("severity")}
                </label>
              </div>

              <div className="admin-field" hidden={Boolean(form.endDate)}>
                <span className="admin-field__label">Duration</span>
                <div className="ops-field-inline">
                  <input
                    type="text"
                    className="admin-field__input"
                    value={form.duration}
                    onChange={(e) => update("duration", e.target.value)}
                    placeholder="2h 30m"
                    disabled={form.ongoing || Boolean(form.endDate)}
                  />
                  <label className="ops-check">
                    <input
                      type="checkbox"
                      checked={form.ongoing}
                      onChange={(e) => update("ongoing", e.target.checked)}
                    />
                    <span>Still ongoing</span>
                  </label>
                </div>
                {!form.ongoing && !form.endDate ? (
                  <div className="ops-chip-row">
                    {DURATION_PRESETS.map((preset) => (
                      <button
                        key={preset}
                        type="button"
                        className={`ops-chip${form.duration === preset ? " is-on" : ""}`}
                        onClick={() => update("duration", preset)}
                      >
                        {preset}
                      </button>
                    ))}
                  </div>
                ) : null}
                {error("duration")}
              </div>

              <label className="admin-field">
                <span className="admin-field__label">Customer impact</span>
                <input
                  type="text"
                  className="admin-field__input"
                  value={form.customerImpact}
                  onChange={(e) => update("customerImpact", e.target.value)}
                  placeholder="e.g. Login & Checkout"
                />
              </label>

              <div className="admin-field-row">
                <div className="admin-field">
                  <span className="admin-field__label">Revenue impact</span>
                  <input
                    type="text"
                    className="admin-field__input"
                    value={form.revenueImpact}
                    onChange={(e) => update("revenueImpact", e.target.value)}
                    placeholder="$48,000 or $$$"
                  />
                  <div className="ops-chip-row">
                    {REVENUE_PRESETS.map((preset) => (
                      <button
                        key={preset}
                        type="button"
                        className={`ops-chip${form.revenueImpact === preset ? " is-on" : ""}`}
                        onClick={() => update("revenueImpact", preset)}
                      >
                        {preset}
                      </button>
                    ))}
                  </div>
                </div>

                <label className="admin-field">
                  <span className="admin-field__label">
                    Status <span className="admin-field__req">*</span>
                  </span>
                  <select
                    className="admin-field__input"
                    value={form.status}
                    onChange={(e) => update("status", e.target.value)}
                  >
                    {INCIDENT_STATUSES.map((s) => (
                      <option key={s.id} value={s.label}>
                        {s.label}
                      </option>
                    ))}
                  </select>
                  {error("status")}
                </label>
              </div>

              <label className="admin-field">
                <span className="admin-field__label">Notes / cause</span>
                <textarea
                  className="admin-field__input admin-field__textarea"
                  rows={3}
                  value={form.notes}
                  onChange={(e) => update("notes", e.target.value)}
                  placeholder="What happened and why"
                />
              </label>

              <label className="admin-field">
                <span className="admin-field__label">Links</span>
                <textarea
                  className="admin-field__input admin-field__textarea"
                  rows={2}
                  value={form.links}
                  onChange={(e) => update("links", e.target.value)}
                  placeholder={"One per line — Jira | https://…\nor just: Incident Report"}
                />
                <span className="admin-field__hint-inline">
                  Plain names are kept as labels; anything starting with http:// or https:// becomes
                  a clickable link.
                </span>
              </label>
            </div>

            <footer className="admin-modal__footer">
              {onLock ? (
                <button
                  type="button"
                  className="admin-btn admin-btn--ghost admin-btn--lock"
                  title="Forget the admin token on this device"
                  onClick={() => {
                    onLock();
                    onClose();
                  }}
                >
                  Lock
                </button>
              ) : null}
              <button type="button" className="admin-btn admin-btn--ghost" onClick={onClose}>
                Cancel
              </button>
              <button type="submit" className="admin-btn admin-btn--primary">
                {isEdit ? "Save changes" : "Add event"}
              </button>
            </footer>
          </form>
        )}
      </aside>
    </div>
  );
}
