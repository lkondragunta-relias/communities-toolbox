import { useMemo } from "react";
import {
  getDomainKeys,
  formatDomainLabel,
  getDomainNameMap,
  formatDisplayDate,
  parseDate,
} from "../../utils/roadmapUtils";
import { resolvePriority } from "../../config/priorityConfig";
import { formatDuration, formatEventDate, getIncidents } from "../../utils/incidentUtils";

function flatten(data) {
  const rows = [];
  getDomainKeys(data).forEach((domain) => {
    (data[domain] || []).forEach((item) => rows.push({ ...item, domain }));
  });
  return rows;
}

function countBy(rows, key, definitions) {
  const counts = new Map();
  definitions.forEach((d) => counts.set(d.label, 0));
  rows.forEach((r) => {
    const label = String(r[key] || "").trim();
    if (!label) return;
    counts.set(label, (counts.get(label) || 0) + 1);
  });
  return definitions
    .map((d) => ({ label: d.label, color: d.color, value: counts.get(d.label) || 0 }))
    .filter((d) => d.value > 0);
}

/** "Jane Doe" -> "JD". Blank owners get no avatar rather than a placeholder. */
function initials(name) {
  const parts = String(name || "").trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return null;
  return (parts[0][0] + (parts[1]?.[0] || "")).toUpperCase();
}

function Avatar({ name }) {
  const text = initials(name);
  if (!text) return null;
  return (
    <span className="avatar" title={name}>
      {text}
    </span>
  );
}

function Metric({ label, value, hint, tone = "plain", onClick }) {
  const inner = (
    <>
      <span className="ov-metric__head">
        <span className="ov-metric__dot" aria-hidden="true" />
        <span className="ov-metric__label">{label}</span>
      </span>
      <span className="ov-metric__value">{value}</span>
      <span className="ov-metric__hint">{hint}</span>
    </>
  );
  const className = `ov-metric ov-metric--${tone}${onClick ? " ov-metric--link" : ""}`;
  if (!onClick) return <div className={className}>{inner}</div>;
  return (
    <button type="button" className={className} onClick={onClick}>
      {inner}
      <span className="ov-metric__chevron" aria-hidden="true" />
    </button>
  );
}

/** Stacked proportion bar with a count / percentage legend underneath. */
function Breakdown({ title, segments, total }) {
  return (
    <section className="panel">
      <h3 className="panel__title">{title}</h3>
      {segments.length === 0 ? (
        <p className="panel__empty">Nothing recorded yet.</p>
      ) : (
        <>
          <div className="bar" role="img" aria-label={title}>
            {segments.map((s) => (
              <span
                key={s.label}
                className="bar__seg"
                style={{ width: `${(s.value / total) * 100}%`, background: s.color }}
                title={`${s.label}: ${s.value}`}
              />
            ))}
          </div>
          <ul className="legend">
            {segments.map((s) => (
              <li key={s.label} className="legend__row">
                <span className="legend__dot" style={{ background: s.color }} />
                <span className="legend__label">{s.label}</span>
                <span className="legend__value">{s.value}</span>
                <span className="legend__pct">{Math.round((s.value / total) * 100)}%</span>
              </li>
            ))}
          </ul>
        </>
      )}
    </section>
  );
}

/** At risk by status, or past the end date without being done. */
function findAttention(rows) {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  return rows
    .map((r) => {
      const end = parseDate(r.timeline?.[1]);
      const done = /done|complete/i.test(r.status || "");
      const atRisk = /risk/i.test(r.status || "");
      const overdue = Boolean(end && end < today && !done);
      return { ...r, atRisk, overdue };
    })
    .filter((r) => r.atRisk || r.overdue)
    .sort((a, b) => Number(b.atRisk) - Number(a.atRisk));
}

