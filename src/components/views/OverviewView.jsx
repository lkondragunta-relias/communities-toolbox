import { useMemo } from "react";
import {
  getDomainKeys,
  formatDomainLabel,
  formatTimelineRange,
  parseDate,
} from "../../utils/roadmapUtils";
import { resolveStatus } from "../../config/statusConfig";
import { resolvePriority } from "../../config/priorityConfig";

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

function StatCard({ label, value, hint, tone }) {
  return (
    <div className={`stat-card${tone ? ` stat-card--${tone}` : ""}`}>
      <span className="stat-card__value">{value}</span>
      <span className="stat-card__label">{label}</span>
      {hint ? <span className="stat-card__hint">{hint}</span> : null}
    </div>
  );
}

function BreakdownBar({ title, segments, total }) {
  if (!segments.length) return null;
  return (
    <div className="breakdown">
      <h3 className="breakdown__title">{title}</h3>
      <div className="breakdown__bar" role="img" aria-label={title}>
        {segments.map((s) => (
          <span
            key={s.label}
            className="breakdown__seg"
            style={{ width: `${(s.value / total) * 100}%`, background: s.color }}
            title={`${s.label}: ${s.value}`}
          />
        ))}
      </div>
      <ul className="breakdown__legend">
        {segments.map((s) => (
          <li key={s.label}>
            <span className="breakdown__dot" style={{ background: s.color }} />
            {s.label}
            <span className="breakdown__count">{s.value}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

export default function OverviewView({ data, onSelectProject }) {
  const rows = useMemo(() => flatten(data), [data]);
  const statuses = data.statuses || [];
  const priorities = data.priorities || [];

  const total = rows.length;
  const byStatus = countBy(rows, "status", statuses);
  const byPriority = countBy(rows, "priority", priorities);
  const inProgress = rows.filter((r) => /progress/i.test(r.status || "")).length;
  const done = rows.filter((r) => /done/i.test(r.status || "")).length;
  const atRisk = rows.filter((r) => /risk/i.test(r.status || ""));
  const highPriority = rows.filter((r) => /high/i.test(r.priority || "")).length;

  const domains = getDomainKeys(data);

  // Genuinely "upcoming & active": not yet finished, soonest start first.
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
      .slice(0, 8);
  }, [rows]);

  return (
    <div className="overview">
      <div className="stat-grid">
        <StatCard label="Total projects" value={total} hint={`${domains.length} domains`} />
        <StatCard label="In progress" value={inProgress} tone="info" />
        <StatCard label="Completed" value={done} tone="success" />
        <StatCard label="At risk" value={atRisk.length} tone={atRisk.length ? "danger" : undefined} />
        <StatCard label="High priority" value={highPriority} tone={highPriority ? "warn" : undefined} />
      </div>

      <div className="overview__row">
        <BreakdownBar title="By status" segments={byStatus} total={total || 1} />
        <BreakdownBar title="By priority" segments={byPriority} total={total || 1} />
      </div>

      <div className="overview__row">
        <section className="panel">
          <h3 className="panel__title">Needs attention</h3>
          {atRisk.length === 0 ? (
            <p className="panel__empty">Nothing at risk. 🎉</p>
          ) : (
            <ul className="mini-list">
              {atRisk.map((r) => {
                const status = resolveStatus(r.status, statuses);
                const priority = r.priority ? resolvePriority(r.priority, priorities) : null;
                return (
                  <li key={`${r.domain}-${r.id}`}>
                    <button
                      type="button"
                      className="mini-list__row"
                      onClick={() => onSelectProject?.({ domain: r.domain, id: r.id })}
                    >
                      <span className="mini-list__name">{r.name}</span>
                      <span className="mini-list__meta">
                        <span className="mini-list__pill" style={{ "--pill-color": status.color }}>
                          {r.status}
                        </span>
                        {priority ? (
                          <span
                            className="mini-list__pill mini-list__pill--ghost"
                            style={{ "--pill-color": priority.color }}
                          >
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
          <ul className="mini-list">
            {domains.map((domain) => {
              const count = (data[domain] || []).length;
              return (
                <li key={domain}>
                  <div className="mini-list__row mini-list__row--static">
                    <span className="mini-list__name">{formatDomainLabel(domain)}</span>
                    <span className="mini-list__count">{count}</span>
                  </div>
                </li>
              );
            })}
          </ul>
        </section>
      </div>

      <section className="panel">
        <h3 className="panel__title">Upcoming &amp; active</h3>
        {upcoming.length === 0 ? (
          <p className="panel__empty">Nothing upcoming — all projects have wrapped up.</p>
        ) : null}
        <ul className="mini-list">
          {upcoming.map((r) => (
            <li key={`${r.domain}-${r.id}`}>
              <button
                type="button"
                className="mini-list__row"
                onClick={() => onSelectProject?.({ domain: r.domain, id: r.id })}
              >
                <span className="mini-list__name">{r.name}</span>
                <span className="mini-list__meta mini-list__meta--muted">
                  {formatTimelineRange(r.timeline)}
                </span>
              </button>
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}
