/**
 * Hash routing for the toolbox.
 *
 * Every view has its own URL (`#/operations`), and detail panes are addressable
 * too (`#/operations/INC-0002`, `#/roadmap/platform/PLAT-1`) — so links can be
 * shared, the back button closes a drawer, and a refresh lands where you were.
 *
 * Hash rather than History API on purpose: the app is served from a project
 * sub-path on GitHub Pages, where a deep path would 404 on refresh without
 * server-side rewrites. A hash never hits the server.
 */
import { useCallback, useEffect, useState } from "react";

export const ROUTES = [
  { id: "overview", path: "overview", title: "Overview" },
  { id: "timeline", path: "roadmap", title: "Roadmap" },
  { id: "table", path: "projects", title: "Projects" },
  { id: "incidents", path: "operations", title: "Communities Operations Timeline" },
  { id: "sites", path: "cookiebot", title: "Cookiebot" },
  { id: "settings", path: "settings", title: "Settings" },
];

export const DEFAULT_VIEW = "overview";
const LEGACY_VIEW_KEY = "roadmap_active_view";

const byId = (id) => ROUTES.find((r) => r.id === id);
const byPath = (path) => ROUTES.find((r) => r.path === path);

/** "#/operations/INC-2" -> { view: "incidents", params: ["INC-2"] } */
export function parseHash(hash) {
  const segments = String(hash || "")
    .replace(/^#\/?/, "")
    .split("/")
    .map((s) => decodeURIComponent(s.trim()))
    .filter(Boolean);

  const route = byPath(segments[0]);
  if (!route) return { view: null, params: [] };
  return { view: route.id, params: segments.slice(1) };
}

/** { view, params } -> "#/operations/INC-2" */
export function buildHash(viewId, params = []) {
  const route = byId(viewId) || byId(DEFAULT_VIEW);
  const tail = params.filter(Boolean).map((p) => encodeURIComponent(p));
  return `#/${[route.path, ...tail].join("/")}`;
}

/** The view to land on when the URL has no hash yet. */
function initialView() {
  try {
    const saved = localStorage.getItem(LEGACY_VIEW_KEY);
    if (saved && byId(saved)) return saved;
  } catch {
    /* private mode */
  }
  return DEFAULT_VIEW;
}

function currentRoute() {
  const parsed = parseHash(window.location.hash);
  return parsed.view ? parsed : { view: initialView(), params: [] };
}

export function useRoute() {
  const [route, setRoute] = useState(currentRoute);

  useEffect(() => {
    const onChange = () => setRoute(currentRoute());
    window.addEventListener("hashchange", onChange);
    return () => window.removeEventListener("hashchange", onChange);
  }, []);

  // Keep the address bar canonical: a bare "/" or an unknown hash is rewritten
  // to the resolved route without adding a history entry.
  useEffect(() => {
    const want = buildHash(route.view, route.params);
    if (window.location.hash !== want) {
      window.history.replaceState(null, "", want);
    }
    const match = byId(route.view);
    document.title = match ? `${match.title} · Communities Toolbox` : "Communities Toolbox";
    try {
      localStorage.setItem(LEGACY_VIEW_KEY, route.view);
    } catch {
      /* private mode */
    }
  }, [route]);

  /** Push a new entry (back button returns to where you were). */
  const navigate = useCallback((viewId, params = []) => {
    const next = buildHash(viewId, params);
    if (window.location.hash === next) return;
    window.location.hash = next;
  }, []);

  /** Swap the URL without a history entry — used for closing a drawer. */
  const replace = useCallback((viewId, params = []) => {
    const next = buildHash(viewId, params);
    if (window.location.hash === next) return;
    window.history.replaceState(null, "", next);
    setRoute(parseHash(next));
  }, []);

  return { view: route.view, params: route.params, navigate, replace };
}
