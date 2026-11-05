import { organizationColor } from "../config/orgConfig.js";
import { organizationDomainDetails } from "../utils/orgUtils.js";

const period = (row) => `${row.startDate || "No start limit"} – ${row.endDate || "No end limit"}`;
const contactLabels = { "Eng leader": "Engineering leaders", PM: "Product managers", UX: "UX contacts" };

export default function OrgDomainDetail({ model, domainId, canEdit, onEdit, personLink, skillsFiltered = false }) {
  const details = organizationDomainDetails(model, domainId);
  if (!details) return <section className="org-card"><h3>Domain not found</h3><p>This domain is not in the connected organization domain list. Return to Domains to choose another.</p></section>;
  const edit = (row) => canEdit ? <button type="button" onClick={() => onEdit(row)} aria-label={`Edit ${row.personName || row.status} · ${row.role} · ${period(row)}`}>Edit assignment</button> : null;
  const organization = (name) => <span className="org-domain-organization" style={{ "--org-color": organizationColor(name, model.organizations) }}>{name}</span>;
  const assignment = (row) => <article key={row.id} className="org-contact-assignment">
    <strong>{row.personName && personLink ? personLink(row) : row.personName || (row.status === "Not applicable" ? "None — explicitly no UX assigned" : row.status)}</strong>
    <span>{row.role}{row.teamName ? ` · ${row.teamName}` : ""}</span>
    {row.organization ? organization(row.organization) : null}
    <span className="org-domain-period">{period(row)}</span>
    {row.notes ? <p className="org-domain-notes">{row.notes}</p> : null}
    {edit(row)}
  </article>;
  return <div className="org-domain-detail">
    <div className="org-stats">
      {[[details.peopleCount, "People"], [details.teams.length, "Assigned teams"], [details.organizations.length, "Organizations"], [details.open.length, "Open roles"]].map(([value, label]) => <div key={label}><b>{value}</b><span>{label}</span></div>)}
    </div>
    <div className="org-domain-layout">
      <div className="org-domain-main">
        <section className="org-card">
          <h3>Points of contact</h3>
          <p>Recorded role assignments. No primary owner or backup is implied.</p>
          <div className="org-contact-grid">{details.contacts.map(({ category, assignments, notApplicable }) => <section key={category} className="org-contact-card">
            <h4>{contactLabels[category]}</h4>
            {assignments.map(assignment)}
            {notApplicable.map(assignment)}
            {!assignments.length && !notApplicable.length ? <p className="org-missing">No assignment recorded in this date scope.</p> : null}
          </section>)}</div>
        </section>
        <section className="org-card">
          <h3>Engineering team members</h3>
          <p>Engineering contributors and their recorded roles, teams, and assignment dates.</p>
          {details.members.length ? <div className="org-table-wrap"><table className="org-domain-table">
            <thead><tr>{["Person", "Role / team", "Organization", "Assignment dates", "Notes", ...(canEdit ? ["Edit"] : [])].map((label) => <th scope="col" key={label}>{label}</th>)}</tr></thead>
            <tbody>{details.members.map((row) => <tr key={row.id}>
              <th scope="row">{personLink ? personLink(row) : row.personName}</th><td>{row.role}{row.teamName ? <span>{row.teamName}</span> : null}</td>
              <td>{organization(row.organization)}</td><td>{period(row)}</td>
              <td className="org-domain-notes">{row.notes || "—"}</td>{canEdit ? <td>{edit(row)}</td> : null}
            </tr>)}</tbody>
          </table></div> : <p className="org-missing">No engineering members recorded in this date scope.</p>}
        </section>
        <section className="org-card"><h3>Open positions</h3><p>Explicitly recorded vacancies, not inferred staffing gaps.</p>
          {details.open.length ? details.open.map(assignment) : <p className="org-missing">No open positions recorded in this date scope.</p>}
        </section>
        {details.issues.length ? <section className="org-card"><h3>Assignment data issues</h3><p>These rows are not counted as valid staffing.</p>
          {details.issues.map(({ row, message }, index) => <article className="org-flag" key={`${row.id}:${index}`}><strong>{row.personName || row.role || "Incomplete assignment"}</strong><p>{message}</p>{edit(row)}</article>)}
        </section> : null}
      </div>
      <aside className="org-domain-sidebar">
        <section className="org-card"><h3>Teams &amp; organizations</h3>
          <h4>Assigned teams</h4>{details.teams.length ? <ul>{details.teams.map((team) => <li key={team}>{team}</li>)}</ul> : <p className="org-missing">No team recorded. A person's team is optional.</p>}
          <h4>Organizations / partners</h4><div className="org-chips">{details.organizations.map((name) => <span key={name}>{organization(name)}</span>)}</div>
          {!details.organizations.length ? <p className="org-missing">No organization assignments recorded.</p> : null}
          <h4>Team-only allocations</h4>{details.allocations.length ? details.allocations.map((row) => <article className="org-contact-assignment" key={row.id}><strong>{row.teamName}</strong>{organization(row.organization)}<span className="org-domain-period">{period(row)}</span>{row.notes ? <p className="org-domain-notes">{row.notes}</p> : null}{edit(row)}</article>) : <p className="org-missing">No separate team allocations recorded.</p>}
        </section>
        <section className="org-card"><h3>About this view</h3><p>Uses the existing organization worksheet and selected date scope. {skillsFiltered ? "Matches any selected skill and any selected focus area." : "Directory role and organization filters do not hide assignments here."}</p><p>Assignment dates describe recorded plans and history, not workload or availability. Blank dates have no time limit.</p><p>Review confirmations, primary owners, backups, and contact links are not recorded in the current data.</p></section>
      </aside>
    </div>
  </div>;
}
