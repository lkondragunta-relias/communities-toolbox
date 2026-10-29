import { useEffect, useMemo, useRef, useState } from "react";
import { ORG_FIELDS, orgKey, organizationColor, personKey, validateOrgAssignment } from "../../config/orgConfig.js";
import { buildOrganization, filterOrgRows, groupOrgRows, orgTeamAndPartnerBadges } from "../../utils/orgUtils.js";
import { deleteOrgAssignment, getGoogleSheetUrl, isLocalMode, saveOrgAssignment } from "../../services/sheetsApi";
import "../../styles/org.css";

const TABS = [
  ["domains", "Domains"],
  ["teams", "Teams & partners"],
  ["people", "People"],
  ["gaps", "Open roles & flags"],
];
const EMPTY_ASSIGNMENT = { domain: "", personId: "", personName: "", role: "Engineer", team: "", organization: "Relias", status: "Assigned", notes: "" };
const unique = (values) => [...new Set(values.filter(Boolean))];

function Dialog({ title, onClose, busy, children }) {
  const ref = useRef(null);
  useEffect(() => {
    const previous = document.activeElement;
    ref.current.showModal();
    return () => {
      previous?.focus();
    };
  }, []);
  return (
    <dialog ref={ref} className="org-dialog" aria-label={title} onCancel={(event) => {
      event.preventDefault();
      if (!busy) onClose();
    }}>
      <header><h2>{title}</h2><button type="button" disabled={busy} onClick={onClose} aria-label="Close dialog">×</button></header>
      {children}
    </dialog>
  );
}

function Field({ label, children }) {
  return <label className="org-field"><span>{label}</span>{children}</label>;
}

