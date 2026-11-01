import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import AdminModal from "./components/AdminModal";
import {
  applyAdminTokenFromUrl,
  clearStoredAdminTokens,
  getStoredAdminToken,
  setStoredAdminToken,
} from "./utils/adminAuth";
import Sidebar from "./components/Sidebar";
import LoadingScreen from "./components/LoadingScreen";
import Filters from "./components/Filters";
import RoadmapGrid from "./components/RoadmapGrid";
import RoadmapBoard from "./components/RoadmapBoard";
import { RoadmapLegend } from "./components/RoadmapBits";
import ProjectsTable from "./components/ProjectsTable";
import OverviewView from "./components/views/OverviewView";
import IncidentsView from "./components/views/IncidentsView";
import SitesView from "./components/views/SitesView";
import OrgView from "./components/views/OrgView";
import SettingsView from "./components/views/SettingsView";
import ProjectDetail from "./components/ProjectDetail";
import InitiativeTooltip from "./components/InitiativeTooltip";
import { useRoadmapData } from "./hooks/useRoadmapData";
import { ROUTES, useRoute } from "./hooks/useRoute";
import { useTheme } from "./hooks/useTheme";
import { resolveStatus } from "./config/statusConfig";
import { resolveConfidence } from "./config/confidenceConfig";
import {
  addInitiative,
  updateInitiative,
  deleteInitiative,
  getTeamOptionsForAdmin,
  getValidTeamIds,
  getValidStatusLabels,
  hasSheetsApi,
  isLocalMode,
  updateInitiativeStatus,
} from "./services/sheetsApi";
import {
  addQuarters,
  buildFocusQuartersRaw,
  getQuarterRangeLabel,
  getDomainKeys,
  getDomainNameMap,
  INITIAL_FILTER_STATE,
  isDoneStatus,
  quarterEndISO,
  quarterOf,
  quarterStartISO,
  setQuartersFromData,
  shiftTimelineByQuarters,
} from "./utils/roadmapUtils";

const VIEW_TITLES = Object.fromEntries(ROUTES.map((r) => [r.id, r.title]));

/** Views that own their own header actions, so the topbar Add button hides. */
const SELF_MANAGED_VIEWS = new Set(["incidents", "sites", "org", "settings"]);

const SIDEBAR_STORAGE_KEY = "roadmap_sidebar_collapsed";
const ROADMAP_MODE_KEY = "roadmap_layout";

/**
 * Roadmap view options that live in the query string (not the hash) so a
 * shared link like `?present=1&domain=platform&layout=board#/roadmap` opens
 * straight into a clean, presentable view.
 */
function readRoadmapUrlOptions() {
  try {
    const q = new URLSearchParams(window.location.search);
    return {
      layout: q.get("layout"),
      present: q.get("present") === "1",
      domain: q.get("domain"),
    };
  } catch {
    return { layout: null, present: false, domain: null };
  }
}

function getInitialLayout() {
  const fromUrl = readRoadmapUrlOptions().layout;
  if (fromUrl === "board" || fromUrl === "timeline") return fromUrl;
  try {
    return localStorage.getItem(ROADMAP_MODE_KEY) === "board" ? "board" : "timeline";
  } catch {
    return "timeline";
  }
}

function writeRoadmapUrlOptions({ layout, present, domain }) {
  try {
    const url = new URL(window.location.href);
    const q = url.searchParams;
    if (present) q.set("present", "1");
    else q.delete("present");
    if (present && domain && domain !== "all") q.set("domain", domain);
    else q.delete("domain");
    if (present) q.set("layout", layout);
    else q.delete("layout");
    window.history.replaceState(null, "", url.toString());
    return url.toString();
  } catch {
    return window.location.href;
  }
}

