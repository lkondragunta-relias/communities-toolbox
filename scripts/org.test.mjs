import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";
import { DEFAULT_ORGANIZATIONS, DEFAULT_ORG_ROLES, ORG_FIELDS, ORG_HEADERS, assignmentKey, organizationColor, validateOrgAssignment } from "../src/config/orgConfig.js";
import { buildOrganization, filterOrgRows, orgTeamAndPartnerBadges } from "../src/utils/orgUtils.js";

const domains = [{ id: "wound-care", name: "Wound Care" }, { id: "freecme", name: "FreeCME" }];
const teams = [{ id: "core", label: "Core" }];
const org = { configured: true, assignments: [], roles: DEFAULT_ORG_ROLES, organizations: DEFAULT_ORGANIZATIONS };
const context = { ...org, domains, teams };
const assignment = (changes = {}) => ({
  id: "a1", domain: "wound-care", personId: "p1", personName: "Example Person",
  role: "Engineer", team: "core", organization: "Relias", status: "Assigned", notes: "", ...changes,
});

test("one person supports multiple domains and roles without duplicated headcount", () => {
  const model = buildOrganization({ domains, teams, org: { ...org, assignments: [
    assignment(), assignment({ id: "a2", domain: "freecme", role: "UX", team: "" }),
  ] } });
  assert.equal(model.people.length, 1);
  assert.equal(model.people[0].assignments.length, 2);
  assert.equal(model.issues.length, 0);
  assert.equal(filterOrgRows(model.filled, { query: "Wound Care" }).length, 1);
  assert.equal(filterOrgRows(model.filled, { role: "UX", domain: "freecme" }).length, 1);
});

test("teams do not grant implicit domain membership", () => {
  const model = buildOrganization({ domains, teams, org: { ...org, assignments: [
    assignment(), assignment({ id: "a2", domain: "freecme", role: "Team & Partners", personId: "", personName: "" }),
  ] } });
  assert.equal(model.people[0].assignments.length, 1);
  assert(model.gaps.some((gap) => gap.domain.id === "freecme" && gap.category === "ENG Team members"));
  assert(!model.gaps.some((gap) => gap.domain.id === "freecme" && gap.category === "Team & Partners"));
});

test("blank sheet Person IDs reuse an unambiguous known identity", () => {
  const model = buildOrganization({ domains, teams, org: { ...org, assignments: [
    assignment(), assignment({ id: "a2", personId: "", domain: "freecme" }),
  ] } });
  assert.equal(model.people.length, 1);
  assert.equal(model.people[0].assignments.length, 2);
});

test("open positions and inferred gaps remain distinct", () => {
  const model = buildOrganization({ domains, teams, org: { ...org, assignments: [
    assignment({ role: "UX", personName: "", personId: "", status: "Open", team: "" }),
  ] } });
  assert.equal(model.open.length, 1);
  assert.equal(model.people.length, 0);
  assert.equal(model.gaps.length, 10);
  assert.equal(buildOrganization({ domains, teams, org }).gaps.length, 10);
});

test("same-named people in different organizations stay separate and colored consistently", () => {
  const model = buildOrganization({ domains, teams, org: { ...org, assignments: [
    assignment({ personId: "" }), assignment({ id: "a2", personId: "", organization: "BrillMark" }),
  ] } });
  assert.equal(model.people.length, 2);
  assert.equal(organizationColor("Relias", [{ name: "Relias", color: "#ff0000" }]), "#15803d");
  assert.equal(organizationColor("BrillMark", DEFAULT_ORGANIZATIONS), "#2563eb");
  assert.equal(new Set(DEFAULT_ORGANIZATIONS.map((entry) => organizationColor(entry.name, DEFAULT_ORGANIZATIONS))).size, 4);
});

test("invalid sheet entries are flagged rather than silently counted", () => {
  const model = buildOrganization({ domains, teams, org: { ...org, assignments: [
    assignment({ domain: "unknown" }), assignment({ id: "a2", role: "Unknown" }),
  ] } });
  assert.equal(model.issues.length, 2);
  assert.equal(model.filled.length, 0);
});

