import { useCallback, useEffect, useMemo, useState } from "react";
import IncidentTimeline from "../incidents/IncidentTimeline";
import IncidentDetail from "../incidents/IncidentDetail";
import IncidentModal from "../incidents/IncidentModal";
import Icon from "../Icon";
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
  formatDomainList,
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
  overlapsWindow,
  windowStep,
} from "../../utils/incidentUtils";

const RECENT_PAGE = 10;
/** Lane packing treats anything under ~1% of the window as "same moment". */
const MIN_SPAN_RATIO = 0.01;

/** Page buttons with an ellipsis once there are more than a handful. */
function pageNumbers(current, total) {
  if (total <= 7) return Array.from({ length: total }, (_, i) => i + 1);
  const pages = new Set([1, total, current, current - 1, current + 1]);
  const shown = [...pages].filter((n) => n >= 1 && n <= total).sort((a, b) => a - b);
  const out = [];
  shown.forEach((n, i) => {
    if (i > 0 && n - shown[i - 1] > 1) out.push("…");
    out.push(n);
  });
  return out;
}

function StatCard({ label, value, hint, tone }) {
  return (
    <div className={`ops-stat ops-stat--${tone || "plain"}`}>
      <div className="ops-stat__top">
        <span className="ops-stat__dot" aria-hidden="true" />
        <span className="ops-stat__label">{label}</span>
      </div>
      <span className="ops-stat__value">{value}</span>
      <span className="ops-stat__hint">{hint}</span>
    </div>
  );
}

/** "● 1 Critical  ● 2 High" — counts that carry their own severity color. */
function SeverityCounts({ counts, empty }) {
  const present = INCIDENT_SEVERITIES.filter((s) => counts[s.label] > 0);
  if (present.length === 0) return empty;
  return present.map((s) => (
    <span key={s.id} className="ops-count" style={{ "--count-color": s.color }}>
      <span className="ops-count__dot" aria-hidden="true" />
      {counts[s.label]} {s.label}
    </span>
  ));
}

