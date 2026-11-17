import { useCallback, useEffect, useRef, useState } from "react";
import Icon from "../Icon";
import MilestoneDialog from "../milestones/MilestoneDialog";
import MilestoneForm from "../milestones/MilestoneForm";
import { validateMilestoneRequest } from "../../config/milestoneConfig.js";
import { fetchMilestones, isLocalMode, milestonePendingKey, saveMilestone } from "../../services/sheetsApi.js";
import { filterMilestones, formatMilestoneDate, groupMilestones } from "../../utils/milestoneUtils.js";
import "../../styles/milestones.css";

function readPending() {
  try {
    const raw = sessionStorage.getItem(milestonePendingKey());
    if (!raw) return { request: null, error: "" };
    const request = JSON.parse(raw);
    // Validate with the original selected IDs, not possibly changed domain definitions.
    validateMilestoneRequest(request, (request.domainIds || []).map(id => ({ id })));
    return { request, error: "" };
  } catch (err) {
    return { request: null, error: `Cannot recover the pending milestone request: ${err.message}. Do not start another write until this is reviewed.` };
  }
}

function DomainFilter({ domains, selected, onChange }) {
  const [open, setOpen] = useState(false);
  const root = useRef(null), trigger = useRef(null), all = useRef(null);
  useEffect(() => {
    if (!open) return;
    all.current?.focus();
    function outside(event) { if (!root.current?.contains(event.target)) setOpen(false); }
    function escape(event) {
      if (event.key === "Escape") { event.preventDefault(); setOpen(false); trigger.current?.focus(); }
    }
    document.addEventListener("pointerdown", outside);
    document.addEventListener("keydown", escape);
    return () => { document.removeEventListener("pointerdown", outside); document.removeEventListener("keydown", escape); };
  }, [open]);
  return (
    <div className="milestone-domain-filter" ref={root}>
      <button ref={trigger} className="milestone-control" type="button" aria-expanded={open} aria-controls="milestone-domain-options" onClick={() => setOpen(value => !value)}>
        <Icon name="filter" size={15} />{selected.length ? `${selected.length} domain${selected.length === 1 ? "" : "s"} selected` : "All domains"}<span aria-hidden="true">⌄</span>
      </button>
      {open ? <div id="milestone-domain-options" className="milestone-domain-menu" role="group" aria-label="Filter by roadmap domain">
        <label className="milestone-check"><input ref={all} type="checkbox" checked={!selected.length} onChange={() => onChange([])} />All domains</label>
        <div className="milestone-domain-menu__options">
          {domains.map(domain => <label className="milestone-check" key={domain.id}><input type="checkbox" checked={selected.includes(domain.id)} onChange={() => onChange(selected.includes(domain.id) ? selected.filter(id => id !== domain.id) : [...selected, domain.id])} />{domain.name}</label>)}
        </div>
        <button className="milestone-text-button" type="button" onClick={() => onChange([])}>Reset domains</button>
      </div> : null}
    </div>
  );
}

function DomainNames({ item, names }) {
  return <span className="milestone-domains">{item.domainIds.map(id => names[id] || id).join(" / ")}</span>;
}