/** Turn an Add/Edit form payload into a roadmap item (for optimistic insert). */
function formPayloadToItem(payload) {
  const item = {
    id: String(payload.id || "").trim(),
    name: payload.name || "",
    description: payload.description || "",
    timeline: [payload.timelineStart || "", payload.timelineEnd || ""],
    status: payload.status || "",
    owner: payload.owner || "",
    priority: payload.priority || "",
    confidence: payload.confidence || "",
    link: payload.link || "",
    teams: String(payload.teams || "")
      .split(/[,;]/)
      .map((t) => t.trim())
      .filter(Boolean),
  };
  // The edit form has no progress field — leave it out so the optimistic merge
  // keeps the item's existing progress instead of wiping it to 0.
  if (payload.progress !== undefined) item.progress = Number(payload.progress) || 0;
  return item;
}

function getInitialCollapsed() {
  try {
    return localStorage.getItem(SIDEBAR_STORAGE_KEY) === "1";
  } catch {
    return false;
  }
}

export default function App() {
  useTheme();
  const { data, quarters, loading, error, revalidating, refetch, patchInitiative, applyRoadmap } =
    useRoadmapData();
  const [loaderVisible, setLoaderVisible] = useState(true);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(getInitialCollapsed);
  const { view, params, navigate, replace } = useRoute();
  // Detail panes are addressable, so the drawer state lives in the URL:
  //   #/roadmap/platform/PLAT-1   #/operations/INC-0002
  const selectedProject = params.length >= 2 ? { domain: params[0], id: params[1] } : null;
  const drawerOpen = selectedProject !== null;
  const selectedIncidentId = view === "incidents" ? params[0] || null : null;
  const [filterState, setFilterState] = useState(() => {
    const { domain } = readRoadmapUrlOptions();
    return domain ? { ...INITIAL_FILTER_STATE, domain } : INITIAL_FILTER_STATE;
  });
  const [roadmapLayout, setRoadmapLayout] = useState(getInitialLayout);
  const [showAllQuarters, setShowAllQuarters] = useState(false);
  const [presenting, setPresenting] = useState(() => readRoadmapUrlOptions().present);
  const [linkCopied, setLinkCopied] = useState(false);
  const [tooltip, setTooltip] = useState({ item: null, target: null, domain: null });
  const hideTooltipTimerRef = useRef(null);
  const [adminOpen, setAdminOpen] = useState(false);
  const [addPrefill, setAddPrefill] = useState(null);
  const [editTarget, setEditTarget] = useState(null);
  const [adminToken, setAdminToken] = useState(() => {
    // SiteAccessGate validates URL and saved tokens before App mounts.
    const urlToken = applyAdminTokenFromUrl();
    if (urlToken) return urlToken;
    return (
      getStoredAdminToken() ||
      (import.meta.env.VITE_ADMIN_TOKEN || "").trim() ||
      (isLocalMode() ? "local" : "")
    );
  });

  const handleAdminUnlock = useCallback((token) => {
    const trimmed = String(token || "").trim();
    setAdminToken(trimmed);
    setStoredAdminToken(trimmed);
  }, []);

  const handleAdminLock = useCallback(() => {
    setAdminToken("");
    clearStoredAdminTokens();
  }, []);

  const handleDomainChange = useCallback((domainId) => {
    setFilterState((prev) => ({ ...prev, domain: domainId }));
  }, []);

  const handleInitiativeChange = useCallback((initiativeId) => {
    setFilterState((prev) => ({
      ...prev,
      initiatives: initiativeId ? new Set([initiativeId]) : null,
    }));
  }, []);

  const handleTeamsChange = useCallback((teams) => {
    setFilterState((prev) => ({ ...prev, teams }));
  }, []);

  const handleStatusesChange = useCallback((statuses) => {
    setFilterState((prev) => ({ ...prev, statuses }));
  }, []);

  const handlePrioritiesChange = useCallback((priorities) => {
    setFilterState((prev) => ({ ...prev, priorities }));
  }, []);

  const handleConfidencesChange = useCallback((confidences) => {
    setFilterState((prev) => ({ ...prev, confidences }));
  }, []);

  const handleClearFilters = useCallback(() => {
    setFilterState(INITIAL_FILTER_STATE);
  }, []);

  const clearHideTooltipTimer = useCallback(() => {
    if (hideTooltipTimerRef.current) {
      clearTimeout(hideTooltipTimerRef.current);
      hideTooltipTimerRef.current = null;
    }
  }, []);

  const handleShowTooltip = useCallback(
    (item, target, domain) => {
      clearHideTooltipTimer();
      setTooltip({ item, target, domain: domain || null });
    },
    [clearHideTooltipTimer]
  );

  const handleHideTooltip = useCallback(() => {
    clearHideTooltipTimer();
    hideTooltipTimerRef.current = setTimeout(() => {
      setTooltip({ item: null, target: null, domain: null });
    }, 150);
  }, [clearHideTooltipTimer]);

  const handleTooltipEnter = useCallback(() => {
    clearHideTooltipTimer();
  }, [clearHideTooltipTimer]);

  // Optimistic delete: remove from screen + cache instantly, write in background.
  const handleDeleteInitiative = useCallback(
    async ({ team, id }) => {
      if (!data) return;
      const domain = String(team || "").trim().toLowerCase();
      const snapshot = data;
      const next = {
        ...data,
        [domain]: (data[domain] || []).filter((p) => p.id !== id),
      };
      applyRoadmap(next);
      try {
        await deleteInitiative({ adminToken, team: domain, id });
        refetch();
      } catch (err) {
        applyRoadmap(snapshot); // roll back
        window.alert(err.message || "Failed to delete. Restored the item.");
      }
    },
    [data, adminToken, applyRoadmap, refetch]
  );

  const handleDeleteFromTable = useCallback(
    ({ team, id }) => {
      if (!window.confirm(`Delete "${id}"? This cannot be undone.`)) return;
      handleDeleteInitiative({ team, id });
    },
    [handleDeleteInitiative]
  );

  // Optimistic add: show the new item immediately, POST in the background.
  const handleOptimisticAdd = useCallback(
    (payload) => {
      if (!data) return;
      const domain = String(payload.team || "").trim().toLowerCase();
      const snapshot = data;
      const next = {
        ...data,
        [domain]: [...(data[domain] || []), { progress: 0, ...formPayloadToItem(payload) }],
      };
      applyRoadmap(next);
      setAdminOpen(false);
      setAddPrefill(null);
      (async () => {
        try {
          await addInitiative(payload);
          refetch();
        } catch (err) {
          applyRoadmap(snapshot);
          window.alert(err.message || "Could not add. Reverted.");
        }
      })();
    },
    [data, applyRoadmap, refetch]
  );

  // Optimistic edit: apply changes immediately, PUT in the background.
  const handleOptimisticUpdate = useCallback(
    (payload) => {
      if (!data) return;
      const domain = String(payload.team || "").trim().toLowerCase();
      const snapshot = data;
      const updated = formPayloadToItem(payload);
      const next = {
        ...data,
        [domain]: (data[domain] || []).map((p) =>
          p.id === updated.id ? { ...p, ...updated } : p
        ),
      };
      applyRoadmap(next);
      setEditTarget(null);
      (async () => {
        try {
          await updateInitiative(payload);
          refetch();
        } catch (err) {
          applyRoadmap(snapshot);
          window.alert(err.message || "Could not save changes. Reverted.");
        }
      })();
    },
    [data, applyRoadmap, refetch]
  );


  const handleCreateRange = useCallback(({ domain, timelineStart, timelineEnd }) => {
    setAddPrefill({ domain, timelineStart, timelineEnd });
    setAdminOpen(true);
  }, []);

  const handleCloseAdd = useCallback(() => {
    setAdminOpen(false);
    setAddPrefill(null);
  }, []);

  const handleSelectProject = useCallback(
    ({ domain, id }) => navigate(view === "table" ? "table" : "timeline", [domain, id]),
    [navigate, view]
  );

  const handleCloseProject = useCallback(() => replace(view, []), [replace, view]);

  const handleSelectIncident = useCallback(
    (id) => navigate("incidents", id ? [id] : []),
    [navigate]
  );

  const handleEditInitiative = useCallback(({ domain, item }) => {
    if (!domain || !item) return;
    setEditTarget({
      domain,
      values: {
        domain,
        id: item.id || "",
        name: item.name || "",
        description: item.description || "",
        timelineStart: item.timeline?.[0] || "",
        timelineEnd: item.timeline?.[1] || "",
        status: item.status || "",
        owner: item.owner || "",
        priority: item.priority || "",
        confidence: resolveConfidence(item.confidence),
        link: item.link || "",
        teams: Array.isArray(item.teams) ? [...item.teams] : [],
      },
    });
  }, []);

  // Re-show the loader if a full (non-background) load ever starts again.
  if (loading && !loaderVisible) setLoaderVisible(true);

  useEffect(() => {
    try {
      localStorage.setItem(SIDEBAR_STORAGE_KEY, sidebarCollapsed ? "1" : "0");
    } catch {
      /* ignore */
    }
  }, [sidebarCollapsed]);

  useEffect(() => () => clearHideTooltipTimer(), [clearHideTooltipTimer]);

  const existingIdsByDomain = useMemo(() => {
    if (!data) return {};
    const map = {};
    getDomainKeys(data).forEach((d) => {
      map[d] = new Set((data[d] || []).map((p) => String(p.id).trim().toLowerCase()));
    });
    return map;
  }, [data]);

  const showAdmin = hasSheetsApi();
  const adminUnlocked = Boolean(showAdmin && adminToken);
  const canDeleteInitiatives = adminUnlocked;
  const canEditStatus = adminUnlocked;

  const openAddModal = useCallback(() => {
    setAddPrefill(null);
    setAdminOpen(true);
  }, []);

  const handleStatusChange = useCallback(
    async ({ domain, id, status }) => {
      if (!adminToken) {
        throw new Error("Admin token required to update status.");
      }

      const rows = data?.[domain];
      const previous = Array.isArray(rows) ? rows.find((row) => row.id === id) : null;
      const snapshot = {
        status: previous?.status || "",
        color: previous?.color || "#64748b",
      };

      const resolved = resolveStatus(status, data?.statuses);
      const optimistic = { status: resolved.label, color: resolved.color };

      patchInitiative(domain, id, optimistic);
      setTooltip((prev) => {
        if (!prev.item || prev.item.id !== id || prev.domain !== domain) return prev;
        return { ...prev, item: { ...prev.item, ...optimistic } };
      });

      try {
        await updateInitiativeStatus({ adminToken, team: domain, id, status });
      } catch (err) {
        patchInitiative(domain, id, snapshot);
        setTooltip((prev) => {
          if (!prev.item || prev.item.id !== id || prev.domain !== domain) return prev;
          return { ...prev, item: { ...prev.item, ...snapshot } };
        });
        throw err;
      }
    },
    [adminToken, data, patchInitiative]
  );

  const handleToggleDone = useCallback(
    ({ domain, item }) => {
      if (!item) return;
      const statuses = data?.statuses || [];
      const doneLabel = statuses.find((s) => isDoneStatus(s.label))?.label || "Done";
      const activeLabel =
        statuses.find((s) => /in progress/i.test(s.label))?.label || "In Progress";
      const status = isDoneStatus(item.status) ? activeLabel : doneLabel;
      handleStatusChange({ domain, id: item.id, status }).catch((err) => {
        window.alert(err.message || "Could not update. Reverted.");
      });
    },
    [data, handleStatusChange]
  );

  // Board drag: shift the whole initiative by whole quarters and save.
  const handleMoveInitiative = useCallback(
    ({ domain, item, quarters: delta }) => {
      const [timelineStart, timelineEnd] = shiftTimelineByQuarters(item.timeline, delta);
      handleOptimisticUpdate({
        adminToken,
        team: domain,
        id: item.id,
        name: item.name || "",
        description: item.description || "",
        timelineStart,
        timelineEnd,
        status: item.status || "",
        owner: item.owner || "",
        priority: item.priority || "",
        confidence: item.confidence || "",
        link: item.link || "",
        teams: (Array.isArray(item.teams) ? item.teams : []).join(","),
      });
    },
    [adminToken, handleOptimisticUpdate]
  );

  const handleAddInCell = useCallback(({ domain, quarterOffset }) => {
    const q = addQuarters(quarterOf(new Date()), quarterOffset);
    setAddPrefill({ domain, timelineStart: quarterStartISO(q), timelineEnd: quarterEndISO(q) });
    setAdminOpen(true);
  }, []);

  const changeLayout = useCallback((layout) => {
    setRoadmapLayout(layout);
    try {
      localStorage.setItem(ROADMAP_MODE_KEY, layout);
    } catch {
      /* ignore */
    }
  }, []);

  useEffect(() => {
    writeRoadmapUrlOptions({ layout: roadmapLayout, present: presenting, domain: filterState.domain });
  }, [roadmapLayout, presenting, filterState.domain]);

  // Esc leaves present mode (unless a drawer is open — Esc closes that first).
  useEffect(() => {
    if (!presenting) return undefined;
    const onKey = (e) => {
      if (e.key === "Escape" && !drawerOpen) setPresenting(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [presenting, drawerOpen]);

  const handleCopyLink = useCallback(async () => {
    const url = writeRoadmapUrlOptions({
      layout: roadmapLayout,
      present: true,
      domain: filterState.domain,
    });
    try {
      await navigator.clipboard.writeText(url);
      setLinkCopied(true);
      setTimeout(() => setLinkCopied(false), 1800);
    } catch {
      window.prompt("Copy this link:", url);
    }
  }, [roadmapLayout, filterState.domain]);

  const displayQuarters = useMemo(() => {
    if (showAllQuarters || !quarters.length) return quarters;
    try {
      return setQuartersFromData({ quarters: buildFocusQuartersRaw() });
    } catch {
      return quarters;
    }
  }, [quarters, showAllQuarters]);

  if (loaderVisible) {
    return <LoadingScreen pending={loading} onFinish={() => setLoaderVisible(false)} />;
  }

  const pageTitle = VIEW_TITLES[view] || "Roadmap";
  const isRoadmap = view === "timeline";
  const presentMode = presenting && isRoadmap;
  const canEditRoadmap = canEditStatus && !presentMode;
  const subtitle = isRoadmap
    ? roadmapLayout === "board"
      ? `Now, next and later · as of ${new Date().toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}`
      : displayQuarters.length
        ? getQuarterRangeLabel(displayQuarters)
        : ""
    : "";
  const showFilters = (isRoadmap && !presentMode) || view === "table";
  const showTopbarAdd = showAdmin && !SELF_MANAGED_VIEWS.has(view) && !presentMode;
  const domainNameMap = data ? getDomainNameMap(data) : {};

  return (
    <div className={`app${presentMode ? " app--present" : ""}`}>

      {presentMode ? null : (
        <Sidebar
          view={view}
          onNavigate={navigate}
          collapsed={sidebarCollapsed}
          onToggleCollapse={() => setSidebarCollapsed((c) => !c)}
        />
      )}

      <main className="app__main">
        <header className="app__topbar">
          <div className="app__topbar-text">
            <div>
              <h1 className="app__page-title">
                {pageTitle}
                {revalidating ? (
                  <span className="app__sync" title="Syncing with Google Sheets…">
                    Syncing…
                  </span>
                ) : null}
              </h1>
              {subtitle ? <p className="app__page-subtitle">{subtitle}</p> : null}
            </div>
          </div>
          <div className="app__topbar-actions">
            {isRoadmap ? (
              <div className="layout-switch" role="group" aria-label="Roadmap layout">
                <button
                  type="button"
                  className={`layout-switch__btn${roadmapLayout === "timeline" ? " is-active" : ""}`}
                  aria-pressed={roadmapLayout === "timeline"}
                  onClick={() => changeLayout("timeline")}
                >
                  Timeline
                </button>
                <button
                  type="button"
                  className={`layout-switch__btn${roadmapLayout === "board" ? " is-active" : ""}`}
                  aria-pressed={roadmapLayout === "board"}
                  onClick={() => changeLayout("board")}
                >
                  Board
                </button>
              </div>
            ) : null}
            {isRoadmap && !presentMode ? (
              <button
                type="button"
                className="app__ghost-btn"
                onClick={() => setPresenting(true)}
                title="Clean, full-screen view to share with your team"
              >
                ▶ Present
              </button>
            ) : null}
            {presentMode ? (
              <>
                <button type="button" className="app__ghost-btn" onClick={handleCopyLink}>
                  {linkCopied ? "Link copied ✓" : "Copy link"}
                </button>
                <button type="button" className="app__ghost-btn" onClick={() => window.print()}>
                  Print / PDF
                </button>
                <button
                  type="button"
                  className="app__ghost-btn app__ghost-btn--strong"
                  onClick={() => setPresenting(false)}
                >
                  Exit (Esc)
                </button>
              </>
            ) : null}
            {showTopbarAdd ? (
              <button type="button" className="app__add-btn" onClick={openAddModal}>
                + Add project
              </button>
            ) : null}
          </div>
        </header>

        <div className="app__content theme-scroll">
          {error ? <p className="roadmap__error">{error}</p> : null}

          {data && !error ? (
            view === "overview" ? (
              <OverviewView
                data={data}
                onSelectProject={handleSelectProject}
                onNavigate={navigate}
              />
            ) : view === "incidents" ? (
              <IncidentsView
                data={data}
                adminUnlocked={adminUnlocked}
                adminToken={adminToken}
                onUnlock={handleAdminUnlock}
                onLock={handleAdminLock}
                applyRoadmap={applyRoadmap}
                refetch={refetch}
                selectedId={selectedIncidentId}
                onSelectId={handleSelectIncident}
              />
            ) : view === "sites" ? (
              <SitesView
                adminUnlocked={adminUnlocked}
                data={data}
                adminToken={adminToken}
                refetch={refetch}
              />
            ) : view === "org" ? (
              <OrgView
                data={data}
                adminUnlocked={adminUnlocked}
                adminToken={adminToken}
                onUnlock={handleAdminUnlock}
                onLock={handleAdminLock}
                applyRoadmap={applyRoadmap}
                refetch={refetch}
              />
            ) : view === "settings" ? (
              <SettingsView
                data={data}
                adminToken={adminToken}
                applyRoadmap={applyRoadmap}
                refetch={refetch}
              />
            ) : (
              <>
                {showFilters ? (
                  <Filters
                    data={data}
                    filterState={filterState}
                    onDomainChange={handleDomainChange}
                    onInitiativeChange={handleInitiativeChange}
                    onTeamsChange={handleTeamsChange}
                    onStatusesChange={handleStatusesChange}
                    onPrioritiesChange={handlePrioritiesChange}
                    onConfidencesChange={handleConfidencesChange}
                    onClear={handleClearFilters}
                  />
                ) : null}

                {isRoadmap && presentMode ? (
                  <div className="present-domains" role="group" aria-label="Domain">
                    {[["all", "All domains"], ...getDomainKeys(data).map((d) => [d, domainNameMap[d] || d])].map(
                      ([id, label]) => (
                        <button
                          key={id}
                          type="button"
                          className={`present-domains__btn${filterState.domain === id ? " is-active" : ""}`}
                          onClick={() => handleDomainChange(id)}
                        >
                          {label}
                        </button>
                      )
                    )}
                  </div>
                ) : null}

                {isRoadmap ? (
                  <div className="roadmap__toolbar">
                    <RoadmapLegend />
                    {roadmapLayout === "timeline" && !presentMode ? (
                      <button
                        type="button"
                        className="roadmap__range-btn"
                        onClick={() => setShowAllQuarters((v) => !v)}
                      >
                        {showAllQuarters ? "Focus on the next few quarters" : "Show all quarters"}
                      </button>
                    ) : null}
                  </div>
                ) : null}

                {isRoadmap && roadmapLayout === "board" ? (
                  <RoadmapBoard
                    data={data}
                    filterState={filterState}
                    canEdit={canEditRoadmap}
                    onSelect={handleSelectProject}
                    onToggleDone={canEditRoadmap ? handleToggleDone : undefined}
                    onAddInCell={canEditRoadmap ? handleAddInCell : undefined}
                    onMove={canEditRoadmap ? handleMoveInitiative : undefined}
                  />
                ) : isRoadmap ? (
                  <div className="roadmap__scroll">
                    <RoadmapGrid
                      data={data}
                      quarters={displayQuarters}
                      filterState={filterState}
                      onShowTooltip={handleShowTooltip}
                      onHideTooltip={handleHideTooltip}
                      onSelect={handleSelectProject}
                      canCreate={canEditRoadmap}
                      onCreateRange={canEditRoadmap ? handleCreateRange : undefined}
                      onToggleDone={canEditRoadmap ? handleToggleDone : undefined}
                    />
                  </div>
                ) : (
                  <ProjectsTable
                    data={data}
                    filterState={filterState}
                    canEdit={canEditStatus}
                    canDelete={canDeleteInitiatives}
                    onSelect={handleSelectProject}
                    onEdit={canEditStatus ? handleEditInitiative : undefined}
                    onDelete={canDeleteInitiatives ? handleDeleteFromTable : undefined}
                  />
                )}
              </>
            )
          ) : null}
        </div>
      </main>

      {data ? (
        <ProjectDetail
          data={data}
          selected={selectedProject}
          canEdit={canEditRoadmap}
          canDelete={canDeleteInitiatives && !presentMode}
          onEdit={handleEditInitiative}
          onDelete={handleDeleteFromTable}
          onClose={handleCloseProject}
          onToggleDone={canEditRoadmap ? handleToggleDone : undefined}
        />
      ) : null}

      <InitiativeTooltip
        item={tooltip.item}
        target={tooltip.target}
        domain={tooltip.domain}
        statuses={data?.statuses || []}
        priorities={data?.priorities || []}
        canEditStatus={canEditRoadmap}
        canEdit={canEditRoadmap}
        canDelete={canDeleteInitiatives && !presentMode}
        onStatusChange={canEditStatus ? handleStatusChange : undefined}
        onEdit={canEditStatus ? handleEditInitiative : undefined}
        onDelete={canDeleteInitiatives ? handleDeleteInitiative : undefined}
        onTooltipEnter={handleTooltipEnter}
        onTooltipLeave={handleHideTooltip}
        onToggleDone={canEditRoadmap ? handleToggleDone : undefined}
      />

      {adminOpen && data ? (
        <AdminModal
          initialValues={addPrefill}
          existingIdsByDomain={existingIdsByDomain}
          domains={getDomainKeys(data)}
          domainLabels={getDomainNameMap(data)}
          teamOptions={getTeamOptionsForAdmin(data)}
          validTeamIds={getValidTeamIds(data)}
          statusOptions={data.statuses || []}
          validStatusLabels={getValidStatusLabels(data)}
          priorityOptions={data.priorities || []}
          validPriorityLabels={(data.priorities || []).map((p) => p.label)}
          adminToken={adminToken}
          onUnlock={handleAdminUnlock}
          onLock={handleAdminLock}
          onClose={handleCloseAdd}
          onSave={handleOptimisticAdd}
        />
      ) : null}

      {editTarget && data ? (
        <AdminModal
          mode="edit"
          initialValues={editTarget.values}
          domains={getDomainKeys(data)}
          domainLabels={getDomainNameMap(data)}
          teamOptions={getTeamOptionsForAdmin(data)}
          validTeamIds={getValidTeamIds(data)}
          statusOptions={data.statuses || []}
          validStatusLabels={getValidStatusLabels(data)}
          priorityOptions={data.priorities || []}
          validPriorityLabels={(data.priorities || []).map((p) => p.label)}
          adminToken={adminToken}
          onUnlock={handleAdminUnlock}
          onLock={handleAdminLock}
          onClose={() => setEditTarget(null)}
          onSave={handleOptimisticUpdate}
        />
      ) : null}
    </div>
  );
}
