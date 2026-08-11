import { useCallback, useEffect, useMemo, useState } from "react";
import IncidentTimeline from "../incidents/IncidentTimeline";
import IncidentDetail from "../incidents/IncidentDetail";
import IncidentModal from "../incidents/IncidentModal";
import {
  INCIDENT_SEVERITIES,
  INCIDENT_STATUSES,
  INCIDENT_TYPES,
  TIMELINE_LEGEND,
} from "../../config/incidentConfig";
import { addIncident, deleteIncident, updateIncident } from "../../services/sheetsApi";
import { getDomainNameMap } from "../../utils/roadmapUtils";
import {
  INITIAL_INCIDENT_FILTERS,
  ZOOM_LEVELS,
  buildTickGroups,
  buildTicks,
  buildTimelineRows,
  buildTimelineWindow,
  computeIncidentStats,
  downloadCsv,
  filterIncidents,
  formatDuration,
  formatEventDate,
  formatMoney,
  formatRevenue,
  formatWindowLabel,
  getIncidentYears,
  getIncidents,
  incidentsToCsv,
  isIncidentFilterActive,
  nextIncidentId,
  windowStep,
} from "../../utils/incidentUtils";

const RECENT_PAGE = 10;
/** Lane packing treats anything under ~1% of the window as "same moment". */
const MIN_SPAN_RATIO = 0.01;

function StatCard({ label, value, hint, tone }) {
  return (
    <div className={`ops-stat${tone ? ` ops-stat--${tone}` : ""}`}>
      <span className="ops-stat__label">{label}</span>
      <span className="ops-stat__value">{value}</span>
      {hint ? <span className="ops-stat__hint">{hint}</span> : null}
    </div>
  );
}

function TogglePills({ label, options, selected, onChange }) {
  const toggle = (value) => {
    const next = new Set(selected || []);
    if (next.has(value)) next.delete(value);
    else next.add(value);
    onChange(next.size ? next : null);
  };
  const noneSelected = !selected || selected.size === 0;
  return (
    <div className="ops-pill-row">
      <span className="ops-pill-row__label">{label}</span>
      <button
        type="button"
        className={`ops-toggle${noneSelected ? " is-on" : ""}`}
        onClick={() => onChange(null)}
      >
        All
      </button>
      {options.map((opt) => (
        <button
          key={opt.label}
          type="button"
          className={`ops-toggle${selected?.has(opt.label) ? " is-on" : ""}`}
          onClick={() => toggle(opt.label)}
        >
          <span className="ops-toggle__dot" style={{ background: opt.color }} />
          {opt.label}
        </button>
      ))}
    </div>
  );
}