test("validation enforces domain, role, organization, open-position and member rules", () => {
  assert.equal(validateOrgAssignment(assignment(), context), "");
  for (const changes of [{ domain: "missing" }, { role: "missing" }, { organization: "" }, { team: "" }, { status: "Open" }]) {
    assert(validateOrgAssignment(assignment(changes), context));
  }
  assert(validateOrgAssignment(assignment({ role: "Team & Partners" }), context));
  assert.equal(validateOrgAssignment(assignment({ role: "QA" }), context), "");
  assert(validateOrgAssignment(assignment({ id: "a2" }), { ...context, assignments: [assignment()] }));
  assert(validateOrgAssignment(assignment({ id: "a2", personName: "Different" }), { ...context, assignments: [assignment()] }));
});

test("manual sheet rows resolve shared lookup labels, and missing IDs remain stable", () => {
  const row = assignment({ id: "", domain: "Wound Care", team: "Core" });
  const model = buildOrganization({ domains, teams, org: { ...org, assignments: [row] } });
  assert.equal(model.filled[0].domain, "wound-care");
  assert.equal(model.filled[0].team, "core");
  assert.equal(model.filled[0].id, assignmentKey(row));
});

class Sheet {
  constructor(name, cells = []) { this.name = name; this.cells = cells; this.maxRows = 1000; this.maxColumns = 26; }
  getName() { return this.name; }
  getLastRow() {
    return this.cells.reduce((last, row, index) => row.some((value) => value !== "" && value !== undefined) ? index + 1 : last, 0);
  }
  getLastColumn() { return this.cells.reduce((max, row) => Math.max(max, row.length), 0); }
  getMaxRows() { return this.maxRows; }
  getMaxColumns() { return this.maxColumns; }
  getDataRange() { return this.getRange(1, 1, Math.max(1, this.getLastRow()), Math.max(1, this.getLastColumn())); }
  setFrozenRows() {}
  setColumnWidths() {}
  setColumnWidth() {}
  getIndex() { return this.index || 1; }
  insertRowsAfter(_after, count) { this.maxRows += count; }
  getRange(row, column, rows = 1, columns = 1) {
    const sheet = this;
    return {
      getValues() { return Array.from({ length: rows }, (_, r) => Array.from({ length: columns }, (_, c) => sheet.cells[row + r - 1]?.[column + c - 1] ?? "")); },
      getDisplayValues() { return this.getValues().map((entry) => entry.map(String)); },
      setValues(values) {
        values.forEach((entry, r) => entry.forEach((value, c) => {
          sheet.cells[row + r - 1] ||= [];
          sheet.cells[row + r - 1][column + c - 1] = value;
        }));
        return this;
      },
      setValue(value) { return this.setValues([[value]]); },
      clearContent() { return this.setValues([[""]]); },
      setFontWeight() { return this; },
      setBackground() { return this; },
      setFontColor() { return this; },
      setNumberFormat() { return this; },
      setDataValidation() { return this; },
      getDataValidations() { return Array.from({ length: rows }, () => Array(columns).fill(null)); },
      setDataValidations() { return this; },
      clearDataValidations() { return this; },
    };
  }
}

function backend() {
  const sheets = [
    new Sheet("Domains", [["Title", "Name"], ...domains.map((row) => [row.id, row.name])]),
    new Sheet("Teams", [["Title", "Label"], ...teams.map((row) => [row.id, row.label])]),
    new Sheet("Incident Config", [["Section"], ["Outage"]]),
  ];
  const book = {
    getId: () => "test-workbook",
    getSheets: () => sheets,
    getSheetByName: (name) => sheets.find((sheet) => sheet.name === name),
    insertSheet(name) { const sheet = new Sheet(name); sheets.push(sheet); return sheet; },
    setActiveSheet() {},
    moveActiveSheet() {},
  };
  const rule = { requireValueInRange() { return this; }, requireValueInList() { return this; }, setAllowInvalid() { return this; }, build() { return {}; } };
  const api = vm.createContext({
    SpreadsheetApp: { getActiveSpreadsheet: () => book, newDataValidation: () => rule, flush() {} },
    Utilities: { getUuid: () => `uuid-${++api.sequence}` },
    LockService: { getScriptLock: () => ({ waitLock() {}, releaseLock() {} }) },
    sequence: 0,
  });
  vm.runInContext(readFileSync(new URL("./google-apps-script/Code.gs", import.meta.url), "utf8"), api);
  return { api, book };
}