/** Bordered control with a leading icon and our own chevron, like the mock. */
function Control({ label, icon, children, grow }) {
  return (
    <label className={`ops-field${grow ? " ops-field--grow" : ""}`}>
      <span className="ops-field__label">{label}</span>
      <span className="ops-control">
        <Icon name={icon} className="ops-control__icon" />
        {children}
        <span className="ops-control__chevron" aria-hidden="true" />
      </span>
    </label>
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
  selectedId: routeSelectedId = null,
  onSelectId = null,
}) {
  // One clock per render pass, refreshed each minute so "ongoing" bars grow.
  const [nowMs, setNowMs] = useState(() => Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNowMs(Date.now()), 60000);
    return () => clearInterval(timer);
  }, []);

  const [filters, setFilters] = useState(INITIAL_INCIDENT_FILTERS);
  const [zoom, setZoom] = useState("day");
  const [anchorMs, setAnchorMs] = useState(() => Date.now());
  const [modal, setModal] = useState(null);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(RECENT_PAGE);
  const [error, setError] = useState("");

  // The open drawer is part of the URL when the app supplies a router
  // (#/operations/INC-0002); standalone renders keep it in local state.
  const [localSelectedId, setLocalSelectedId] = useState(null);
  const selectedId = onSelectId ? routeSelectedId : localSelectedId;
  const setSelectedId = onSelectId || setLocalSelectedId;

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

  // Totals for what the timeline is actually showing, which is a different
  // question from the KPI cards (those follow the filters, not the window).
  const windowStats = useMemo(() => {
    const visible = scoped.filter((e) => overlapsWindow(e, timeWindow));
    return computeIncidentStats(visible, allEntries);
  }, [scoped, timeWindow, allEntries]);

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
  const zoomIndex = Math.max(0, ZOOM_LEVELS.findIndex((l) => l.id === zoom));

  /* --------------------------- filter handlers --------------------------- */

  // Every filter change also returns to the first page of results.
  const setFilter = useCallback((patch) => {
    setFilters((prev) => ({ ...prev, ...patch }));
    setPage(1);
  }, []);

  const handleYearChange = useCallback(
    (value) => {
      const year = value === "all" ? "all" : Number(value);
      setFilters((prev) => ({ ...prev, year }));
      setPage(1);
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

  const zoomIn = useCallback(() => {
    const nextZoom = ZOOM_LEVELS[zoomIndex + 1]?.id;
    if (!nextZoom) return;
    if (nextZoom === "hour") setAnchorMs(Date.now());
    setZoom(nextZoom);
  }, [zoomIndex]);

  const pinnedToYear = zoom === "month" && filters.year !== "all";

  const shiftWindow = useCallback(
    (direction) => {
      if (pinnedToYear) {
        setFilters((prev) => ({ ...prev, year: Number(prev.year) + direction }));
        setAnchorMs(new Date(Number(filters.year) + direction, 6, 1).getTime());
        return;
      }
      if (zoom === "day") {
        setAnchorMs((prev) => {
          const next = new Date(prev);
          next.setDate(next.getDate() + direction * 7);
          return next.getTime();
        });
        return;
      }
      if (zoom === "hour") {
        setAnchorMs((prev) => {
          const next = new Date(prev);
          next.setDate(next.getDate() + direction);
          return next.getTime();
        });
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
    [data, adminToken, writeIncidents, applyRoadmap, refetch, setSelectedId]
  );

  const openEdit = useCallback((entry) => {
    // Rebuild the form fields from the parsed timestamps rather than the raw
    // cells, so any accepted input format ("6/25/26", a real Date) edits cleanly.
    const pad = (n) => String(n).padStart(2, "0");
    const dateOf = (d) => (d ? `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}` : "");
    const timeOf = (d, has) => (d && has ? `${pad(d.getHours())}:${pad(d.getMinutes())}` : "");
    setModal({
      mode: "edit",
      values: {
        id: entry.id,
        startDate: dateOf(entry.start),
        startTime: timeOf(entry.start, entry.hasTime),
        endDate: dateOf(entry.end),
        endTime: timeOf(entry.end, entry.hasEndTime),
        domain: entry.domain,
        title: entry.title,
        type: entry.type.label,
        severity: entry.severity.label,
        duration:
          entry.durationFromRange || entry.durationMinutes === null
            ? ""
            : formatDuration(entry.durationMinutes),
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

  const pageCount = Math.max(1, Math.ceil(scoped.length / pageSize));
  const currentPage = Math.min(page, pageCount);
  const pageStart = (currentPage - 1) * pageSize;
  const recent = scoped.slice(pageStart, pageStart + pageSize);

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
            <Icon name="download" className="ops-icon" />
            Export
          </button>
          <button
            type="button"
            className="ops-btn ops-btn--primary"
            onClick={() => setModal({ mode: "add", values: null })}
          >
            <Icon name="plus" className="ops-icon" />
            Add event
          </button>
        </div>
      </div>

      {error ? <p className="ops__error">{error}</p> : null}

      <div className="ops__stats">
        <StatCard
          label="Active incidents"
          value={stats.openCount}
          hint={
            <SeverityCounts counts={stats.openSeverity} empty="Nothing open right now" />
          }
          tone={stats.openCount ? "danger" : "ok"}
        />
        <StatCard
          label={`Incidents · ${scopeLabel}`}
          value={stats.incidentCount}
          hint={<SeverityCounts counts={stats.severity} empty="None logged in this scope" />}
          tone="warn"
        />
        <StatCard
          label={`Downtime · ${scopeLabel}`}
          value={formatDuration(stats.downtimeMinutes)}
          hint={
            stats.mttrMinutes === null
              ? "No resolved incidents yet"
              : `Mean time to recovery ${formatDuration(stats.mttrMinutes)}`
          }
          tone="info"
        />
        <StatCard
          label={`Revenue impact · ${scopeLabel}`}
          value={formatMoney(stats.revenueAmount)}
          hint={
            stats.symbolicCount
              ? `Plus ${stats.symbolicCount} logged as $ tiers`
              : "Estimated from logged events"
          }
          tone="success"
        />
        <StatCard
          label="Domains affected"
          value={stats.domainCount}
          hint={formatDomainList(stats.domainLabels)}
        />
      </div>

      <div className="ops__filters">
        <div className="ops__filter-row">
          <Control label="Year" icon="calendar">
            <select
              className="ops-control__input"
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
          </Control>

          <Control label="Domain / system" icon="globe">
            <select
              className="ops-control__input"
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
          </Control>

          <Control label="Type" icon="layers">
            <select
              className="ops-control__input"
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
          </Control>

          <label className="ops-field ops-field--grow">
            <span className="ops-field__label">Search</span>
            <span className="ops-control ops-control--search">
              <Icon name="search" className="ops-control__icon" />
              <input
                type="search"
                className="ops-control__input"
                value={filters.search}
                onChange={(e) => setFilter({ search: e.target.value })}
                placeholder="Search title, domain, cause…"
              />
            </span>
          </label>

          <button
            type="button"
            className="ops-clear"
            disabled={!filterActive}
            onClick={() => {
              setFilters(INITIAL_INCIDENT_FILTERS);
              setPage(1);
            }}
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
        <header className="ops-timeline__toolbar">
          <span className="ops-timeline__range">{formatWindowLabel(timeWindow)}</span>
          <div className="ops-panel__controls">
            <div className="ops-nav">
              <button type="button" className="ops-nav__today" onClick={handleToday}>
                Today
              </button>
              <button
                type="button"
                className="ops-nav__btn"
                aria-label="Previous period"
                onClick={() => shiftWindow(-1)}
              >
                ‹
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
            <div className="ops-zoom" role="group" aria-label="Zoom">
              <span className="ops-zoom__label">Zoom</span>
              <button
                type="button"
                className="ops-nav__btn"
                aria-label="Zoom out"
                disabled={zoomIndex === 0}
                onClick={() => setZoom(ZOOM_LEVELS[zoomIndex - 1].id)}
              >
                <Icon name="zoomOut" className="ops-icon" />
              </button>
              <span className="ops-zoom__level">{ZOOM_LEVELS[zoomIndex].label}</span>
              <button
                type="button"
                className="ops-nav__btn"
                aria-label="Zoom in"
                disabled={zoomIndex === ZOOM_LEVELS.length - 1}
                onClick={zoomIn}
              >
                <Icon name="zoomIn" className="ops-icon" />
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

        <div className="ops-legend-row">
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
          <p className="ops-legend__totals">
            Downtime (selected range){" "}
            <strong>{formatDuration(windowStats.downtimeMinutes)}</strong>
            <span aria-hidden="true"> · </span>
            Revenue impact{" "}
            <strong className="ops-legend__money">{formatMoney(windowStats.revenueAmount)}</strong>
          </p>
        </div>
      </section>

      <section className="ops-panel">
        <header className="ops-panel__head">
          <div>
            <h3 className="ops-panel__title">Recent activity</h3>
            <p className="ops-panel__sub">
              {scoped.length} event{scoped.length === 1 ? "" : "s"} · {scopeLabel}
            </p>
          </div>
        </header>

        {scoped.length === 0 ? (
          <p className="ops-empty">No events match these filters.</p>
        ) : (
          <div className="ops-table-wrap theme-scroll">
            <table className="ops-table">
              <thead>
                <tr>
                  <th>Date &amp; time (start)</th>
                  <th>Title</th>
                  <th>Domain / system</th>
                  <th>Type</th>
                  <th>Impact</th>
                  <th>Duration</th>
                  <th>Status</th>
                  <th>Revenue impact</th>
                  {adminUnlocked ? <th className="ops-table__actions-col">Actions</th> : null}
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
                    <td className="ops-table__event">
                      <span className="ops-table__title">{entry.title}</span>
                      {entry.customerImpact ? (
                        <span className="ops-table__sub">{entry.customerImpact}</span>
                      ) : null}
                    </td>
                    <td className="ops-table__domain">{entry.domainLabel}</td>
                    <td className="ops-table__type">{entry.type.label}</td>
                    <td>
                      <span
                        className="ops-tag ops-tag--soft"
                        style={{ "--tag-color": entry.severity.color }}
                      >
                        {entry.severity.label}
                      </span>
                    </td>
                    <td className="ops-table__duration">
                      {entry.ongoing ? "Ongoing" : formatDuration(entry.durationMinutes)}
                    </td>
                    <td>
                      <span
                        className="ops-tag ops-tag--soft"
                        style={{ "--tag-color": entry.status.color }}
                      >
                        {entry.status.label}
                      </span>
                    </td>
                    <td className="ops-table__money">{formatRevenue(entry.revenue)}</td>
                    {adminUnlocked ? (
                      <td className="ops-table__actions-col">
                        <div className="ops-table__actions">
                          <button
                            type="button"
                            className="ops-row-btn"
                            onClick={(e) => {
                              e.stopPropagation();
                              openEdit(entry);
                            }}
                          >
                            Edit
                          </button>
                          <button
                            type="button"
                            className="ops-row-btn ops-row-btn--danger"
                            onClick={(e) => {
                              e.stopPropagation();
                              handleDelete(entry);
                            }}
                          >
                            Delete
                          </button>
                        </div>
                      </td>
                    ) : null}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {scoped.length > 0 ? (
          <div className="ops-pager">
            <span className="ops-pager__count">
              {pageStart + 1}–{Math.min(pageStart + pageSize, scoped.length)} of {scoped.length}{" "}
              event{scoped.length === 1 ? "" : "s"}
            </span>
            <div className="ops-pager__controls">
              <button
                type="button"
                className="ops-nav__btn"
                aria-label="Previous page"
                disabled={currentPage === 1}
                onClick={() => setPage(currentPage - 1)}
              >
                ‹
              </button>
              {pageNumbers(currentPage, pageCount).map((n, i) =>
                n === "…" ? (
                  <span key={`gap-${i}`} className="ops-pager__gap">
                    …
                  </span>
                ) : (
                  <button
                    key={n}
                    type="button"
                    className={`ops-pager__page${n === currentPage ? " is-on" : ""}`}
                    aria-current={n === currentPage ? "page" : undefined}
                    onClick={() => setPage(n)}
                  >
                    {n}
                  </button>
                )
              )}
              <button
                type="button"
                className="ops-nav__btn"
                aria-label="Next page"
                disabled={currentPage === pageCount}
                onClick={() => setPage(currentPage + 1)}
              >
                ›
              </button>
              <select
                className="ops-select ops-pager__size"
                aria-label="Rows per page"
                value={pageSize}
                onChange={(e) => {
                  setPageSize(Number(e.target.value));
                  setPage(1);
                }}
              >
                {[10, 25, 50, 100].map((n) => (
                  <option key={n} value={n}>
                    {n} / page
                  </option>
                ))}
              </select>
            </div>
          </div>
        ) : null}
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