export default function IncidentsView({
  data,
  adminUnlocked,
  adminToken,
  onUnlock,
  onLock,
  applyRoadmap,
  refetch,
}) {
  // One clock per render pass, refreshed each minute so "ongoing" bars grow.
  const [nowMs, setNowMs] = useState(() => Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNowMs(Date.now()), 60000);
    return () => clearInterval(timer);
  }, []);

  const [filters, setFilters] = useState(INITIAL_INCIDENT_FILTERS);
  const [zoom, setZoom] = useState("month");
  const [anchorMs, setAnchorMs] = useState(() => Date.now());
  const [selectedId, setSelectedId] = useState(null);
  const [modal, setModal] = useState(null);
  const [showAllRecent, setShowAllRecent] = useState(false);
  const [error, setError] = useState("");

  const allEntries = useMemo(() => getIncidents(data, nowMs), [data, nowMs]);
  const scoped = useMemo(() => filterIncidents(allEntries, filters), [allEntries, filters]);
  const stats = useMemo(() => computeIncidentStats(scoped, allEntries), [scoped, allEntries]);
  const years = useMemo(() => getIncidentYears(allEntries), [allEntries]);

  const timeWindow = useMemo(
    () => buildTimelineWindow(zoom, anchorMs, filters.year),
    [zoom, anchorMs, filters.year]
  );
  const ticks = useMemo(() => buildTicks(timeWindow, zoom), [timeWindow, zoom]);
  const groups = useMemo(() => buildTickGroups(ticks), [ticks]);
  const rows = useMemo(
    () =>
      buildTimelineRows(scoped, timeWindow, {
        minSpanMs: (timeWindow.endMs - timeWindow.startMs) * MIN_SPAN_RATIO,
      }),
    [scoped, timeWindow]
  );

  const domainOptions = useMemo(() => {
    const map = new Map();
    allEntries.forEach((e) => map.set(e.domainKey, e.domainLabel));
    return [...map.entries()]
      .map(([key, label]) => ({ key, label }))
      .sort((a, b) => a.label.localeCompare(b.label));
  }, [allEntries]);

  // The Add form suggests domains already used for events plus roadmap domains.
  const domainSuggestions = useMemo(() => {
    const names = new Set(domainOptions.map((d) => d.label));
    Object.values(getDomainNameMap(data || {})).forEach((name) => names.add(name));
    return [...names].sort((a, b) => a.localeCompare(b));
  }, [domainOptions, data]);

  const selected = useMemo(
    () => allEntries.find((e) => e.id === selectedId) || null,
    [allEntries, selectedId]
  );

  const filterActive = isIncidentFilterActive(filters);
  const scopeLabel = filters.year === "all" ? "all time" : String(filters.year);

  /* --------------------------- filter handlers --------------------------- */

  const setFilter = useCallback((patch) => setFilters((prev) => ({ ...prev, ...patch })), []);

  const handleYearChange = useCallback(
    (value) => {
      const year = value === "all" ? "all" : Number(value);
      setFilters((prev) => ({ ...prev, year }));
      if (year !== "all") {
        const thisYear = new Date().getFullYear();
        setAnchorMs(year === thisYear ? Date.now() : new Date(year, 6, 1).getTime());
      }
    },
    []
  );

  const handleToday = useCallback(() => {
    setAnchorMs(Date.now());
    setFilters((prev) => {
      const thisYear = new Date().getFullYear();
      if (prev.year !== "all" && Number(prev.year) !== thisYear) {
        return { ...prev, year: thisYear };
      }
      return prev;
    });
  }, []);

  const pinnedToYear = zoom === "month" && filters.year !== "all";

  const shiftWindow = useCallback(
    (direction) => {
      if (pinnedToYear) {
        setFilters((prev) => ({ ...prev, year: Number(prev.year) + direction }));
        setAnchorMs(new Date(Number(filters.year) + direction, 6, 1).getTime());
        return;
      }
      setAnchorMs((prev) => prev + direction * windowStep(zoom, timeWindow));
    },
    [pinnedToYear, filters.year, zoom, timeWindow]
  );

  /* ------------------------------ mutations ------------------------------ */

  const writeIncidents = useCallback(
    (nextRows) => {
      applyRoadmap({ ...data, incidents: nextRows });
    },
    [applyRoadmap, data]
  );

  const handleSave = useCallback(
    (values) => {
      const current = Array.isArray(data?.incidents) ? data.incidents : [];
      const snapshot = data;
      setError("");

      if (modal?.mode === "edit") {
        const next = current.map((row) => (row.id === values.id ? { ...row, ...values } : row));
        writeIncidents(next);
        updateIncident({ adminToken, ...values })
          .then(() => refetch())
          .catch((err) => {
            applyRoadmap(snapshot);
            setError(err.message || "Could not save the event. Reverted.");
          });
        return;
      }

      const row = { ...values, id: values.id || nextIncidentId(current) };
      writeIncidents([...current, row]);
      addIncident({ adminToken, ...row })
        .then(() => refetch())
        .catch((err) => {
          applyRoadmap(snapshot);
          setError(err.message || "Could not add the event. Reverted.");
        });
    },
    [data, modal, adminToken, writeIncidents, applyRoadmap, refetch]
  );

  const handleDelete = useCallback(
    (entry) => {
      if (!window.confirm(`Delete "${entry.title}"? This cannot be undone.`)) return;
      const current = Array.isArray(data?.incidents) ? data.incidents : [];
      const snapshot = data;
      setError("");
      setSelectedId(null);
      writeIncidents(current.filter((row) => row.id !== entry.id));
      deleteIncident({ adminToken, id: entry.id })
        .then(() => refetch())
        .catch((err) => {
          applyRoadmap(snapshot);
          setError(err.message || "Could not delete the event. Restored it.");
        });
    },
    [data, adminToken, writeIncidents, applyRoadmap, refetch]
  );

  const openEdit = useCallback((entry) => {
    // Rebuild the form's date/time from the parsed timestamp rather than the raw
    // cell, so any accepted input format ("6/25/26", a real Date) edits cleanly.
    const pad = (n) => String(n).padStart(2, "0");
    const d = entry.start;
    setModal({
      mode: "edit",
      values: {
        id: entry.id,
        date: `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`,
        time: entry.hasTime ? `${pad(d.getHours())}:${pad(d.getMinutes())}` : "",
        domain: entry.domain,
        title: entry.title,
        type: entry.type.label,
        severity: entry.severity.label,
        duration: entry.durationMinutes === null ? "" : formatDuration(entry.durationMinutes),
        ongoing: entry.ongoing,
        customerImpact: entry.customerImpact,
        revenueImpact: entry.revenue.raw,
        status: entry.status.label,
        notes: entry.notes,
        links: entry.rawLinks,
      },
    });
  }, []);

  const handleExport = useCallback(() => {
    const stamp = new Date().toISOString().slice(0, 10);
    downloadCsv(`communities-operations-${stamp}.csv`, incidentsToCsv(scoped));
  }, [scoped]);

  /* -------------------------------- render ------------------------------- */

  const recent = showAllRecent ? scoped : scoped.slice(0, RECENT_PAGE);

  return (
    <div className="ops">
      <div className="ops__toolbar">
        <p className="ops__intro">
          Every outage, incident, release and change across Communities — one row per event.
        </p>
        <div className="ops__toolbar-actions">
          <button
            type="button"
            className="ops-btn"
            onClick={handleExport}
            disabled={scoped.length === 0}
          >
            Export CSV
          </button>
          <button
            type="button"
            className="ops-btn ops-btn--primary"
            onClick={() => setModal({ mode: "add", values: null })}
          >
            + Add event
          </button>
        </div>
      </div>

      {error ? <p className="ops__error">{error}</p> : null}

      <div className="ops__stats">
        <StatCard
          label="Open incidents"
          value={stats.openCount}
          hint={
            stats.openCount
              ? `${stats.activeCount} active · ${stats.monitoringCount} monitoring`
              : "Nothing open right now"
          }
          tone={stats.openCount ? "danger" : "ok"}
        />
        <StatCard
          label={`Incidents (${scopeLabel})`}
          value={stats.incidentCount}
          hint={`${stats.criticalCount} critical · ${stats.highPlusCount} high or above`}
        />
        <StatCard
          label="Total downtime"
          value={formatDuration(stats.downtimeMinutes)}
          hint={`${stats.domainCount} domain${stats.domainCount === 1 ? "" : "s"} affected`}
          tone="warn"
        />
        <StatCard
          label="Revenue impact"
          value={formatMoney(stats.revenueAmount)}
          hint={
            stats.symbolicCount
              ? `+ ${stats.symbolicCount} logged as $ tiers`
              : "Estimated, from logged events"
          }
        />
        <StatCard
          label="Mean time to recovery"
          value={stats.mttrMinutes === null ? "—" : formatDuration(stats.mttrMinutes)}
          hint={`${stats.plannedCount} planned change${stats.plannedCount === 1 ? "" : "s"} logged`}
        />
      </div>

      <div className="ops__filters">
        <div className="ops__filter-row">
          <label className="ops-field">
            <span className="ops-field__label">Year</span>
            <select
              className="ops-select"
              value={filters.year}
              onChange={(e) => handleYearChange(e.target.value)}
            >
              <option value="all">All years</option>
              {years.map((year) => (
                <option key={year} value={year}>
                  {year}
                </option>
              ))}
            </select>
          </label>

          <label className="ops-field">
            <span className="ops-field__label">Domain</span>
            <select
              className="ops-select"
              value={filters.domains && filters.domains.size === 1 ? [...filters.domains][0] : ""}
              onChange={(e) =>
                setFilter({ domains: e.target.value ? new Set([e.target.value]) : null })
              }
            >
              <option value="">All domains</option>
              {domainOptions.map((d) => (
                <option key={d.key} value={d.key}>
                  {d.label}
                </option>
              ))}
            </select>
          </label>

          <label className="ops-field">
            <span className="ops-field__label">Type</span>
            <select
              className="ops-select"
              value={filters.types && filters.types.size === 1 ? [...filters.types][0] : ""}
              onChange={(e) =>
                setFilter({ types: e.target.value ? new Set([e.target.value]) : null })
              }
            >
              <option value="">All types</option>
              {INCIDENT_TYPES.map((t) => (
                <option key={t.id} value={t.label}>
                  {t.label}
                </option>
              ))}
            </select>
          </label>

          <label className="ops-field ops-field--grow">
            <span className="ops-field__label">Search</span>
            <input
              type="search"
              className="ops-select"
              value={filters.search}
              onChange={(e) => setFilter({ search: e.target.value })}
              placeholder="Title, domain, cause…"
            />
          </label>

          <button
            type="button"
            className="ops-btn ops-btn--ghost"
            disabled={!filterActive}
            onClick={() => setFilters(INITIAL_INCIDENT_FILTERS)}
          >
            Clear
          </button>
        </div>

        <TogglePills
          label="Severity"
          options={INCIDENT_SEVERITIES}
          selected={filters.severities}
          onChange={(severities) => setFilter({ severities })}
        />
        <TogglePills
          label="Status"
          options={INCIDENT_STATUSES}
          selected={filters.statuses}
          onChange={(statuses) => setFilter({ statuses })}
        />
      </div>

      <section className="ops-panel">
        <header className="ops-panel__head">
          <div>
            <h3 className="ops-panel__title">Timeline</h3>
            <p className="ops-panel__sub">{formatWindowLabel(timeWindow)}</p>
          </div>
          <div className="ops-panel__controls">
            <div className="ops-segment" role="group" aria-label="Zoom">
              {ZOOM_LEVELS.map((level) => (
                <button
                  key={level.id}
                  type="button"
                  className={`ops-segment__btn${zoom === level.id ? " is-on" : ""}`}
                  onClick={() => setZoom(level.id)}
                >
                  {level.label}
                </button>
              ))}
            </div>
            <div className="ops-nav">
              <button
                type="button"
                className="ops-nav__btn"
                aria-label="Previous period"
                onClick={() => shiftWindow(-1)}
              >
                ‹
              </button>
              <button type="button" className="ops-nav__today" onClick={handleToday}>
                Today
              </button>
              <button
                type="button"
                className="ops-nav__btn"
                aria-label="Next period"
                onClick={() => shiftWindow(1)}
              >
                ›
              </button>
            </div>
          </div>
        </header>

        {allEntries.length === 0 ? (
          <div className="ops-empty">
            <p>No events logged yet.</p>
            <p className="ops-empty__hint">
              Use <strong>+ Add event</strong> to log the first outage, incident, release or change.
              The <strong>Incidents</strong> tab and its columns are created in the spreadsheet
              automatically on the first save — nothing to set up by hand. If saving reports an
              unknown action, the Apps Script Web App needs redeploying first (see the README).
            </p>
          </div>
        ) : rows.length === 0 ? (
          <p className="ops-empty">
            No events in this window.{" "}
            {filterActive ? "Try clearing filters" : "Use ‹ › or Today to move the timeline"}.
          </p>
        ) : (
          <IncidentTimeline
            rows={rows}
            ticks={ticks}
            groups={groups}
            window={timeWindow}
            zoom={zoom}
            nowMs={nowMs}
            selectedId={selectedId}
            onSelect={setSelectedId}
          />
        )}

        <ul className="ops-legend">
          {TIMELINE_LEGEND.map((item) => (
            <li key={item.key}>
              <span
                className={`ops-legend__swatch${item.planned ? " is-planned" : ""}`}
                style={{ background: item.color }}
              />
              {item.label}
            </li>
          ))}
        </ul>
      </section>

      <section className="ops-panel">
        <header className="ops-panel__head">
          <div>
            <h3 className="ops-panel__title">Recent activity</h3>
            <p className="ops-panel__sub">
              {scoped.length} event{scoped.length === 1 ? "" : "s"} · {scopeLabel}
            </p>
          </div>
          {scoped.length > RECENT_PAGE ? (
            <button
              type="button"
              className="ops-btn ops-btn--ghost"
              onClick={() => setShowAllRecent((v) => !v)}
            >
              {showAllRecent ? "Show recent only" : `Show all ${scoped.length}`}
            </button>
          ) : null}
        </header>

        {scoped.length === 0 ? (
          <p className="ops-empty">No events match these filters.</p>
        ) : (
          <div className="ops-table-wrap theme-scroll">
            <table className="ops-table">
              <thead>
                <tr>
                  <th>Date</th>
                  <th>Domain</th>
                  <th>Event</th>
                  <th>Type</th>
                  <th>Severity</th>
                  <th>Duration</th>
                  <th>Customer impact</th>
                  <th>Revenue</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                {recent.map((entry) => (
                  <tr
                    key={entry.id}
                    className={selectedId === entry.id ? "is-selected" : undefined}
                    tabIndex={0}
                    onClick={() => setSelectedId(entry.id)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" || e.key === " ") {
                        e.preventDefault();
                        setSelectedId(entry.id);
                      }
                    }}
                  >
                    <td className="ops-table__date">{formatEventDate(entry)}</td>
                    <td>{entry.domainLabel}</td>
                    <td className="ops-table__event">{entry.title}</td>
                    <td>
                      <span
                        className="ops-tag"
                        style={{ "--tag-color": entry.type.color }}
                      >
                        {entry.type.label}
                      </span>
                    </td>
                    <td>
                      <span
                        className="ops-tag ops-tag--solid"
                        style={{ "--tag-color": entry.severity.color }}
                      >
                        {entry.severity.label}
                      </span>
                    </td>
                    <td>{entry.ongoing ? "Ongoing" : formatDuration(entry.durationMinutes)}</td>
                    <td className="ops-table__impact">{entry.customerImpact || "—"}</td>
                    <td>{formatRevenue(entry.revenue)}</td>
                    <td>
                      <span
                        className="ops-tag"
                        style={{ "--tag-color": entry.status.color }}
                      >
                        {entry.status.label}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <IncidentDetail
        entry={selected}
        canEdit={adminUnlocked}
        onEdit={(entry) => {
          setSelectedId(null);
          openEdit(entry);
        }}
        onDelete={handleDelete}
        onClose={() => setSelectedId(null)}
      />

      {modal ? (
        <IncidentModal
          mode={modal.mode}
          initialValues={modal.values}
          domainOptions={domainSuggestions}
          adminToken={adminToken}
          onUnlock={onUnlock}
          onLock={onLock}
          onClose={() => setModal(null)}
          onSave={handleSave}
        />
      ) : null}
    </div>
  );
}
