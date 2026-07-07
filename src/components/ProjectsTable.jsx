import { useMemo, useState } from "react";
import {
  getDomainKeys,
  formatDomainLabel,
  initiativeMatchesFilter,
  formatTimelineRange,
  parseDate,
  parseInitiativeTeams,
} from "../utils/roadmapUtils";
import { resolveStatus } from "../config/statusConfig";
import { resolvePriority } from "../config/priorityConfig";

const COLUMNS = [
  { key: "id", label: "ID" },
  { key: "name", label: "Name" },
  { key: "domain", label: "Domain" },
  { key: "status", label: "Status" },
  { key: "priority", label: "Priority" },
  { key: "owner", label: "Owner" },
  { key: "teams", label: "Teams" },
  { key: "start", label: "Timeline" },
  { key: "link", label: "Link" },
];

function buildRows(data, filterState) {
  const rows = [];
  getDomainKeys(data).forEach((domain) => {
    (data[domain] || []).forEach((item) => {
      if (!initiativeMatchesFilter(item, domain, filterState)) return;
      rows.push({ ...item, domain });
    });
  });
  return rows;
}

/** Rank from the definition order (first-listed = highest), so custom priorities sort too. */
function buildPriorityRank(priorities) {
  const rank = new Map();
  (priorities || []).forEach((p, i) => {
    rank.set(String(p.label || "").toLowerCase(), priorities.length - i);
  });
  return rank;
}

function compareRows(a, b, key, dir, priorityRank) {
  const mul = dir === "asc" ? 1 : -1;
  let av;
  let bv;
  switch (key) {
    case "priority":
      av = priorityRank.get(String(a.priority || "").toLowerCase()) || 0;
      bv = priorityRank.get(String(b.priority || "").toLowerCase()) || 0;
      return (av - bv) * mul;
    case "start":
      av = parseDate(a.timeline?.[0])?.getTime() || 0;
      bv = parseDate(b.timeline?.[0])?.getTime() || 0;
      return (av - bv) * mul;
    default:
      av = String(a[key] ?? "").toLowerCase();
      bv = String(b[key] ?? "").toLowerCase();
      return av.localeCompare(bv) * mul;
  }
}

export default function ProjectsTable({
  data,
  filterState,
  canEdit,
  canDelete,
  onSelect,
  onEdit,
  onDelete,
}) {
  const [sortKey, setSortKey] = useState("start");
  const [sortDir, setSortDir] = useState("asc");

  const teamLabels = useMemo(() => {
    const map = new Map();
    (data.teams || []).forEach((t) => map.set(t.id, t.label || t.id));
    return map;
  }, [data.teams]);

  const rows = useMemo(() => {
    const priorityRank = buildPriorityRank(data.priorities);
    const built = buildRows(data, filterState);
    built.sort((a, b) => compareRows(a, b, sortKey, sortDir, priorityRank));
    return built;
  }, [data, filterState, sortKey, sortDir]);

  const showActions = canEdit || canDelete;

  const handleSort = (key) => {
    if (key === sortKey) {
      setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    } else {
      setSortKey(key);
      setSortDir("asc");
    }
  };

  return (
    <div className="projects-table-wrap theme-scroll">
      <table className="projects-table">
        <thead>
          <tr>
            {COLUMNS.map((col) => (
              <th key={col.key} scope="col">
                <button
                  type="button"
                  className={`projects-table__sort${sortKey === col.key ? " is-active" : ""}`}
                  onClick={() => handleSort(col.key)}
                >
                  {col.label}
                  {sortKey === col.key ? (
                    <span aria-hidden="true">{sortDir === "asc" ? " ▲" : " ▼"}</span>
                  ) : null}
                </button>
              </th>
            ))}
            {showActions ? (
              <th scope="col" className="projects-table__actions-col">
                Actions
              </th>
            ) : null}
          </tr>
        </thead>
        <tbody>
          {rows.length === 0 ? (
            <tr>
              <td colSpan={COLUMNS.length + (showActions ? 1 : 0)} className="projects-table__empty">
                No projects match the current filters.
              </td>
            </tr>
          ) : (
            rows.map((row) => {
              const status = resolveStatus(row.status, data.statuses);
              const priority = row.priority
                ? resolvePriority(row.priority, data.priorities)
                : null;
              const teams = parseInitiativeTeams(row)
                .map((id) => teamLabels.get(id) || id)
                .join(", ");
              return (
                <tr key={`${row.domain}-${row.id}`}>
                  <td className="projects-table__id">{row.id}</td>
                  <td className="projects-table__name">
                    {onSelect ? (
                      <button
                        type="button"
                        className="projects-table__namebtn"
                        onClick={() => onSelect({ domain: row.domain, id: row.id })}
                      >
                        {row.name}
                      </button>
                    ) : (
                      row.name
                    )}
                  </td>
                  <td>{formatDomainLabel(row.domain)}</td>
                  <td>
                    {row.status ? (
                      <span
                        className="projects-table__pill"
                        style={{ "--pill-color": status.color }}
                      >
                        {row.status}
                      </span>
                    ) : (
                      <span className="projects-table__muted">—</span>
                    )}
                  </td>
                  <td>
                    {priority ? (
                      <span
                        className="projects-table__priority"
                        style={{ "--priority-color": priority.color }}
                      >
                        {priority.label}
                      </span>
                    ) : (
                      <span className="projects-table__muted">—</span>
                    )}
                  </td>
                  <td>{row.owner || <span className="projects-table__muted">—</span>}</td>
                  <td>{teams || <span className="projects-table__muted">—</span>}</td>
                  <td className="projects-table__timeline">
                    {formatTimelineRange(row.timeline) || "—"}
                  </td>
                  <td>
                    {row.link ? (
                      <a href={row.link} target="_blank" rel="noopener noreferrer">
                        Open ↗
                      </a>
                    ) : (
                      <span className="projects-table__muted">—</span>
                    )}
                  </td>
                  {showActions ? (
                    <td className="projects-table__actions">
                      {canEdit ? (
                        <button
                          type="button"
                          className="projects-table__btn"
                          onClick={() => onEdit?.({ domain: row.domain, item: row })}
                        >
                          Edit
                        </button>
                      ) : null}
                      {canDelete ? (
                        <button
                          type="button"
                          className="projects-table__btn projects-table__btn--danger"
                          onClick={() => onDelete?.({ team: row.domain, id: row.id })}
                        >
                          Delete
                        </button>
                      ) : null}
                    </td>
                  ) : null}
                </tr>
              );
            })
          )}
        </tbody>
      </table>
    </div>
  );
}
