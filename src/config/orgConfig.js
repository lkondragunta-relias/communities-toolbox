export const ORG_CATEGORIES = ["Eng leader", "PM", "UX", "ENG Team members", "Team & Partners"];
export const DEFAULT_ORG_ROLES = [
  { name: "Eng leader", category: "Eng leader" },
  { name: "PM", category: "PM" },
  { name: "UX", category: "UX" },
  { name: "Engineer", category: "ENG Team members" },
  { name: "QA", category: "ENG Team members" },
  { name: "Team member", category: "ENG Team members" },
  { name: "Team & Partners", category: "Team & Partners" },
];
export const DEFAULT_ORGANIZATIONS = [
  { name: "Relias", color: "#15803d" },
  { name: "BrillMark", color: "#2563eb" },
  { name: "Radicle", color: "#9333ea" },
  { name: "Zaengle", color: "#c2410c" },
];
export const ORG_FIELDS = ["id", "domain", "personId", "personName", "role", "team", "organization", "status", "notes", "startDate", "endDate"];
export const ORG_HEADERS = ["ID", "Domain", "Person ID", "Person Name", "Role", "Team", "Organization", "Position Status", "Notes"];
export const orgKey = (value) => String(value || "").trim().toLowerCase();
export const personKey = (row) => row.personId || `name:${orgKey(row.personName)}:${orgKey(row.organization)}`;
export const assignmentKey = (row) => row.id || `sheet:${JSON.stringify(ORG_FIELDS.slice(1, row.startDate || row.endDate ? undefined : 9).map((field) => row[field] || ""))}`;

export function validOrgDate(value) {
  return /^\d{4}-\d{2}-\d{2}$/.test(value) && value.slice(0, 4) !== "0000" &&
    Number.isFinite(Date.parse(`${value}T00:00:00Z`)) && new Date(`${value}T00:00:00Z`).toISOString().slice(0, 10) === value;
}

export function assignmentActiveOn(row, date) {
  return (!row.startDate || row.startDate <= date) && (!row.endDate || row.endDate >= date);
}

export function assignmentDatesOverlap(a, b) {
  return (!a.endDate || !b.startDate || a.endDate >= b.startDate) &&
    (!b.endDate || !a.startDate || b.endDate >= a.startDate);
}

export function organizationColor(name, organizations = []) {
  if (orgKey(name) === "relias") return "#15803d";
  const configured = organizations.find((entry) => orgKey(entry.name) === orgKey(name));
  if (/^#[0-9a-f]{6}$/i.test(configured?.color)) return configured.color;
  const palette = ["#2563eb", "#9333ea", "#c2410c", "#be185d", "#0e7490", "#854d0e"];
  const hash = [...orgKey(name)].reduce((sum, char) => (sum * 31 + char.charCodeAt(0)) >>> 0, 0);
  return palette[hash % palette.length];
}

export function validateOrgAssignment(row, { domains, teams, roles, organizations, assignments = [] }) {
  for (const field of ["startDate", "endDate"]) {
    if (row[field] && !validOrgDate(row[field])) return "Start and end dates must be valid dates in YYYY-MM-DD format.";
  }
  if (row.startDate && row.endDate && row.startDate > row.endDate) return "End date must be on or after start date.";
  if (!domains.some((entry) => entry.id === row.domain)) return "Choose a domain from the Prod Eng Org domain list (columns Q-S).";
  const role = roles.find((entry) => entry.name === row.role);
  if (!role) return "Choose a configured role.";
  if (!ORG_CATEGORIES.includes(role.category)) return "This role needs a valid category in the Role Category column.";
  if (!["Assigned", "Open", "Not applicable"].includes(row.status)) return "Position status must be Assigned, Open, or Not applicable.";
  const others = assignments.filter((entry) => entry.id !== row.id);
  if (row.id && assignments.filter((entry) => entry.id === row.id).length > 1) return "Duplicate assignment ID. Give each row a unique ID in the sheet.";
  if (role.category === "UX" && others.some((entry) =>
    entry.domain === row.domain && roles.find((item) => item.name === entry.role)?.category === "UX" &&
    (row.status === "Not applicable" || entry.status === "Not applicable") && assignmentDatesOverlap(row, entry)
  )) return "A domain cannot have both a UX assignment and an explicit None, or multiple None entries.";
  if (row.status === "Not applicable") {
    if (role.category !== "UX" || row.personName || row.personId || row.team || row.organization) return "Not applicable is only for UX with no person, team, or organization.";
    return "";
  }
  if (!organizations.some((entry) => entry.name === row.organization)) return "Choose a configured organization.";
  if (row.team && !teams.some((entry) => entry.id === row.team)) return "Choose a team from the organization team list.";
  if (role.category === "Team & Partners") {
    if (!row.team) return "A team allocation requires a team.";
    if (row.personName || row.personId) return "Team allocations must not contain a person; add a separate member assignment.";
    if (row.status !== "Assigned") return "Use a person role for an open position.";
  } else if (row.status === "Assigned" && !row.personName) {
    return "A person's name is required for an assigned position.";
  } else if (row.status === "Open" && (row.personName || row.personId)) {
    return "An open position must not contain a person.";
  }
  if (role.category === "ENG Team members" && !row.team) return "Engineering team members need a team.";
  if (row.personId && others.some((entry) =>
    entry.personId === row.personId &&
    (orgKey(entry.personName) !== orgKey(row.personName) || orgKey(entry.organization) !== orgKey(row.organization))
  )) return "This Person ID already has a different name or organization. Reuse the existing person's details.";
  if (row.status === "Assigned" && others.some((entry) =>
    entry.status === "Assigned" && entry.domain === row.domain && assignmentDatesOverlap(row, entry) &&
    entry.role === row.role && entry.team === row.team && entry.organization === row.organization &&
    (row.personName ? (personKey(entry) === personKey(row) ||
      orgKey(entry.personName) === orgKey(row.personName)) : !entry.personName)
  )) return "This assignment already exists.";
  return "";
}