export default function MilestonesView({ adminUnlocked, adminToken, onUnlock, onLock, selectedId = null, onSelectId }) {
  const [result, setResult] = useState(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");
  const currentYear = String(new Date().getFullYear());
  const [filters, setFilters] = useState({ year: currentYear, quarter: "all", domainIds: [] });
  const [editing, setEditing] = useState(null);
  const [deleting, setDeleting] = useState(false);
  const [unlocking, setUnlocking] = useState(false);
  const [token, setToken] = useState("");
  const [recovery] = useState(readPending);
  const [pending, setPending] = useState(recovery.request);
  const [storageError, setStorageError] = useState(recovery.error);
  const [busy, setBusy] = useState(false);
  const [writeError, setWriteError] = useState("");
  const [notice, setNotice] = useState("");
  const sending = useRef(false), loadId = useRef(0), mounted = useRef(false);
  const load = useCallback(async signal => {
    const id = ++loadId.current;
    setLoading(true);
    setLoadError("");
    try {
      const next = await fetchMilestones(signal);
      if (id === loadId.current && !signal?.aborted) setResult(next);
      return next;
    } catch (err) {
      if (id === loadId.current && !signal?.aborted) setLoadError(err.message);
      throw err;
    } finally {
      if (id === loadId.current && !signal?.aborted) setLoading(false);
    }
  }, []);
  useEffect(() => {
    mounted.current = true;
    const controller = new AbortController();
    queueMicrotask(() => {
      if (!controller.signal.aborted) load(controller.signal).catch(() => { /* load renders the explicit error state */ });
    });
    return () => { mounted.current = false; controller.abort(); };
  }, [load]);

  const items = result?.milestones.items || [], domains = result?.domains || [];
  const configured = result?.milestones.configured === true;
  const names = Object.fromEntries(domains.map(domain => [domain.id, domain.name]));
  const years = [...new Set([currentYear, ...items.map(item => item.date.slice(0, 4))])].sort().reverse();
  const scoped = filterMilestones(items, filters);
  const completed = scoped.filter(item => item.status === "Completed");
  const planned = scoped.filter(item => item.status === "Planned").sort((a, b) => a.date.localeCompare(b.date) || a.id.localeCompare(b.id));
  const groups = groupMilestones(completed);
  const selected = items.find(item => item.id === selectedId);
  const disabled = loading || Boolean(loadError) || !configured || Boolean(storageError);
  const activeFilters = filters.domainIds.length || filters.year !== currentYear || filters.quarter !== "all";
  function reset() { setFilters({ year: currentYear, quarter: "all", domainIds: [] }); }
  function refresh() { load().catch(() => { /* load renders the explicit error state */ }); }
  function clearPending() {
    sessionStorage.removeItem(milestonePendingKey());
    setPending(null);
  }
  async function write(fields) {
    if (sending.current || !adminUnlocked || disabled) return;
    let request = pending;
    try {
      if (!request) {
        request = validateMilestoneRequest({
          action: deleting ? "deleteMilestone" : editing?.item ? "updateMilestone" : "addMilestone",
          requestId: crypto.randomUUID(),
          ...(deleting || editing?.item ? { id: (deleting ? selected : editing.item).id, expectedUpdatedAt: (deleting ? selected : editing.item).updatedAt } : {}),
          ...(!deleting ? fields : {}),
        }, domains);
        sessionStorage.setItem(milestonePendingKey(), JSON.stringify(request));
        setPending(request);
      }
    } catch (err) {
      setWriteError(`Cannot safely start the write: ${err.message}`);
      return;
    }
    sending.current = true; setBusy(true); setWriteError(""); setNotice("");
    try {
      const receipt = await saveMilestone(request, adminToken);
      try { clearPending(); } catch (err) { setStorageError(`Write confirmed, but pending storage could not be cleared: ${err.message}. Retry keeps the same request.`); }
      if (!mounted.current) return;
      setEditing(null); setDeleting(false);
      onSelectId(null);
      setNotice(`${receipt.deleted ? "Deleted" : "Saved"} milestone ${receipt.id}.`);
      // The receipt is already verified. A failed refresh must not be reported as a failed write.
      try { await load(); } catch (err) { setNotice(`Write confirmed for ${receipt.id}, but the current list could not refresh: ${err.message}`); }
    } catch (err) {
      if (["AUTH", "INVALID", "CONFLICT", "SCHEMA", "NOT_CONFIGURED", "CAPACITY"].includes(err.code)) {
        try { clearPending(); } catch (storage) { setStorageError(`Cannot clear rejected request: ${storage.message}`); }
        setWriteError(err.message);
      } else {
        setWriteError(`${err.message} The outcome is unconfirmed. Retry the original request; do not create a replacement.`);
      }
    } finally { sending.current = false; setBusy(false); }
  }
  function choose(id) { setWriteError(""); setDeleting(false); onSelectId(id); }
  const detailTitle = deleting ? "Delete this milestone?" : "Milestone story";

  return (
    <div className="milestones">
      <header className="milestones__header">
        <div><p className="milestones__eyebrow">THE WORK WORTH REMEMBERING</p><h2>Milestones</h2><p className="milestone-muted">A shared history of what we have achieved, together.</p></div>
        <div className="milestones__actions">
          <button type="button" className="app__ghost-btn" onClick={refresh} disabled={loading || busy}>{loading ? "Loading..." : "Refresh"}</button>
          {adminUnlocked ? <><button type="button" className="app__ghost-btn" onClick={onLock} disabled={busy}>Lock editing</button><button type="button" className="app__add-btn" disabled={disabled || Boolean(pending) || !domains.length} onClick={() => { setWriteError(""); setEditing({ item: null }); }}>+ Add milestone</button></> :
            <button type="button" className="app__ghost-btn" onClick={() => setUnlocking(true)}>Unlock editing</button>}
        </div>
      </header>
      {isLocalMode() ? <p className="milestone-banner"><strong>LOCAL DEMO</strong> Synthetic examples only. Changes stay in this browser and never update Google Sheets.</p> : null}
      {notice ? <p role="status" className="milestone-banner">{notice}</p> : null}
      {storageError ? <p role="alert" className="milestone-error">{storageError}</p> : null}
      {pending ? <div className="milestone-warning" role="status"><p>An unconfirmed {pending.action === "addMilestone" ? "create" : pending.action === "deleteMilestone" ? "delete" : "update"} request is saved in this tab. Retry uses its original identity.</p><button className="milestone-text-button" type="button" disabled={!adminUnlocked || disabled || busy} onClick={() => write(null)}>{busy ? "Confirming..." : "Retry original request"}</button>{!adminUnlocked ? <p>Unlock editing to confirm this request.</p> : null}</div> : null}
      {writeError && !editing && !(deleting && selected) ? <p role="alert" className="milestone-error">{writeError}</p> : null}
      {loadError ? <div role="alert" className="milestone-error"><strong>Milestones could not be loaded.</strong><p>{loadError}</p>{result ? <p>The previous view is stale. Editing is disabled until a fresh load succeeds.</p> : null}</div> : null}
      {!result && loading ? <p role="status" className="milestone-empty">Loading milestone history...</p> : null}
      {result && !configured ? <div className="milestone-empty"><h3>Milestones has not been set up</h3><p>The owner must run the reviewed setupMilestonesSheet function to create the empty tab. Reading this page never creates or seeds a sheet.</p></div> : null}
      {result && configured ? <>
        {!domains.length ? <p role="alert" className="milestone-warning">No roadmap Domains are configured. Add canonical roadmap domains before creating a milestone.</p> : null}
        <div className="milestones__toolbar">
          <DomainFilter domains={domains} selected={filters.domainIds} onChange={domainIds => setFilters(value => ({ ...value, domainIds }))} />
          <div className="milestones__period">
            <select className="milestone-control" aria-label="Milestone year" value={filters.year} onChange={event => setFilters(value => ({ ...value, year: event.target.value }))}><option value="all">All years</option>{years.map(year => <option key={year}>{year}</option>)}</select>
            <div className="milestone-quarters" role="group" aria-label="Milestone quarter">{["all", "1", "2", "3", "4"].map(quarter => <button type="button" key={quarter} aria-pressed={filters.quarter === quarter} onClick={() => setFilters(value => ({ ...value, quarter }))}>{quarter === "all" ? filters.year === "all" ? "All quarters" : "Full year" : `Q${quarter}`}</button>)}</div>
          </div>
        </div>
        {activeFilters ? <div className="milestone-chips">{filters.domainIds.map(id => <button type="button" key={id} onClick={() => setFilters(value => ({ ...value, domainIds: value.domainIds.filter(domain => domain !== id) }))} aria-label={`Remove ${names[id] || id} filter`}>{names[id] || id}<span aria-hidden="true"> ×</span></button>)}<button type="button" className="milestone-text-button" onClick={reset}>Reset all filters</button></div> : null}
        <div className="milestones__summary"><span role="status"><strong>{completed.length} achievement{completed.length === 1 ? "" : "s"}</strong> / {filters.quarter === "all" ? "" : `Q${filters.quarter} / `}{filters.year === "all" ? "All years" : filters.year}</span><span>Completed achievements · Latest first</span></div>
        <div className="milestones__layout">
          <section aria-label="Completed milestone timeline">
            {!completed.length ? <div className="milestone-empty"><Icon name="milestones" size={24} /><h3>{items.length ? "No achievements in this view" : "Your milestone history starts here"}</h3><p>{items.length ? "Try another year, quarter or combination of domains." : "Completed achievements will appear here. No sample history has been added."}</p>{activeFilters ? <button className="milestone-text-button" onClick={reset} type="button">Reset all filters</button> : null}</div> : null}
            {groups.map((group, index) => <section key={group.key} className="milestone-quarter" aria-label={`Q${group.quarter} ${group.year}`}>
              {index === 0 || groups[index - 1].year !== group.year ? <h3 className="milestone-year">{group.year}<span> / ACHIEVEMENTS</span></h3> : null}
              <div className="milestone-quarter__heading"><h4>Q{group.quarter}</h4><span>{["Jan - Mar", "Apr - Jun", "Jul - Sep", "Oct - Dec"][group.quarter - 1]}</span><span className="milestone-quarter__count">{group.items.length} achievement{group.items.length === 1 ? "" : "s"}</span></div>
              {group.items.map(item => <div className="milestone-entry" key={item.id}><time dateTime={item.date}>{formatMilestoneDate(item.date)}<small>{group.year}</small></time><span className="milestone-node" aria-hidden="true" /><button className="milestone-card" type="button" onClick={() => choose(item.id)}><DomainNames item={item} names={names} /><h5>{item.title}</h5><p>{item.impact}</p><Icon name="chevronRight" className="milestone-card__arrow" size={17} /></button></div>)}
            </section>)}
          </section>
          <aside className="milestone-upcoming" aria-label="Planned milestones"><p className="milestones__eyebrow">ON THE HORIZON</p><h3>Upcoming / Planned</h3><p className="milestone-muted">Not part of the celebration history.</p>
            {planned.length ? planned.map(item => <button type="button" className="milestone-planned" key={item.id} onClick={() => choose(item.id)}><span className="milestone-planned__badge">PLANNED</span><DomainNames item={item} names={names} /><h4>{item.title}</h4><time dateTime={item.date}>{formatMilestoneDate(item.date, true)}</time></button>) : <p className="milestone-muted">No planned milestones in this view.</p>}
            <p className="milestone-help">Planned milestones use the same domain, year and quarter filters. A past planned date never means completed.</p>
            {filters.year !== "all" || filters.quarter !== "all" ? <button type="button" className="milestone-text-button" onClick={() => setFilters(value => ({ ...value, year: "all", quarter: "all" }))}>Explore all years →</button> : null}
          </aside>
        </div>
      </> : null}
      {selected && !editing ? <MilestoneDialog title={detailTitle} busy={busy} onClose={() => { setDeleting(false); onSelectId(null); }}>
        <div className="milestone-story"><DomainNames item={selected} names={names} /><h3>{selected.title}</h3><p className="milestone-story__impact">{selected.impact}</p><dl><div><dt>{selected.status === "Planned" ? "Planned date" : "Celebration date"}</dt><dd>{formatMilestoneDate(selected.date, true)}</dd></div><div><dt>Status</dt><dd>{selected.status}</dd></div></dl>
          {deleting ? <div className="milestone-warning"><p>This removes the achievement from every associated domain. There is no undo in this view.</p><button className="milestone-danger" type="button" disabled={disabled || busy || Boolean(pending)} onClick={() => write(null)}>Confirm delete milestone</button></div> :
            <><h4>The story</h4><p className="milestone-prewrap">{selected.details || "No additional details added."}</p><h4>Supporting evidence</h4>{selected.links.length ? <ul>{selected.links.map(link => <li key={link}><a href={link} target="_blank" rel="noopener noreferrer">{link}</a></li>)}</ul> : <p>No supporting links added.</p>}<p className="milestone-help">Created {selected.createdAt} · Updated {selected.updatedAt}</p></>}
          {writeError ? <p className="milestone-error" role="alert">{writeError}</p> : null}
          {adminUnlocked && !deleting ? <footer className="milestone-story__actions"><button type="button" className="app__add-btn" disabled={disabled || Boolean(pending)} onClick={() => { setWriteError(""); setEditing({ item: selected }); }}>Edit milestone</button><button type="button" className="milestone-danger" disabled={disabled || Boolean(pending)} onClick={() => setDeleting(true)}>Delete milestone</button></footer> : null}
          {deleting ? <button className="milestone-text-button" type="button" disabled={busy} onClick={() => setDeleting(false)}>Keep milestone</button> : null}
        </div>
      </MilestoneDialog> : null}
      {selectedId && !selected && result && !loading && !loadError ? <p role="alert" className="milestone-warning">This milestone no longer exists or is not in the current history. <button className="milestone-text-button" type="button" onClick={() => onSelectId(null)}>Close detail</button></p> : null}
      {editing ? <MilestoneForm key={editing.item?.id || "new"} item={editing.item} domains={domains} onSave={write} onClose={() => { setEditing(null); }} busy={busy} pending={pending} error={writeError} /> : null}
      {unlocking ? <MilestoneDialog title="Unlock milestone editing" onClose={() => setUnlocking(false)}><form className="milestone-form" onSubmit={event => { event.preventDefault(); onUnlock(token.trim()); setToken(""); setUnlocking(false); }}><label htmlFor="milestone-token">Admin token</label><input id="milestone-token" type="password" autoComplete="off" required value={token} onChange={event => setToken(event.target.value)} /><p className="milestone-help">The existing Toolbox admin token is verified by the backend on every write.</p><button type="submit" className="app__add-btn">Unlock</button></form></MilestoneDialog> : null}
    </div>
  );
}