test("Apps Script setup is idempotent and CRUD never overwrites reference lists", () => {
  const { api, book } = backend();
  assert.equal(api.readOrg_().configured, false);
  api.setupProdEngOrgSheet();
  const sheet = book.getSheetByName("Prod Eng Org");
  assert.deepEqual(sheet.cells[0].slice(0, 9), ORG_HEADERS);
  const rolesBefore = JSON.stringify(api.readOrg_().roles);
  let result = api.saveOrgAssignment_(assignment({ id: "" }));
  const id = result.org.assignments[0].id;
  assert.equal(result.org.roles.length, DEFAULT_ORG_ROLES.length);
  assert.equal(result.org.organizations.length, 4);
  assert.equal(JSON.stringify(result.org.roles), rolesBefore);
  result = api.saveOrgAssignment_(assignment({ id, notes: "Updated" }));
  assert.equal(result.org.assignments[0].notes, "Updated");
  api.setupProdEngOrgSheet();
  assert.equal(api.readOrg_().assignments.length, 1);
  result = api.deleteOrgAssignment_({ id });
  assert.equal(result.org.assignments.length, 0);
  assert.equal(JSON.stringify(result.org.roles), rolesBefore);
  assert.throws(() => api.deleteOrgAssignment_({ id }), /no longer exists/);
});

test("Apps Script rejects invalid assignments and stores literal text", () => {
  const { api } = backend();
  api.setupProdEngOrgSheet();
  assert.throws(() => api.saveOrgAssignment_(assignment({ id: "", domain: "missing" })), /domain/);
  assert.throws(() => api.saveOrgAssignment_(assignment({ id: "", status: "Open" })), /Open positions/);
  const result = api.saveOrgAssignment_(assignment({ id: "", notes: "=not-a-formula" }));
  assert.equal(result.org.assignments[0].notes, "'=not-a-formula");
});

test("Apps Script manual blank-ID rows can be updated by content without row-index identity", () => {
  const { api, book } = backend();
  api.setupProdEngOrgSheet();
  const sheet = book.getSheetByName("Prod Eng Org");
  sheet.getRange(8, 1, 1, 9).setValues([ORG_FIELDS.map((field) => assignment({ id: "" })[field])]);
  const row = api.readOrg_().assignments[0];
  assert(row.id.startsWith("sheet:"));
  sheet.getRange(8, 1, 1, 9).setValues([Array(9).fill("")]);
  sheet.getRange(9, 1, 1, 9).setValues([ORG_FIELDS.map((field) => assignment({ id: "" })[field])]);
  const result = api.saveOrgAssignment_({ ...row, notes: "Edited" });
  assert.equal(result.org.assignments[0].id, "uuid-1");
  assert.equal(result.org.assignments[0].notes, "Edited");
});

test("Apps Script role and vendor edits persist in the same tab", () => {
  const { api } = backend();
  api.setupProdEngOrgSheet();
  assert.equal(api.saveOrgDefinition_({ name: "DevOps", category: "ENG Team members" }, true).org.roles.length, DEFAULT_ORG_ROLES.length + 1);
  assert.equal(api.saveOrgDefinition_({ name: "Example Partner", color: "#123456" }, false).org.organizations.length, 5);
  assert.throws(() => api.saveOrgDefinition_({ name: "Other", category: "Leader" }, true), /category/);
  const result = api.saveOrgDefinition_({ name: "Relias", color: "#ff0000" }, false);
  assert.equal(result.org.organizations.find((row) => row.name === "Relias").color, "#15803d");
});