function AssignmentForm({ entry, model, onSave, onClose }) {
  const [form, setForm] = useState(() => ({ ...EMPTY_ASSIGNMENT, ...entry }));
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const role = model.roles.find((item) => item.name === form.role);
  const isTeam = role?.category === "Team & Partners";
  const isNone = form.status === "Not applicable";
  const needsPerson = !isTeam && form.status === "Assigned";
  const set = (key, value) => setForm((previous) => {
    const next = { ...previous, [key]: value };
    const nextRole = model.roles.find((item) => item.name === next.role);
    if (next.status === "Not applicable" && nextRole?.category !== "UX") next.status = "Assigned";
    if (next.status !== "Assigned" || nextRole?.category === "Team & Partners") {
      next.personId = "";
      next.personName = "";
    }
    if (nextRole?.category === "Team & Partners") next.status = "Assigned";
    if (next.status === "Not applicable") { next.team = ""; next.organization = ""; }
    return next;
  });
  const personValue = model.people.find((person) =>
    person.key === personKey(form) && person.name === form.personName && person.organization === form.organization
  )?.key || "";
  const options = (values, current) => unique([...values, current]);
  const submit = async (event) => {
    event.preventDefault();
    const row = Object.fromEntries(ORG_FIELDS.map((key) => [key, String(form[key] || "").trim()]));
    const message = validateOrgAssignment(row, model);
    if (message) { setError(message); return; }
    // Reuse a known identity across domain assignments; never merge different
    // vendors' people merely because their names match.
    const known = model.people.find((person) => orgKey(person.name) === orgKey(row.personName) && orgKey(person.organization) === orgKey(row.organization));
    if (row.personName) row.personId = known?.assignments[0].personId || row.personId || crypto.randomUUID();
    setBusy(true);
    setError("");
    try { await onSave(row); onClose(); }
    catch (err) { setError(err.message); }
    finally { setBusy(false); }
  };
  return (
    <Dialog title={entry?.id ? "Edit assignment" : "Add assignment or open role"} onClose={onClose} busy={busy}>
      <form onSubmit={submit}>
        <p>One row assigns one person, role, and team to one domain. Repeat for additional domains or roles.</p>
        <fieldset disabled={busy}>
          <div className="org-form-grid">
            <Field label="Domain">
              <select required value={form.domain} onChange={(e) => set("domain", e.target.value)}>
                <option value="">Choose a domain</option>
                {model.domains.map((domain) => <option key={domain.id} value={domain.id}>{domain.name}</option>)}
              </select>
            </Field>
            <Field label="Role">
              <select required value={form.role} onChange={(e) => set("role", e.target.value)}>
                <option value="">Choose a role</option>
                {options(model.roles.map((item) => item.name), form.role).map((name) => <option key={name}>{name}</option>)}
              </select>
            </Field>
            <Field label="Position status">
              <select value={form.status} disabled={isTeam} onChange={(e) => set("status", e.target.value)}>
                <option>Assigned</option><option>Open</option>{role?.category === "UX" ? <option value="Not applicable">None — no UX assigned</option> : null}
              </select>
            </Field>
            <Field label="Organization / partner">
              <select required={!isNone} disabled={isNone} value={form.organization} onChange={(e) => {
                setForm((previous) => ({ ...previous, organization: e.target.value, personId: "", personName: "" }));
              }}>
                <option value="">Choose an organization</option>
                {options(model.organizations.map((item) => item.name), form.organization).map((name) => <option key={name}>{name}</option>)}
              </select>
            </Field>
            {needsPerson ? <>
              <Field label="Reuse an existing person">
                <select value={personValue} onChange={(e) => {
                  const person = model.people.find((item) => item.key === e.target.value);
                  setForm((previous) => ({ ...previous, personId: person?.assignments[0].personId || "", personName: person?.name || "", organization: person?.organization || previous.organization }));
                }}>
                  <option value="">New person</option>
                  {model.people.map((person) => <option key={person.key} value={person.key}>{person.name} — {person.organization}</option>)}
                </select>
              </Field>
              <Field label="Person name">
                <input required value={form.personName} onChange={(e) => {
                  setForm((previous) => ({ ...previous, personName: e.target.value, personId: "" }));
                }} />
              </Field>
            </> : null}
            <Field label={`Engineering team${isTeam || role?.category === "ENG Team members" ? "" : " (optional)"}`}>
              <select disabled={isNone} required={isTeam || role?.category === "ENG Team members"} value={form.team} onChange={(e) => set("team", e.target.value)}>
                <option value="">No team</option>
                {model.teams.map((team) => <option key={team.id} value={team.id}>{team.label}</option>)}
              </select>
            </Field>
          </div>
          <Field label="Notes"><textarea rows={3} value={form.notes} onChange={(e) => set("notes", e.target.value)} /></Field>
        </fieldset>
        {error ? <p role="alert" className="roadmap__error">{error}</p> : null}
        <footer><button type="button" disabled={busy} onClick={onClose}>Cancel</button><button type="submit" className="org-primary" disabled={busy}>{busy ? "Saving…" : "Save assignment"}</button></footer>
      </form>
    </Dialog>
  );
}

