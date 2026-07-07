import { useCallback, useEffect, useRef, useState } from "react";
import { applyStatusToInitiative } from "../config/statusConfig";
import { fetchRoadmap, getDataSource } from "../services/sheetsApi";
import { getCachedRoadmap, cacheRoadmap } from "../db/database";
import { setQuartersFromData } from "../utils/roadmapUtils";

export function useRoadmapData() {
  const [data, setData] = useState(null);
  const [quarters, setQuarters] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [revalidating, setRevalidating] = useState(false);
  // Monotonic id so overlapping loads resolve "latest wins": a slow, older
  // fetch must never overwrite data from a newer load or optimistic apply.
  const loadIdRef = useRef(0);

  const load = useCallback(async (signal, options = {}) => {
    const { skipCache = false } = options;
    const loadId = ++loadIdRef.current;
    const isStale = () => signal?.aborted || loadIdRef.current !== loadId;
    setError(null);

    const apply = (json) => {
      const parsedQuarters = setQuartersFromData(json);
      setData(json);
      setQuarters(parsedQuarters);
    };

    // Stale-while-revalidate: only when the source of truth is remote (Google
    // Sheets). Show the cached copy instantly, then refresh from the sheet.
    const cached = getDataSource() === "remote";

    let shownFromCache = false;
    if (cached && !skipCache) {
      try {
        const snapshot = await getCachedRoadmap();
        if (snapshot && !isStale()) {
          apply(snapshot);
          setLoading(false);
          shownFromCache = true;
        }
      } catch {
        /* ignore cache read errors */
      }
    }

    // Show the full loader only on a genuine first paint with nothing on screen.
    // A refetch (skipCache) or a cache hit revalidates quietly in the background.
    if (!shownFromCache && !skipCache) setLoading(true);
    else setRevalidating(true);

    try {
      const json = await fetchRoadmap();
      if (isStale()) return;
      apply(json);
      if (cached) cacheRoadmap(json); // fire-and-forget; updates the snapshot
    } catch (err) {
      if (isStale()) return;
      // Keep whatever is on screen and stay silent; only surface an error when
      // there's truly nothing shown (first load, no cache).
      if (!shownFromCache && !skipCache) {
        setError(
          `Could not load roadmap (${err.message}). Showing no data — check your connection or VITE_SHEETS_API_URL.`
        );
      }
    } finally {
      if (!isStale()) {
        setLoading(false);
        setRevalidating(false);
      }
    }
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    queueMicrotask(() => {
      if (!controller.signal.aborted) load(controller.signal);
    });
    return () => controller.abort();
  }, [load]);

  const refetch = useCallback(() => {
    const controller = new AbortController();
    // Data is already on screen; revalidate from source without flashing the
    // (now-stale) cache snapshot first.
    return load(controller.signal, { skipCache: true });
  }, [load]);

  // Apply an optimistic full-data replacement: updates the screen, recomputes
  // quarters, and refreshes the IndexedDB cache so a reload shows it too.
  const applyRoadmap = useCallback((next) => {
    if (!next) return;
    // Drop any in-flight fetch: its (pre-optimistic) result must not land on
    // top of this apply. The caller's follow-up refetch brings fresh data.
    loadIdRef.current++;
    setRevalidating(false);
    setData(next);
    try {
      setQuarters(setQuartersFromData(next));
    } catch {
      /* keep prior quarters if the optimistic set has no valid dates yet */
    }
    if (getDataSource() === "remote") cacheRoadmap(next);
  }, []);

  const patchInitiative = useCallback((domain, initiativeId, updates) => {
    setData((prev) => {
      if (!prev || !domain) return prev;
      const rows = prev[domain];
      if (!Array.isArray(rows)) return prev;
      const statusDefs = prev.statuses?.length ? prev.statuses : undefined;
      return {
        ...prev,
        [domain]: rows.map((item) => {
          if (item.id !== initiativeId) return item;
          return applyStatusToInitiative({ ...item, ...updates }, statusDefs);
        }),
      };
    });
  }, []);

  return {
    data,
    quarters,
    loading,
    error,
    revalidating,
    refetch,
    patchInitiative,
    applyRoadmap,
  };
}