test("Apps Script prevents domain/team deletions that would orphan organization assignments", () => {
  const { api } = backend();
  api.setupProdEngOrgSheet();
  api.saveOrgAssignment_(assignment({ id: "" }));
  assert.throws(() => api.deleteDomain_({ id: "wound-care" }), /Prod Eng Org assignments/);
  assert.throws(() => api.deleteTeam_({ teamId: "core" }), /Prod Eng Org assignments/);
});

test("Apps Script rejects ambiguous duplicate IDs rather than editing a random row", () => {
  const { api, book } = backend();
  api.setupProdEngOrgSheet();
  const sheet = book.getSheetByName("Prod Eng Org");
  sheet.getRange(2, 1, 2, 9).setValues([
    ORG_FIELDS.map((field) => assignment()[field]),
    ORG_FIELDS.map((field) => assignment({ domain: "freecme" })[field]),
  ]);
  assert.throws(() => api.saveOrgAssignment_(assignment()), /Duplicate assignment ID/);
  assert.throws(() => api.deleteOrgAssignment_({ id: "a1" }), /Duplicate assignment ID/);
});

test("organization-only domains honor sheet order without changing shared domains", () => {
  const { api, book } = backend();
  const original = JSON.stringify(book.getSheets().map((sheet) => ({ name: sheet.name, cells: sheet.cells })));
  api.setupProdEngOrgSheet();
  assert.equal(JSON.stringify(book.getSheets().filter((sheet) => sheet.name !== "Prod Eng Org").map((sheet) => ({ name: sheet.name, cells: sheet.cells }))), original);
  let result = api.saveOrgDomain_({ id: "freecme", name: "FreeCME", order: -1 });
  assert.equal(result.org.domains[0].id, "freecme");
  assert.equal(api.readDomains_()[0].id, "wound-care");
  const model = buildOrganization({ domains, teams, org: result.org });
  assert.equal(model.domains[0].id, "freecme");
  const sheet = book.getSheetByName("Prod Eng Org");
  sheet.getRange(2, 17, 1, 3).setValues([["", "", ""]]);
  api.setupProdEngOrgSheet();
  result = api.readOrg_();
  assert.equal(result.domains.length, 1);
  assert.equal(result.domains[0].id, "freecme");
  assert.equal(api.readDomains_().length, 2);
  assert.equal(JSON.stringify(book.getSheets().filter((entry) => entry.name !== "Prod Eng Org").map((entry) => ({ name: entry.name, cells: entry.cells }))), original);
});

test("empty organization domain list remains empty instead of falling back to original domains", () => {
  assert.equal(buildOrganization({ domains, teams, org: { ...org, domains: [] } }).domains.length, 0);
});

test("explicit UX None covers UX without fake people, vacancies, or team allocations", () => {
  const none = assignment({ role: "UX", status: "Not applicable", personName: "", personId: "", team: "", organization: "" });
  assert.equal(validateOrgAssignment(none, context), "");
  const model = buildOrganization({ domains, teams, org: { ...org, assignments: [none] } });
  assert.equal(model.people.length, 0);
  assert.equal(model.open.length, 0);
  assert.equal(model.filled.length, 0);
  assert.equal(model.notApplicable.length, 1);
  assert.equal(model.issues.length, 0);
  assert(!model.gaps.some((gap) => gap.domain.id === "wound-care" && gap.category === "UX"));
  for (const changes of [{ role: "PM" }, { personName: "None" }, { team: "core" }, { organization: "Relias" }]) {
    assert(validateOrgAssignment({ ...none, ...changes }, context));
  }
  const conflict = buildOrganization({ domains, teams, org: { ...org, assignments: [none, assignment({ id: "ux", role: "UX" })] } });
  assert.equal(conflict.issues.length, 2);
});

