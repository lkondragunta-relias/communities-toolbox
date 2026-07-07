import { useState } from "react";
import {
  getDomainKeys,
  formatDomainLabel,
  parseInitiativeTeams,
  RESERVED_DATA_KEYS,
} from "../../utils/roadmapUtils";
import {
  addDomain,
  deleteDomain,
  addTeam,
  deleteTeam,
  addStatusDef,
  deleteStatusDef,
  addPriorityDef,
  deletePriorityDef,
  getGoogleSheetUrl,
} from "../../services/sheetsApi";

const EXIT_MS = 180;

function slugify(value) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function SettingsSection({
  title,
  description,
  items,
  hasColor,
  placeholder,
  onAdd,
  onDelete,
  validateDelete,
}) {
  const [label, setLabel] = useState("");
  const [color, setColor] = useState("#34954a");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [removingId, setRemovingId] = useState(null);

  const submit = async (e) => {
    e.preventDefault();
    setError("");
    setBusy(true);
    try {
      await onAdd(hasColor ? { label, color } : { label });
      setLabel("");
    } catch (err) {
      setError(err.message || "Could not add.");
    } finally {
      setBusy(false);
    }
  };

  const remove = async (item) => {
    setError("");
    // Validate synchronously first (e.g. "in use") so we don't animate away a
    // row that can't actually be deleted.
    try {
      validateDelete?.(item);
    } catch (err) {
      setError(err.message || "Cannot delete.");
      return;
    }
    setRemovingId(item.id); // trigger fade-out
    setTimeout(() => {
      onDelete(item); // optimistic remove + background write
      // Clear the marker so the row isn't stuck faded if a failed write
      // rolls the deletion back and the row reappears.
      setRemovingId((current) => (current === item.id ? null : current));
    }, EXIT_MS);
  };

  return (
    <section className="settings-card">
      <header className="settings-card__head">
        <h3 className="settings-card__title">{title}</h3>
        {description ? <p className="settings-card__desc">{description}</p> : null}
      </header>

      <ul className="settings-list">
        {items.length === 0 ? (
          <li className="settings-list__empty">None yet.</li>
        ) : (
          items.map((item) => (
            <li
              key={item.id}
              className={`settings-list__row${removingId === item.id ? " is-removing" : ""}`}
            >
              <span className="settings-list__label">
                {hasColor ? (
                  <span className="settings-list__swatch" style={{ background: item.color }} />
                ) : null}
                {item.label}
              </span>
              <button
                type="button"
                className="settings-list__del"
                aria-label={`Delete ${item.label}`}
                onClick={() => remove(item)}
              >
                ×
              </button>
            </li>
          ))
        )}
      </ul>

      <form className="settings-add" onSubmit={submit}>
        {hasColor ? (
          <input
            type="color"
            className="settings-add__color"
            value={color}
            onChange={(e) => setColor(e.target.value)}
            aria-label="Color"
          />
        ) : null}
        <input
          type="text"
          className="settings-add__input"
          placeholder={placeholder}
          value={label}
          onChange={(e) => setLabel(e.target.value)}
          required
        />
        <button type="submit" className="settings-add__btn" disabled={busy}>
          Add
        </button>
      </form>
      {error ? <p className="settings-card__error">{error}</p> : null}
    </section>
  );
}

