import { useEffect, useRef, useState } from "react";
import {
  getAllInitiatives,
  getDomainsForFilter,
  isFilterActive,
} from "../utils/roadmapUtils";

function FilterPill({ label, active, teamActive, swatchColor, dotColor, onClick }) {
  const className = [
    "filter-pill",
    active && "filter-pill--active",
    teamActive && "filter-pill--team-active",
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <button type="button" className={className} onClick={onClick}>
      {swatchColor ? (
        <>
          <span className="filter-pill__swatch" style={{ background: swatchColor }} />
          {label}
        </>
      ) : dotColor ? (
        <>
          <span className="filter-pill__dot" style={{ background: dotColor }} />
          {label}
        </>
      ) : (
        label
      )}
    </button>
  );
}

function FilterRow({ labelText, children }) {
  return (
    <div className="filter-row">
      <span className="filter-row__label">{labelText}</span>
      <div className="filter-row__pills">{children}</div>
    </div>
  );
}

function getSelectedInitiativeId(filterState) {
  if (!filterState.initiatives || filterState.initiatives.size === 0) return "";
  return [...filterState.initiatives][0];
}

function InitiativeSelect({ initiatives, value, onChange }) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef(null);

  const selected = value ? initiatives.find((item) => item.id === value) : null;
  const displayLabel = selected ? selected.name : "All initiatives";

  useEffect(() => {
    if (!open) return undefined;

    const handlePointerDown = (event) => {
      if (rootRef.current && !rootRef.current.contains(event.target)) {
        setOpen(false);
      }
    };
    const handleKeyDown = (event) => {
      if (event.key === "Escape") setOpen(false);
    };

    document.addEventListener("mousedown", handlePointerDown);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("mousedown", handlePointerDown);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [open]);

  const pick = (initiativeId) => {
    onChange(initiativeId);
    setOpen(false);
  };

  return (
    <div className="filter-select-wrap" ref={rootRef}>
      <button
        type="button"
        id="initiative-filter"
        className={`filter-select-trigger${open ? " filter-select-trigger--open" : ""}`}
        aria-haspopup="listbox"
        aria-expanded={open}
        onClick={() => setOpen((wasOpen) => !wasOpen)}
      >
        <span className="filter-select-trigger__label">{displayLabel}</span>
        <span className="filter-select-trigger__chevron" aria-hidden="true" />
      </button>
      {open && (
        <ul
          className="filter-select-menu theme-scroll"
          role="listbox"
          aria-labelledby="initiative-filter"
        >
          <li role="presentation">
            <button
              type="button"
              role="option"
              aria-selected={!value}
              className={`filter-select-option${!value ? " filter-select-option--selected" : ""}`}
              onClick={() => pick(null)}
            >
              All initiatives
            </button>
          </li>
          {initiatives.map((item) => {
            const isSelected = value === item.id;
            return (
              <li key={item.id} role="presentation">
                <button
                  type="button"
                  role="option"
                  aria-selected={isSelected}
                  className={`filter-select-option${isSelected ? " filter-select-option--selected" : ""}`}
                  onClick={() => pick(item.id)}
                >
                  <span
                    className="filter-select-option__swatch"
                    style={{ background: item.color }}
                    aria-hidden="true"
                  />
                  {item.name}
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

function getTeamFilterDefinitions(data) {
  const defs = data.teams;
  if (Array.isArray(defs) && defs.length > 0 && defs[0]?.id && defs[0]?.label) {
    return defs;
  }
  return data.cohorts || [];
}

function getStatusFilterDefinitions(data) {
  const defs = data.statuses;
  if (Array.isArray(defs) && defs.length > 0 && defs[0]?.label) {
    return defs;
  }
  return [];
}

function getPriorityFilterDefinitions(data) {
  const defs = data.priorities;
  if (Array.isArray(defs) && defs.length > 0 && defs[0]?.label) {
    return defs;
  }
  return [];
}

export default function Filters({
  data,
  filterState,
  onDomainChange,
  onInitiativeChange,
  onTeamsChange,
  onStatusesChange,
  onPrioritiesChange,
  onClear,
}) {
  const domains = getDomainsForFilter(data);
  const initiatives = getAllInitiatives(data);
  const teamFilters = getTeamFilterDefinitions(data);
  const statusFilters = getStatusFilterDefinitions(data);
  const priorityFilters = getPriorityFilterDefinitions(data);
  const filterActive = isFilterActive(filterState);
  const selectedInitiativeId = getSelectedInitiativeId(filterState);
  const selectedTeams = filterState.teams;
  const selectedStatuses = filterState.statuses;
  const selectedPriorities = filterState.priorities;

  const handleTeamPillClick = (teamId) => {
    if (teamId === "all") {
      onTeamsChange(null);
      return;
    }
    const next = new Set(selectedTeams || []);
    if (next.has(teamId)) {
      next.delete(teamId);
    } else {
      next.add(teamId);
    }
    onTeamsChange(next.size > 0 ? next : null);
  };

  const handleStatusPillClick = (statusLabel) => {
    if (statusLabel === "all") {
      onStatusesChange(null);
      return;
    }
    const next = new Set(selectedStatuses || []);
    if (next.has(statusLabel)) {
      next.delete(statusLabel);
    } else {
      next.add(statusLabel);
    }
    onStatusesChange(next.size > 0 ? next : null);
  };

  const handlePriorityPillClick = (priorityLabel) => {
    if (priorityLabel === "all") {
      onPrioritiesChange(null);
      return;
    }
    const next = new Set(selectedPriorities || []);
    if (next.has(priorityLabel)) {
      next.delete(priorityLabel);
    } else {
      next.add(priorityLabel);
    }
    onPrioritiesChange(next.size > 0 ? next : null);
  };

  const clearFiltersButton = (
    <button
      type="button"
      className="filter-clear-btn"
      disabled={!filterActive}
      onClick={onClear}
    >
      Clear filters
    </button>
  );

  return (
    <div className="roadmap__filters" aria-label="Roadmap filters">
      <FilterRow labelText="Domain:">
        {domains.map((domain) => (
          <FilterPill
            key={domain.id}
            label={domain.label}
            active={filterState.domain === domain.id}
            onClick={() => onDomainChange(domain.id)}
          />
        ))}
      </FilterRow>

      <div className="filter-row">
        <span className="filter-row__label" id="initiative-filter-label">
          Initiative:
        </span>
        <InitiativeSelect
          initiatives={initiatives}
          value={selectedInitiativeId}
          onChange={onInitiativeChange}
        />
      </div>

      {teamFilters.length > 0 && (
        <FilterRow labelText="Team:">
          <FilterPill
            label="All teams"
            teamActive={!selectedTeams || selectedTeams.size === 0}
            onClick={() => handleTeamPillClick("all")}
          />
          {teamFilters.map((team) => (
            <FilterPill
              key={team.id}
              label={team.label}
              teamActive={selectedTeams?.has(team.id)}
              dotColor={team.color}
              onClick={() => handleTeamPillClick(team.id)}
            />
          ))}
        </FilterRow>
      )}

      {statusFilters.length > 0 && (
        <FilterRow labelText="Status:">
          <FilterPill
            label="All statuses"
            teamActive={!selectedStatuses || selectedStatuses.size === 0}
            onClick={() => handleStatusPillClick("all")}
          />
          {statusFilters.map((status) => (
            <FilterPill
              key={status.id}
              label={status.label}
              teamActive={selectedStatuses?.has(status.label)}
              dotColor={status.color}
              onClick={() => handleStatusPillClick(status.label)}
            />
          ))}
        </FilterRow>
      )}

      {priorityFilters.length > 0 && (
        <FilterRow labelText="Priority:">
          <FilterPill
            label="All priorities"
            teamActive={!selectedPriorities || selectedPriorities.size === 0}
            onClick={() => handlePriorityPillClick("all")}
          />
          {priorityFilters.map((priority) => (
            <FilterPill
              key={priority.id}
              label={priority.label}
              teamActive={selectedPriorities?.has(priority.label)}
              dotColor={priority.color}
              onClick={() => handlePriorityPillClick(priority.label)}
            />
          ))}
        </FilterRow>
      )}

      <div className="roadmap__filters-end">{clearFiltersButton}</div>
    </div>
  );
}
