import { ORG_CATEGORIES, ORG_FIELDS, assignmentActiveOn, assignmentKey, orgKey, personKey, validOrgDate, validateOrgAssignment } from "../config/orgConfig.js";

export function buildOrganization(data, asOf = "") {
  if (asOf && !validOrgDate(asOf)) throw new Error("Choose a valid organization snapshot date.");
  const source = data.org || {};
  const domains = (source.domains || data.domains || [])
    .map((domain, index) => ({ ...domain, order: Number.isFinite(Number(domain.order)) && domain.order !== "" && domain.order != null ? Number(domain.order) : index + 1 }))
    .sort((a, b) => a.order - b.order);
  const teams = source.teams || data.teams || [];
  const roles = source.roles || [];
  const organizations = source.organizations || [];
  const configurationIssues = [];
  if (source.configured) {
    if (!roles.length) configurationIssues.push("No roles configured. Add Role Option and Role Category values in columns K-L.");
    if (!organizations.length) configurationIssues.push("No organizations configured. Add Organization Option and Badge Color values in columns N-O.");
    roles.forEach((role) => {
      if (!ORG_CATEGORIES.includes(role.category)) configurationIssues.push(`${role.name}: choose a valid Role Category in column L.`);
      if (roles.filter((entry) => orgKey(entry.name) === orgKey(role.name)).length > 1) configurationIssues.push(`Duplicate role name: ${role.name}.`);
    });
    organizations.forEach((organization) => {
      if (!/^#[0-9a-f]{6}$/i.test(organization.color)) configurationIssues.push(`${organization.name}: use a six-digit hex Badge Color in column O.`);
      if (organizations.filter((entry) => orgKey(entry.name) === orgKey(organization.name)).length > 1) configurationIssues.push(`Duplicate organization name: ${organization.name}.`);
    });
  }
  const assignments = (source.assignments || []).map((entry) => {
    const row = Object.fromEntries(
      ORG_FIELDS
        .map((field) => [field, String(entry[field] || "").trim()])
    );
    const domain = domains.find((item) => [orgKey(item.id), orgKey(item.name)].includes(orgKey(row.domain)));
    const team = teams.find((item) => [orgKey(item.id), orgKey(item.label)].includes(orgKey(row.team)));
    const role = roles.find((item) => orgKey(item.name) === orgKey(row.role));
    const organization = organizations.find((item) => orgKey(item.name) === orgKey(row.organization));
    return {
      ...row,
      id: assignmentKey(row),
      domain: domain?.id || row.domain,
      domainName: domain?.name || row.domain,
      team: team?.id || row.team,
      teamName: team?.label || row.team,
      role: role?.name || row.role,
      category: role?.category || "",
      organization: organization?.name || row.organization,
      status: ({ assigned: "Assigned", open: "Open", "not applicable": "Not applicable" })[orgKey(row.status)] || row.status,
    };
  });
  const identities = new Map();
  assignments.filter((row) => row.personId && row.personName).forEach((row) => {
    const key = `${orgKey(row.personName)}:${orgKey(row.organization)}`;
    if (!identities.has(key)) identities.set(key, new Set());
    identities.get(key).add(row.personId);
  });
  assignments.filter((row) => !row.personId && row.personName).forEach((row) => {
    const ids = identities.get(`${orgKey(row.personName)}:${orgKey(row.organization)}`);
    if (ids?.size === 1) row.personId = [...ids][0];
  });
  const context = { domains, teams, roles, organizations, assignments };
  const issues = assignments.flatMap((row) => {
    const message = validateOrgAssignment(row, context);
    return message ? [{ row, message }] : [];
  });
  const validIds = new Set(issues.map(({ row }) => row.id));
  const valid = assignments.filter((row) => !validIds.has(row.id) && (!asOf || assignmentActiveOn(row, asOf)));
  const filled = valid.filter((row) => row.status === "Assigned");
  const notApplicable = valid.filter((row) => row.status === "Not applicable");
  const people = new Map();
  filled.filter((row) => row.personName).forEach((row) => {
    const key = personKey(row);
    if (!people.has(key)) people.set(key, { key, name: row.personName, organization: row.organization, assignments: [] });
    people.get(key).assignments.push(row);
  });
  const gaps = domains.flatMap((domain) => {
    const rows = [...filled, ...notApplicable].filter((row) => row.domain === domain.id);
    return ["Eng leader", "PM", "UX", "Team & Partners", "ENG Team members"]
      .filter((category) => !rows.some((row) =>
        category === "Team & Partners" ? Boolean(row.team) : row.category === category
      ))
      .map((category) => ({ domain, category }));
  });
  return { ...context, assignments, filled, notApplicable, people: [...people.values()], gaps, issues, configurationIssues: [...new Set(configurationIssues)], open: valid.filter((row) => row.status === "Open") };
}

export function filterOrgRows(rows, { query = "", domain = "", organization = "", role = "" }) {
  const search = orgKey(query);
  return rows.filter((row) =>
    (!domain || row.domain === domain) &&
    (!organization || row.organization === organization) &&
    (!role || row.role === role) &&
    (!search || [row.domainName, row.personName, row.teamName, row.organization, row.role, row.notes]
      .some((value) => orgKey(value).includes(search)))
  );
}

export function groupOrgRows(rows, key) {
  const groups = new Map();
  rows.forEach((row) => {
    const value = row[key] || "Unassigned";
    if (!groups.has(value)) groups.set(value, []);
    groups.get(value).push(row);
  });
  return [...groups.entries()].sort(([a], [b]) => a.localeCompare(b));
}

export function orgTeamAndPartnerBadges(rows) {
  const teams = rows.filter((row) => row.team);
  const badges = new Map();
  teams.forEach((row) => {
    const label = row.teamName || row.team;
    const key = orgKey(label);
    if (!badges.has(key)) badges.set(key, { kind: "team", label, organization: "Relias" });
  });
  teams.forEach((row) => {
    if (!row.organization || orgKey(row.organization) === "relias") return;
    const key = orgKey(row.organization);
    if (badges.has(key)) badges.get(key).organization = row.organization;
    else badges.set(key, { kind: "partner", label: row.organization, organization: row.organization });
  });
  return [...badges.values()];
}