export default function OverviewView({ data, onSelectProject, onNavigate }) {
  const rows = useMemo(() => flatten(data), [data]);
  const statuses = useMemo(() => data.statuses || [], [data.statuses]);
  const priorities = useMemo(() => data.priorities || [], [data.priorities]);
  const domainNames = useMemo(() => getDomainNameMap(data), [data]);
  const domains = useMemo(() => getDomainKeys(data), [data]);

  const byStatus = countBy(rows, "status", statuses);
  const byPriority = countBy(rows, "priority", priorities);
  const inProgress = rows.filter((r) => /progress/i.test(r.status || "")).length;
  const done = rows.filter((r) => /done|complete/i.test(r.status || "")).length;

  const attention = useMemo(() => findAttention(rows), [rows]);
  const overdueCount = attention.filter((r) => r.overdue).length;
  const atRiskCount = attention.length - overdueCount;

  const incidents = useMemo(() => getIncidents(data), [data]);
  const openIncidents = incidents.filter((e) => e.status.open && e.isIncident);
  const recentEvents = incidents.slice(0, 5);

  const upcoming = useMemo(() => {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    return rows
      .filter((r) => {
        const end = parseDate(r.timeline?.[1]);
        return !end || end >= today;
      })
      .sort(
        (a, b) =>
          (parseDate(a.timeline?.[0])?.getTime() || 0) -
          (parseDate(b.timeline?.[0])?.getTime() || 0)
      )
      .slice(0, 6);
  }, [rows]);

  // Volume and health per domain in a single row.
  const domainRollup = useMemo(
    () =>
      domains
        .map((id) => ({
          id,
          label: domainNames[id] || formatDomainLabel(id),
          count: (data[id] || []).length,
          segments: countBy(data[id] || [], "status", statuses),
        }))
        .sort((a, b) => b.count - a.count),
    [domains, data, domainNames, statuses]
  );
  const maxDomain = Math.max(1, ...domainRollup.map((d) => d.count));

  return (
    <div className="overview">
      <div className="ov-metrics">
        <Metric
          label="Total projects"
          value={rows.length}
          hint={`Across ${domains.length} domain${domains.length === 1 ? "" : "s"}`}
        />
        <Metric label="In progress" value={inProgress} hint="Being worked right now" tone="info" />
        <Metric
          label="Needs attention"
          value={attention.length}
          hint={
            attention.length ? `${atRiskCount} at risk · ${overdueCount} overdue` : "All on track"
          }
          tone={attention.length ? "danger" : "ok"}
        />
        <Metric label="Completed" value={done} hint="Delivered" tone="ok" />
        <Metric
          label="Active incidents"
          value={openIncidents.length}
          hint={openIncidents.length ? "Open now — see timeline" : "Nothing open"}
          tone={openIncidents.length ? "danger" : "ok"}
          onClick={onNavigate ? () => onNavigate("incidents") : undefined}
        />
      </div>

      <div className="overview__row">
        <Breakdown title="Delivery status" segments={byStatus} total={rows.length || 1} />
        <Breakdown title="Priority mix" segments={byPriority} total={rows.length || 1} />
      </div>

      <div className="overview__row">
        <section className="panel">
          <h3 className="panel__title">Needs attention</h3>
          {attention.length === 0 ? (
            <p className="panel__empty">Nothing at risk or overdue.</p>
          ) : (
            <ul className="rows">
              {attention.map((r) => (
                <li key={`${r.domain}-${r.id}`}>
                  <button
                    type="button"
                    className="rows__row"
                    onClick={() => onSelectProject?.({ domain: r.domain, id: r.id })}
                  >
                    <Avatar name={r.owner} />
                    <span className="rows__body">
                      <span className="rows__title">{r.name}</span>
                      <span className="rows__sub">
                        {domainNames[r.domain] || formatDomainLabel(r.domain)}
                        {r.owner ? ` · ${r.owner}` : ""}
                      </span>
                    </span>
                    <span
                      className="chip"
                      style={{ "--chip-color": r.atRisk ? "#d92d20" : "#d97706" }}
                    >
                      {r.atRisk ? "At risk" : "Overdue"}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section className="panel">
          <div className="panel__bar">
            <h3 className="panel__title">Recent operations</h3>
            {onNavigate && recentEvents.length > 0 ? (
              <button type="button" className="panel__more" onClick={() => onNavigate("incidents")}>
                View all
              </button>
            ) : null}
          </div>
          {recentEvents.length === 0 ? (
            <p className="panel__empty">No outages or changes logged yet.</p>
          ) : (
            <ul className="rows">
              {recentEvents.map((e) => (
                <li key={e.id}>
                  <button
                    type="button"
                    className="rows__row"
                    onClick={() => onNavigate?.("incidents", [e.id])}
                  >
                    <span className="rows__marker" style={{ background: e.color }} />
                    <span className="rows__body">
                      <span className="rows__title">{e.title}</span>
                      <span className="rows__sub">
                        {e.domainLabel} · {formatEventDate(e, { withTime: false })}
                      </span>
                    </span>
                    <span className="rows__meta">
                      {e.ongoing ? "Ongoing" : formatDuration(e.durationMinutes)}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>

      <div className="overview__row">
        <section className="panel">
          <h3 className="panel__title">Upcoming &amp; active</h3>
          {upcoming.length === 0 ? (
            <p className="panel__empty">Everything has wrapped up.</p>
          ) : (
            <ul className="rows">
              {upcoming.map((r) => {
                const priority = r.priority ? resolvePriority(r.priority, priorities) : null;
                const pct = typeof r.progress === "number" ? r.progress : 0;
                return (
                  <li key={`${r.domain}-${r.id}`}>
                    <button
                      type="button"
                      className="rows__row"
                      onClick={() => onSelectProject?.({ domain: r.domain, id: r.id })}
                    >
                      <span className="rows__body">
                        <span className="rows__title">{r.name}</span>
                        <span className="rows__sub">
                          {r.timeline?.[0] ? formatDisplayDate(r.timeline[0]) : "—"}
                          {r.timeline?.[1] ? ` → ${formatDisplayDate(r.timeline[1])}` : ""}
                        </span>
                      </span>
                      <span className="rows__meta rows__meta--wide">
                        <span className="track" title={`${pct}% complete`}>
                          <span className="track__fill" style={{ width: `${pct}%` }} />
                        </span>
                        <span className="rows__pct">{pct}%</span>
                        {priority ? (
                          <span className="chip" style={{ "--chip-color": priority.color }}>
                            {priority.label}
                          </span>
                        ) : null}
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </section>

        <section className="panel">
          <h3 className="panel__title">By domain</h3>
          {domainRollup.length === 0 ? (
            <p className="panel__empty">No domains defined.</p>
          ) : (
            <ul className="domains">
              {domainRollup.map((d) => (
                <li key={d.id} className="domains__item">
                  <span className="domains__head">
                    <span className="domains__name">{d.label}</span>
                    <span className="domains__count">{d.count}</span>
                  </span>
                  <span className="domains__track">
                    <span
                      className="bar bar--slim"
                      style={{ width: `${(d.count / maxDomain) * 100}%` }}
                    >
                      {d.segments.map((s) => (
                        <span
                          key={s.label}
                          className="bar__seg"
                          style={{ width: `${(s.value / d.count) * 100}%`, background: s.color }}
                          title={`${s.label}: ${s.value}`}
                        />
                      ))}
                    </span>
                  </span>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
    </div>
  );
}