test("Apps Script persists UX None and rejects contradictory or invented identities", () => {
  const { api } = backend();
  api.setupProdEngOrgSheet();
  const none = assignment({ id: "", role: "UX", status: "Not applicable", personName: "", personId: "", team: "", organization: "" });
  const result = api.saveOrgAssignment_(none);
  assert.equal(result.org.assignments[0].status, "Not applicable");
  assert.equal(buildOrganization({ domains, teams, org: result.org }).notApplicable.length, 1);
  assert.throws(() => api.saveOrgAssignment_(assignment({ id: "", role: "UX" })), /explicit None/);
  assert.throws(() => api.saveOrgAssignment_({ ...none, domain: "freecme", personName: "None" }), /no person/);
  assert.throws(() => api.saveOrgAssignment_({ ...none, domain: "freecme", role: "Engineer" }), /only for UX/);
});

test("organization-only teams are authoritative and do not alter the roadmap Teams tab", () => {
  const { api, book } = backend();
  api.setupProdEngOrgSheet();
  const original = JSON.stringify(api.readTeams_());
  api.saveOrgTeam_({ id: "portals", label: "Portal Pioneers" });
  const result = api.saveOrgAssignment_(assignment({ id: "", team: "Portal Pioneers" }));
  assert.equal(result.org.assignments[0].team, "portals");
  assert.equal(buildOrganization({ domains, teams, org: result.org }).issues.length, 0);
  assert.equal(JSON.stringify(api.readTeams_()), original);
  api.setupProdEngOrgSheet();
  assert.equal(api.readOrg_().teams.length, 2);
  const sheet = book.getSheetByName("Prod Eng Org");
  sheet.getRange(2, 21, 2, 2).setValues([["", ""], ["", ""]]);
  api.setupProdEngOrgSheet();
  assert.equal(api.readOrg_().teams.length, 0);
  assert.equal(buildOrganization({ domains, teams, org: { ...org, teams: [] } }).teams.length, 0);
});

test("organization domain removal clears only its Q-S cells and rejects assigned domains", () => {
  const { api, book } = backend();
  api.setupProdEngOrgSheet();
  const originalDomains = JSON.stringify(api.readDomains_());
  api.saveOrgAssignment_(assignment({ id: "" }));
  assert.throws(() => api.deleteOrgDomain_({ id: "wound-care" }), /assignments first/);
  api.deleteOrgDomain_({ id: "freecme" });
  const sheet = book.getSheetByName("Prod Eng Org");
  assert.equal(sheet.cells[2][10], "PM");
  assert.equal(api.readOrg_().domains.length, 1);
  assert.equal(api.readOrg_().assignments.length, 1);
  assert.equal(JSON.stringify(api.readDomains_()), originalDomains);
  assert.throws(() => api.deleteOrgDomain_({ id: "freecme" }), /no longer exists/);
});

test("team member role includes non-engineering participants without relabeling their function", () => {
  const model = buildOrganization({ domains, teams, org: { ...org, assignments: [
    assignment({ role: "Team member" }), assignment({ id: "pm", role: "PM" }),
  ] } });
  assert.equal(model.people.length, 1);
  assert.equal(model.filled.filter((row) => row.category === "ENG Team members").length, 1);
  assert.equal(model.issues.length, 0);
});

export { backend, Sheet };

test("domain team badges list each team and helping partner once without Relias suffixes", () => {
  const rows = [
    { team: "goblins", teamName: "Job Goblins", organization: "Relias" },
    { team: "goblins", teamName: "Job Goblins", organization: "BrillMark" },
    { team: "goblins", teamName: "Job Goblins", organization: "BrillMark" },
  ];
  assert.deepEqual(orgTeamAndPartnerBadges(rows).map((item) => item.label), ["Job Goblins", "BrillMark"]);
  assert.equal(orgTeamAndPartnerBadges(rows)[0].kind, "team");
  assert.equal(orgTeamAndPartnerBadges(rows)[1].kind, "partner");
  assert.deepEqual(orgTeamAndPartnerBadges([
    { team: "BrillMark", organization: "BrillMark" },
    { team: "BrillMark", organization: "Relias" },
  ]), [{ kind: "team", label: "BrillMark", organization: "BrillMark" }]);
  assert.deepEqual(orgTeamAndPartnerBadges([{ team: "", organization: "Relias" }]), []);
});