export default function SettingsView({ data, adminToken, applyRoadmap, refetch }) {
  const domains = getDomainKeys(data).map((id) => ({ id, label: formatDomainLabel(id) }));
  const teams = (data.teams || []).map((t) => ({ id: t.id, label: t.label || t.id, color: t.color }));
  const statuses = (data.statuses || []).map((s) => ({ id: s.id || s.label, label: s.label, color: s.color }));
  const priorities = (data.priorities || []).map((p) => ({ id: p.id || p.label, label: p.label, color: p.color }));

  // Apply `next` optimistically, then run the background write; roll back on failure.
  const optimistic = (next, request) => {
    const snapshot = data;
    applyRoadmap(next);
    (async () => {
      try {
        await request();
        refetch();
      } catch (err) {
        applyRoadmap(snapshot);
        window.alert(err.message || "Save failed — reverted the change.");
      }
    })();
  };

  const teamInUse = (id) =>
    getDomainKeys(data).some((d) =>
      (data[d] || []).some((p) => parseInitiativeTeams(p).some((t) => t.toLowerCase() === id.toLowerCase()))
    );

  /* ---- Domains ---- */
  const addDomainHandler = ({ label }) => {
    const id = slugify(label);
    if (!id) throw new Error("Domain name must contain letters or numbers.");
    if (RESERVED_DATA_KEYS.has(id)) {
      throw new Error(`"${label}" is a reserved name — pick a different one.`);
    }
    if (data[id]) throw new Error(`Domain already exists: ${label}`);
    optimistic({ ...data, [id]: [] }, () => addDomain({ adminToken, name: label }));
  };
  const deleteDomainHandler = (item) => {
    const next = { ...data };
    delete next[item.id];
    optimistic(next, () => deleteDomain({ adminToken, id: item.id }));
  };
  const validateDomainDelete = (item) => {
    if ((data[item.id] || []).length > 0) {
      throw new Error("Remove its projects first.");
    }
  };

  /* ---- Teams ---- */
  const addTeamHandler = ({ label, color }) => {
    const id = slugify(label);
    if (!id) throw new Error("Team name must contain letters or numbers.");
    if ((data.teams || []).some((t) => t.id === id)) throw new Error(`Team already exists: ${label}`);
    optimistic(
      { ...data, teams: [...(data.teams || []), { id, label, color }] },
      () => addTeam({ adminToken, teamId: id, teamName: label, color })
    );
  };
  const deleteTeamHandler = (item) => {
    optimistic(
      { ...data, teams: (data.teams || []).filter((t) => t.id !== item.id) },
      () => deleteTeam({ adminToken, teamId: item.id })
    );
  };
  const validateTeamDelete = (item) => {
    if (teamInUse(item.id)) throw new Error("Team is assigned to projects.");
  };

  /* ---- Statuses ---- */
  const addStatusHandler = ({ label, color }) => {
    if ((data.statuses || []).some((s) => s.label.toLowerCase() === label.toLowerCase())) {
      throw new Error(`Status already exists: ${label}`);
    }
    optimistic(
      { ...data, statuses: [...(data.statuses || []), { id: label, label, color }] },
      () => addStatusDef({ adminToken, label, color })
    );
  };
  const deleteStatusHandler = (item) => {
    optimistic(
      { ...data, statuses: (data.statuses || []).filter((s) => s.label !== item.label) },
      () => deleteStatusDef({ adminToken, label: item.label })
    );
  };
  const validateStatusDelete = (item) => {
    const inUse = getDomainKeys(data).some((d) =>
      (data[d] || []).some(
        (p) => String(p.status || "").trim().toLowerCase() === item.label.toLowerCase()
      )
    );
    if (inUse) throw new Error("Status is in use by projects.");
  };

  /* ---- Priorities ---- */
  const addPriorityHandler = ({ label, color }) => {
    if ((data.priorities || []).some((p) => p.label.toLowerCase() === label.toLowerCase())) {
      throw new Error(`Priority already exists: ${label}`);
    }
    optimistic(
      { ...data, priorities: [...(data.priorities || []), { id: label, label, color }] },
      () => addPriorityDef({ adminToken, label, color })
    );
  };
  const deletePriorityHandler = (item) => {
    optimistic(
      { ...data, priorities: (data.priorities || []).filter((p) => p.label !== item.label) },
      () => deletePriorityDef({ adminToken, label: item.label })
    );
  };
  const validatePriorityDelete = (item) => {
    const inUse = getDomainKeys(data).some((d) =>
      (data[d] || []).some(
        (p) => String(p.priority || "").trim().toLowerCase() === item.label.toLowerCase()
      )
    );
    if (inUse) throw new Error("Priority is in use by projects.");
  };

  const sheetUrl = getGoogleSheetUrl();

  return (
    <div className="settings">
      <div className="settings__intro-row">
        <p className="settings__intro">
          Manage the building blocks used across the roadmap. Items in use by a project can&apos;t
          be deleted until they&apos;re removed from those projects.
        </p>
        {sheetUrl ? (
          <a
            className="settings__sheet-link"
            href={sheetUrl}
            target="_blank"
            rel="noopener noreferrer"
          >
            <svg viewBox="0 0 24 24" aria-hidden="true" width="15" height="15">
              <path
                fill="currentColor"
                d="M19 3H5a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2V5a2 2 0 00-2-2zm0 16H5V5h14v14zM7 9h10v2H7V9zm0 4h10v2H7v-2z"
              />
            </svg>
            Open Google Sheet ↗
          </a>
        ) : null}
      </div>
      <div className="settings__grid">
        <SettingsSection
          title="Domains"
          description="Top-level groupings (rows on the roadmap)."
          items={domains}
          placeholder="e.g. Platform"
          onAdd={addDomainHandler}
          onDelete={deleteDomainHandler}
          validateDelete={validateDomainDelete}
        />
        <SettingsSection
          title="Teams"
          description="Teams that can be assigned to projects."
          items={teams}
          hasColor
          placeholder="e.g. Core Eng"
          onAdd={addTeamHandler}
          onDelete={deleteTeamHandler}
          validateDelete={validateTeamDelete}
        />
        <SettingsSection
          title="Statuses"
          description="Workflow states; the color drives the roadmap bar."
          items={statuses}
          hasColor
          placeholder="e.g. In Review"
          onAdd={addStatusHandler}
          onDelete={deleteStatusHandler}
          validateDelete={validateStatusDelete}
        />
        <SettingsSection
          title="Priorities"
          description="Priority levels shown as badges."
          items={priorities}
          hasColor
          placeholder="e.g. Critical"
          onAdd={addPriorityHandler}
          onDelete={deletePriorityHandler}
          validateDelete={validatePriorityDelete}
        />
      </div>
    </div>
  );
}