export default function OrgView({ data, adminUnlocked, adminToken, onUnlock, onLock, applyRoadmap, refetch }) {
  const model = useMemo(() => buildOrganization(data), [data]);
  const [tab, setTab] = useState("domains");
  const [group, setGroup] = useState("domain");
  const [filters, setFilters] = useState({ query: "", domain: "", organization: "", role: "" });
  const [focusedPerson, setFocusedPerson] = useState("");
  const [modal, setModal] = useState(null);
  const [token, setToken] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);
  const ready = Boolean(data.org?.configured);
  const sheetUrl = getGoogleSheetUrl();
  const rows = filterOrgRows([...model.filled, ...model.notApplicable], filters);
  const assignedPeople = new Set(rows.filter((row) => row.personName).map(personKey));
  const people = model.people.filter((person) => (!focusedPerson || person.key === focusedPerson) &&
    person.assignments.some((row) => rows.some((match) => match.id === row.id)));
  const setFilter = (key, value) => { setFilters((previous) => ({ ...previous, [key]: value })); setFocusedPerson(""); };
  const reset = () => { setFilters({ query: "", domain: "", organization: "", role: "" }); setFocusedPerson(""); };
  const focusPerson = (row) => { reset(); setFocusedPerson(personKey(row)); setTab("people"); };
  const focusTeamOrPartner = (item) => {
    reset(); setFilters({ query: item.kind === "team" ? item.label : "", domain: "", organization: item.kind === "partner" ? item.organization : "", role: "" }); setTab("teams");
  };
  const applyResult = (result) => {
    if (!result.org?.configured) throw new Error("The server did not return organization data. Deploy the updated Apps Script and retry.");
    applyRoadmap({ ...data, org: result.org });
    setNotice("Saved.");
  };
  const save = async (row) => applyResult(await saveOrgAssignment({ ...row, adminToken }));
  const remove = async (row) => {
    if (!window.confirm(`Remove this ${row.role} assignment for ${row.domainName}? Other assignments are not affected.`)) return;
    setBusy(true); setError("");
    try { applyResult(await deleteOrgAssignment({ adminToken, id: row.id })); }
    catch (err) { setError(err.message); }
    finally { setBusy(false); }
  };
  const badge = (text, organization, onClick, key) => (
    <button type="button" key={key || text} className="org-badge" style={{ "--org-color": organizationColor(organization, model.organizations) }} onClick={onClick}>{text}</button>
  );
  const memberBadges = (entries) => {
    const seen = new Set();
    return entries.filter((row) => {
      const key = personKey(row);
      if (seen.has(key)) return false;
      seen.add(key); return true;
    }).map((row) => badge(row.personName, row.organization, () => focusPerson(row), personKey(row)));
  };
  const teamBadges = (entries) => orgTeamAndPartnerBadges(entries).map((item) =>
    badge(item.label, item.organization, () => focusTeamOrPartner(item), orgKey(item.label))
  );
  const memberGroups = (entries) => groupOrgRows(entries.filter((row) => row.personName), "organization").map(([name, assigned]) =>
    <div key={name} className="org-member-group"><strong>{name}</strong><div className="org-chips">{memberBadges(assigned)}</div></div>
  );
  const missing = <span className="org-missing">Unassigned</span>;
  const domainTable = (domains, scoped) => (
    <div className="org-table-wrap"><table className="org-table">
      <thead><tr>{["Domain", "Eng leader", "PM", "UX", "ENG Team & partners", "ENG Team members"].map((label) => <th key={label} scope="col">{label}</th>)}</tr></thead>
      <tbody>{domains.map((domain) => {
        const assigned = scoped.filter((row) => row.domain === domain.id);
        const roleCell = (category) => {
          const entries = assigned.filter((row) => row.category === category && row.personName);
          const none = assigned.some((row) => row.category === category && row.status === "Not applicable");
          return <td><div className="org-chips">{entries.length ? memberBadges(entries) : none ? <span>None</span> : missing}</div></td>;
        };
        const members = assigned.filter((row) => row.category === "ENG Team members");
        return <tr key={domain.id}>
          <th scope="row"><button type="button" className="org-link" onClick={() => { reset(); setFilter("domain", domain.id); setGroup("domain"); }}>{domain.name}</button>
          </th>
          {roleCell("Eng leader")}{roleCell("PM")}{roleCell("UX")}
          <td><div className="org-chips">{assigned.some((row) => row.team) ? teamBadges(assigned) : missing}</div></td>
          <td>{members.length ? memberGroups(members) : missing}</td>
        </tr>;
      })}</tbody>
    </table></div>
  );
  const visibleDomains = model.domains.filter((domain) =>
    (!filters.domain || filters.domain === domain.id) &&
    (!filters.query || orgKey(domain.name).includes(orgKey(filters.query)) || rows.some((row) => row.domain === domain.id)) &&
    ((!filters.role && !filters.organization) || rows.some((row) => row.domain === domain.id))
  );
  const grouped = group === "domain" ? [] : groupOrgRows(rows, group);
  const teamGroups = groupOrgRows(rows.filter((row) => row.team), "team");
  const vacantTeams = model.teams.filter((team) => !model.filled.some((row) => row.team === team.id) && !filters.domain && !filters.organization && !filters.role &&
    (!filters.query || orgKey(team.label).includes(orgKey(filters.query))));
  const open = filterOrgRows(model.open, filters);
  const gaps = model.gaps.filter(({ domain, category }) => (!filters.domain || domain.id === filters.domain) &&
    (!filters.query || orgKey(`${domain.name} ${category}`).includes(orgKey(filters.query))));
  return (
    <div className="org-page">
      <header className="org-head"><div><h2>Domain ownership & team directory</h2><p>Find the people, teams, and partners supporting each domain.</p></div>
        <div className="org-actions">
          <button type="button" disabled={busy} onClick={async () => {
            setBusy(true); setError(""); setNotice("");
            try { await refetch({ throwOnError: true }); setNotice("Organization data refreshed."); }
            catch (err) { setError(err.message); }
            finally { setBusy(false); }
          }}>Refresh</button>
          {sheetUrl ? <a className="org-workbook-button" href={sheetUrl} target="_blank" rel="noopener noreferrer">Open workbook</a> : null}
          {adminUnlocked && ready ? <button type="button" className="org-primary" onClick={() => setModal({ kind: "assignment", entry: filters.domain ? { domain: filters.domain } : null })}>+ Add assignment</button> : null}
        </div>
      </header>
      {isLocalMode() ? <p role="status" className="org-callout"><strong>Local preview only.</strong> Data is stored in this browser, not your live Google Sheet. Domain choices are a local snapshot, not a live sync. Preview edits cannot change the live workbook.</p> : null}
      {!ready ? <p role="status" className="org-callout">Organization data is not connected yet. Add the Prod Eng Org tab and deploy the updated Code.gs web app, then refresh. No sample people are displayed.</p> : null}
      {error ? <p role="alert" className="roadmap__error">{error}</p> : null}
      {notice ? <p role="status">{notice}</p> : null}
      <div className="org-stats">
        {[[visibleDomains.length, "Domains"], [assignedPeople.size, "People"], [unique(rows.map((row) => row.team)).length, "Assigned teams"], [unique(rows.filter((row) => orgKey(row.organization) !== "relias").map((row) => row.organization)).length, "Partners"], [open.length, "Open roles"]].map(([value, label]) => <div key={label}><b>{value}</b><span>{label}</span></div>)}
      </div>
      <div className="org-toolbar">
        <Field label="Search"><input type="search" placeholder="Person, domain, team, partner…" value={filters.query} onChange={(e) => setFilter("query", e.target.value)} /></Field>
        <Field label="Domain"><select value={filters.domain} onChange={(e) => setFilter("domain", e.target.value)}><option value="">All domains</option>{model.domains.map((domain) => <option key={domain.id} value={domain.id}>{domain.name}</option>)}</select></Field>
        <Field label="Organization / partner"><select value={filters.organization} onChange={(e) => setFilter("organization", e.target.value)}><option value="">All organizations</option>{model.organizations.map((item) => <option key={item.name}>{item.name}</option>)}</select></Field>
        <Field label="Role"><select value={filters.role} onChange={(e) => setFilter("role", e.target.value)}><option value="">All roles</option>{model.roles.map((item) => <option key={item.name}>{item.name}</option>)}</select></Field>
        <button type="button" onClick={reset}>Clear filters</button>
      </div>
      <div className="org-legend" aria-label="Organization colors">
        {model.organizations.map((item) => badge(item.name, item.name, () => setFilter("organization", item.name)))}
      </div>
      <div className="org-tabs" role="tablist" aria-label="Organization views">
        {TABS.map(([id, label]) => <button key={id} type="button" id={`org-tab-${id}`} role="tab" aria-selected={tab === id} aria-controls={`org-panel-${id}`} tabIndex={tab === id ? 0 : -1} onClick={() => { setTab(id); setFocusedPerson(""); }} onKeyDown={(event) => {
          if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
          event.preventDefault();
          const index = event.key === "Home" ? 0 : event.key === "End" ? TABS.length - 1 : (TABS.findIndex(([key]) => key === id) + (event.key === "ArrowRight" ? 1 : -1) + TABS.length) % TABS.length;
          setTab(TABS[index][0]); document.getElementById(`org-tab-${TABS[index][0]}`).focus();
        }}>{label}{id === "gaps" && ready ? ` (${open.length + gaps.length + model.issues.length + model.configurationIssues.length})` : ""}</button>)}
      </div>
      <section role="tabpanel" id={`org-panel-${tab}`} aria-labelledby={`org-tab-${tab}`}>
        {tab === "domains" ? <>
          <Field label="Group by"><select value={group} onChange={(e) => setGroup(e.target.value)}>
            <option value="domain">Domain</option><option value="engLeader">Eng leader</option><option value="pm">PM</option><option value="ux">UX</option><option value="teamName">Engineering team</option><option value="organization">Organization / partner</option>
          </select></Field>
          {["engLeader", "pm", "ux"].includes(group) ? (() => {
            const category = { engLeader: "Eng leader", pm: "PM", ux: "UX" }[group];
            const assigned = rows.filter((row) => row.category === category && (row.personName || row.status === "Not applicable"));
            const peopleGroups = groupOrgRows(assigned.map((row) => ({ ...row, personGroup: row.status === "Not applicable" ? "None" : `${row.personName} · ${row.organization}` })), "personGroup");
            const without = visibleDomains.filter((domain) => !assigned.some((row) => row.domain === domain.id));
            return <>{peopleGroups.map(([name, entries]) => <section key={name} className="org-section"><h3>{name}</h3>{domainTable(visibleDomains.filter((domain) => entries.some((row) => row.domain === domain.id)), rows)}</section>)}
              {without.length ? <section className="org-section"><h3>Unassigned {category}</h3>{domainTable(without, rows)}</section> : null}</>;
          })() : group === "domain" ? domainTable(visibleDomains, rows) : <>
            {grouped.map(([name, entries]) => <section key={name} className="org-section"><h3>{name}</h3>{domainTable(visibleDomains.filter((domain) => entries.some((row) => row.domain === domain.id)), entries)}</section>)}
            {visibleDomains.some((domain) => !rows.some((row) => row.domain === domain.id)) ? <section className="org-section"><h3>No assignments yet</h3>{domainTable(visibleDomains.filter((domain) => !rows.some((row) => row.domain === domain.id)), [])}</section> : null}
          </>}
          {!visibleDomains.length ? <p className="org-empty">No domains match these filters.</p> : null}
          <p className="org-help">Unassigned means no matching filled assignment, not an approved vacancy. None means explicitly no UX assigned. Filtered views show only matching assignments.</p>
        </> : tab === "teams" ? <div className="org-cards">
          {teamGroups.map(([team, entries]) => <article key={team} className="org-card"><h3>{entries[0].teamName}</h3>
            <p>{unique(entries.map((row) => row.domainName)).join(" · ")}</p>
            {groupOrgRows(entries, "organization").map(([name, members]) => <section key={name} className="org-member-group"><h4>{badge(name, name, () => setFilter("organization", name))}</h4>
              <p>{unique(members.map((row) => row.domainName)).join(" · ")}</p>
              <div className="org-chips">{memberBadges(members.filter((row) => row.category === "ENG Team members" && row.personName))}</div>
              {!members.some((row) => row.category === "ENG Team members" && row.personName) ? <p className="org-missing">No engineering members assigned</p> : null}
            </section>)}
          </article>)}
          {vacantTeams.map((team) => <article key={team.id} className="org-card"><h3>{team.label}</h3><p className="org-missing">No domain or member assignments yet</p></article>)}
          {!teamGroups.length && !vacantTeams.length ? <p className="org-empty">No teams match these filters.</p> : null}
        </div> : tab === "people" ? <>
          {focusedPerson ? <button type="button" onClick={() => setFocusedPerson("")}>Show all people</button> : null}
          <div className="org-cards">{people.map((person) => <article key={person.key} className="org-card"><h3>{badge(person.name, person.organization, () => setFilter("organization", person.organization), person.key)}</h3><p>{person.organization} · {unique(person.assignments.map((row) => row.domain)).length} domains</p>
            <ul className="org-assignments">{person.assignments.filter((row) => rows.some((match) => match.id === row.id)).map((row) => <li key={row.id}><strong>{row.domainName}</strong><span>{row.role}{row.teamName ? ` · ${row.teamName}` : ""}</span>{row.notes ? <p>{row.notes}</p> : null}
              {adminUnlocked ? <div className="org-actions"><button type="button" disabled={busy} onClick={() => setModal({ kind: "assignment", entry: row })}>Edit</button><button type="button" disabled={busy} onClick={() => remove(row)}>Remove</button></div> : null}
            </li>)}</ul>
          </article>)}</div>
          {!people.length ? <p className="org-empty">No people assigned yet, or none match these filters.</p> : null}
        </> : <>
          <h3>Open positions</h3><p>Explicitly recorded vacancies, separate from missing assignments.</p>
          {open.map((row) => <article className="org-flag" key={row.id}><strong>{row.domainName} · {row.role}</strong><p>{row.organization}{row.teamName ? ` · ${row.teamName}` : ""}{row.notes ? ` — ${row.notes}` : ""}</p>
            {adminUnlocked ? <div className="org-actions"><button type="button" disabled={busy} onClick={() => setModal({ kind: "assignment", entry: row })}>Edit / fill position</button><button type="button" disabled={busy} onClick={() => remove(row)}>Remove</button></div> : null}
          </article>)}
          {!open.length ? <p>No open positions recorded.</p> : null}
          <h3>Missing domain assignments</h3><p>Checked against the full roster, not the role or partner filter. A missing assignment is not automatically a hiring request.</p>
          {ready ? gaps.map(({ domain, category }) => <article className="org-flag" key={`${domain.id}:${category}`}><strong>{domain.name}</strong><span>{category} unassigned</span>
            {adminUnlocked ? <button type="button" onClick={() => setModal({ kind: "assignment", entry: { domain: domain.id, role: model.roles.find((item) => item.category === category)?.name || "" } })}>Assign</button> : null}
          </article>) : <p>Connect the Sheet before checking coverage.</p>}
          <h3>Data issues</h3>{model.configurationIssues.map((message) => <p role="alert" key={message} className="org-flag">{message}</p>)}
          {model.issues.length ? model.issues.map(({ row, message }, index) => <article key={`${row.id}:${index}`} className="org-flag"><strong>{row.domainName || "No domain"} · {row.personName || row.role || "Incomplete row"}</strong><p>{message}</p>
            {adminUnlocked ? <button type="button" onClick={() => setModal({ kind: "assignment", entry: row })}>Correct assignment</button> : null}
          </article>) : <p>No invalid assignment rows.</p>}
        </>}
      </section>
      {adminUnlocked && ready && [...model.filled, ...model.notApplicable].some((row) => !row.personName) ? <details className="org-section"><summary>Manage team allocations & explicit UX None</summary>
        {[...model.filled, ...model.notApplicable].filter((row) => !row.personName).map((row) => <div key={row.id} className="org-allocation"><span>{row.domainName} · {row.status === "Not applicable" ? "UX: None" : `${row.teamName} · ${row.organization}`}</span><button type="button" disabled={busy} onClick={() => setModal({ kind: "assignment", entry: row })}>Edit</button><button type="button" disabled={busy} onClick={() => remove(row)}>Remove</button></div>)}
      </details> : null}
      <footer className="org-admin">{adminUnlocked ? <button type="button" onClick={onLock}>Lock editing</button> :
        <form onSubmit={(event) => { event.preventDefault(); if (token.trim()) { onUnlock(token.trim()); setToken(""); } }}>
          <label>Admin token <input type="password" autoComplete="off" value={token} onChange={(e) => setToken(e.target.value)} required /></label><button type="submit">Unlock editing</button>
        </form>}
        <p>Names and assignments have the same viewing access as the rest of the Toolbox. Edits require the existing admin token.</p>
      </footer>
      {modal?.kind === "assignment" ? <AssignmentForm entry={modal.entry} model={model} onSave={save} onClose={() => setModal(null)} /> : null}
    </div>
  );
}
