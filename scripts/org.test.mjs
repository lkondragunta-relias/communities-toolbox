import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";
import { DEFAULT_ORGANIZATIONS, DEFAULT_ORG_ROLES, ORG_FIELDS, ORG_HEADERS, assignmentActiveOn, assignmentKey, organizationColor, validOrgDate, validateOrgAssignment } from "../src/config/orgConfig.js";
import { buildOrganization, filterOrgRows, organizationDomainDetails, orgTeamAndPartnerBadges } from "../src/utils/orgUtils.js";
import { buildHash, parseHash } from "../src/hooks/useRoute.js";
import { orgCommandDate, parseOrgCommand, prepareOrgCommand, validateOrgCommandPreview } from "../src/utils/orgCommands.js";
import { chooseOrgConversation, matchOrgText, orgConversationTurn } from "../src/utils/orgConversation.js";
import { profileSnapshot, validGitHubUsername, validatePersonProfile } from "../src/utils/orgSkills.js";

const domains = [{ id: "wound-care", name: "Wound Care" }, { id: "freecme", name: "FreeCME" }];
const teams = [{ id: "core", label: "Core" }];
const org = { configured: true, assignments: [], roles: DEFAULT_ORG_ROLES, organizations: DEFAULT_ORGANIZATIONS };
const context = { ...org, domains, teams };
const assignment = (changes = {}) => ({
  id: "a1", domain: "wound-care", personId: "p1", personName: "Example Person",
  role: "Engineer", team: "core", organization: "Relias", status: "Assigned", notes: "", startDate: "", endDate: "", ...changes,
});

const commandModel = (entries = [assignment()], overrides = {}) => buildOrganization({
  domains, teams, org: { ...org, assignments: entries, ...overrides },
});
const commandPreview = (input, model = commandModel(), id) => prepareOrgCommand(parseOrgCommand(input), model, id);

const skillData = {
  skills: [{ id: "vue", name: "Vue" }, { id: "craft", name: "Craft CMS" }, { id: "ai", name: "AI" }],
  profiles: [{ personId: "p1", workFocus: "Frontend", githubUsername: "example-dev" }],
  personSkills: [{ personId: "p1", skillId: "vue" }, { personId: "p1", skillId: "craft" }, { personId: "p2", skillId: "vue" }],
};

test("skills use AND matching across assignments without duplicate people or implicit team matches", () => {
  const model = commandModel([
    assignment(), assignment({ id: "other-domain", domain: "freecme" }),
    assignment({ id: "other-person", personId: "p2", personName: "Second Person" }),
    assignment({ id: "open", personId: "", personName: "", status: "Open" }),
    assignment({ id: "team", personId: "", personName: "", role: "Team & Partners" }),
  ], skillData);
  assert.equal(model.people.length, 2);
  assert.deepEqual(model.people[0].skills.map((s) => s.id).sort(), ["craft", "vue"]);
  assert.equal(model.people[0].workFocus, "Frontend");
  assert.equal(model.people[0].githubUsername, "example-dev");
  assert.equal(filterOrgRows(model.filled, {}, model.personSkills).length, 4);
  assert.equal(filterOrgRows(model.filled, { skills: ["vue"] }, model.personSkills).length, 3);
  assert.equal(filterOrgRows(model.filled, { skills: ["vue", "craft"] }, model.personSkills).length, 2);
  assert.equal(filterOrgRows(model.filled, { skills: ["ai"] }, model.personSkills).length, 0);
  assert.equal(filterOrgRows(model.open, { skills: ["vue"] }, model.personSkills).length, 0);
  assert.equal(filterOrgRows(model.filled, { skills: ["craft"], domain: "freecme", role: "Engineer", organization: "Relias" }, model.personSkills).length, 1);
  assert.equal(model.skills.find((s) => s.id === "ai").name, "AI");
});

test("profile data is separate from date-scoped assignments, missing metadata and same-name people stay distinct", () => {
  const entries = [assignment({ endDate: "2026-11-01" }), assignment({ id: "a2", personId: "p2", organization: "BrillMark" })];
  const data = { domains, teams, org: { ...org, ...skillData, assignments: entries } };
  const full = buildOrganization(data);
  const scoped = buildOrganization(data, "2026-11-02");
  assert.equal(scoped.people.length, 1);
  assert.equal(full.people[0].githubUsername, "example-dev");
  assert.equal(scoped.people[0].githubUsername, "");
  assert.deepEqual(scoped.people[0].skillIds, ["vue"]);
  assert.deepEqual(commandModel().people[0].skills, []);
  assert.deepEqual(parseHash(buildHash("org", ["person", "person / ID", "all"])), { view: "org", params: ["person", "person / ID", "all"] });
});

test("invalid skill references and duplicate metadata are surfaced, not silently counted", () => {
  const model = commandModel([assignment()], {
    profiles: [{ personId: "missing", workFocus: "Expert", githubUsername: "https://github.com/foo" }],
    skills: [{ id: "one", name: "Vue" }, { id: "two", name: "vue" }],
    personSkills: [{ personId: "p1", skillId: "missing" }],
  });
  assert.equal(model.configurationIssues.length, 3);
  assert.equal(model.skills.length, 1);
  assert.equal(model.people[0].skills.length, 0);
  assert(validGitHubUsername("example-dev"));
  assert(!validGitHubUsername("bad--name"));
  assert(!validGitHubUsername("-bad"));
  assert(!validGitHubUsername("https://github.com/foo"));
  assert(validatePersonProfile({ personId: "p1", skillIds: ["missing"] }, { ...context, ...skillData, assignments: [assignment()] }));
});

function skillsBackend() {
  const env = backend();
  env.api.setupProdEngOrgSheet();
  env.api.saveOrgAssignment_(assignment({ id: "" }));
  env.api.saveOrgAssignment_(assignment({ id: "", personId: "p2", personName: "Second Person" }));
  return env;
}

test("metadata import is whitelisted, preserves assignment columns, and never overwrites existing skills", () => {
  const { api, book } = skillsBackend();
  const before = JSON.stringify(book.getSheetByName("Prod Eng Org").cells);
  const result = api.importOrgSkills_({ ...skillData, profiles: skillData.profiles.map((p) => ({ ...p, evidence: "private research", commits: [1] })) });
  assert.equal(result.org.skills.length, 3);
  assert.equal(result.org.profiles.length, 1);
  assert.equal(JSON.stringify(book.getSheetByName("Prod Eng Org").cells), before);
  assert(!JSON.stringify(result).includes("private research"));
  assert.deepEqual(Object.keys(result.org.profiles[0]).sort(), ["githubUsername", "personId", "workFocus"]);
  assert.throws(() => api.importOrgSkills_(skillData), /already exists/);
});

test("profile saves add replace and remove skill links, guard concurrent edits and preserve other people", () => {
  const { api } = skillsBackend();
  api.importOrgSkills_(skillData);
  const snapshot = () => JSON.parse(JSON.stringify(api.orgProfileSnapshot_(api.readOrg_(), "p1")));
  const original = snapshot();
  const result = api.saveOrgPersonProfile_({ personId: "p1", workFocus: "Full-stack", githubUsername: "example-dev", skillIds: ["ai"], expected: original });
  assert.equal(result.org.profiles[0].workFocus, "Full-stack");
  assert.equal(result.org.personSkills.filter((l) => l.personId === "p1").length, 1);
  assert.equal(result.org.personSkills.filter((l) => l.personId === "p2").length, 1);
  assert.equal(result.org.skills.length, 3);
  assert.throws(() => api.saveOrgPersonProfile_({ personId: "p1", skillIds: [], expected: original }), /changed/);
  api.saveOrgPersonProfile_({ personId: "p1", workFocus: "", githubUsername: "", skillIds: [], expected: snapshot() });
  assert.equal(api.readOrg_().personSkills.filter((l) => l.personId === "p1").length, 0);
  api.saveOrgPersonProfile_({ personId: "p2", workFocus: "Frontend", githubUsername: "", skillIds: ["vue"], expected: { workFocus: "", githubUsername: "", skillIds: ["vue"] } });
  assert.equal(api.readOrg_().profiles.length, 2);
  assert.throws(() => api.saveOrgPersonProfile_({ personId: "missing", skillIds: [] }), /existing Person ID/);
  assert.throws(() => api.saveOrgPersonProfile_({ personId: "p1", skillIds: ["missing"] }), /current catalog/);
});

test("catalog CRUD supports unused skills, stable renames, guarded deletion and case-insensitive names", () => {
  const { api } = skillsBackend();
  api.importOrgSkills_(skillData);
  const created = api.saveOrgSkill_({ name: "New capability" });
  assert(created.skillId);
  assert.equal(created.org.skills.length, 4);
  assert.throws(() => api.saveOrgSkill_({ name: "new CAPABILITY" }), /already exists/);
  assert.throws(() => api.saveOrgSkill_({ name: "=formula" }), /plain-text/);
  api.saveOrgSkill_({ id: "vue", name: "Vue.js", expectedName: "Vue" });
  assert.equal(api.readOrg_().personSkills.filter((l) => l.skillId === "vue").length, 2);
  assert.throws(() => api.saveOrgSkill_({ id: "vue", name: "Other", expectedName: "Vue" }), /changed/);
  assert.throws(() => api.deleteOrgSkill_({ id: "vue", expectedName: "Vue.js", expectedPersonIds: ["p1"] }), /assignments changed/);
  api.deleteOrgSkill_({ id: "vue", expectedName: "Vue.js", expectedPersonIds: ["p1", "p2"] });
  assert.equal(api.readOrg_().skills.length, 3);
  assert.equal(api.readOrg_().personSkills.length, 1);
  assert.equal(api.readOrg_().assignments.length, 2);
});

test("metadata headers may be reordered and invalid imports cannot create or overwrite rows", () => {
  const { api, book } = skillsBackend();
  assert.throws(() => api.importOrgSkills_({ ...skillData, personSkills: [{ personId: "missing", skillId: "vue" }] }), /existing Person IDs/);
  assert(!book.getSheetByName("Skills Catalog"));
  book.insertSheet("People Profiles").cells = [["GitHub Username", "Person ID", "Work Focus"]];
  book.insertSheet("Skills Catalog").cells = [["Skill Name", "Skill ID"]];
  book.insertSheet("Person Skills").cells = [["Skill ID", "Person ID"]];
  api.importOrgSkills_(skillData);
  assert.equal(api.readOrg_().profiles[0].githubUsername, "example-dev");
  api.saveOrgPersonProfile_({ personId: "p1", skillIds: ["ai"], expected: profileSnapshot({ ...skillData.profiles[0], skillIds: ["vue", "craft"] }) });
  assert.equal(api.readOrg_().personSkills.find((l) => l.personId === "p1").skillId, "ai");
});

test("removing the last assignment cleans only that person's metadata and leaves catalog options intact", () => {
  const { api } = skillsBackend();
  api.importOrgSkills_(skillData);
  const assignmentId = api.readOrg_().assignments.find((row) => row.personId === "p1").id;
  api.saveOrgAssignment_(assignment({ id: "", domain: "freecme" }));
  api.deleteOrgAssignment_({ id: assignmentId });
  assert.equal(api.readOrg_().profiles.length, 1);
  api.deleteOrgAssignment_({ id: api.readOrg_().assignments.find((row) => row.personId === "p1").id });
  assert.equal(api.readOrg_().profiles.length, 0);
  assert.equal(api.readOrg_().personSkills.length, 1);
  assert.equal(api.readOrg_().skills.length, 3);
});

test("domain homepages reuse scoped assignments without inventing ownership or hiding contacts", () => {
  const entries = [
    assignment({ role: "Eng leader", team: "" }),
    assignment({ id: "lead2", personId: "p2", personName: "Second Lead", role: "Eng leader", team: "" }),
    assignment({ id: "pm", personId: "p3", personName: "Product Person", role: "PM", team: "" }),
    assignment({ id: "dev", personId: "p4", personName: "Developer", notes: "Existing notes", endDate: "2026-11-05" }),
    assignment({ id: "allocation", personId: "", personName: "", role: "Team & Partners", organization: "BrillMark" }),
    assignment({ id: "none", personId: "", personName: "", role: "UX", team: "", organization: "", status: "Not applicable" }),
    assignment({ id: "open", personId: "", personName: "", role: "QA", team: "", status: "Open" }),
    assignment({ id: "elsewhere", domain: "freecme", personId: "p5", personName: "Elsewhere" }),
    assignment({ id: "invalid", personName: "", personId: "" }),
  ];
  const data = { domains, teams, org: { ...org, assignments: entries } };
  const details = organizationDomainDetails(buildOrganization(data, "2026-11-01"), "wound-care");
  assert.equal(details.peopleCount, 4);
  assert.equal(details.contacts[0].assignments.length, 2);
  assert.equal(details.contacts[1].assignments[0].team, "");
  assert.equal(details.contacts[2].notApplicable.length, 1);
  assert.equal(details.members[0].notes, "Existing notes");
  assert.deepEqual(details.teams, ["Core"]);
  assert.deepEqual(details.organizations, ["Relias", "BrillMark"]);
  assert.equal(details.allocations.length, 1);
  assert.equal(details.open.length, 1);
  assert.equal(details.issues.length, 1);
  assert.equal(organizationDomainDetails(buildOrganization(data, "2026-11-06"), "wound-care").members.length, 0);
  assert.equal(organizationDomainDetails(buildOrganization(data), "wound-care").members.length, 1);
  assert.equal(organizationDomainDetails(buildOrganization(data), "missing"), null);
  const empty = organizationDomainDetails(commandModel([]), "freecme");
  assert.equal(empty.peopleCount, 0);
  assert(empty.contacts.every((contact) => !contact.assignments.length && !contact.notApplicable.length));
});

test("domain URLs preserve encoded domain IDs and date scope through reload parsing", () => {
  for (const scope of ["2026-11-01", "all"]) {
    const hash = buildHash("org", ["domain / & name", scope]);
    assert.deepEqual(parseHash(hash), { view: "org", params: ["domain / & name", scope] });
  }
  assert.equal(buildHash("org"), "#/prod-eng-org");
});

test("person teams are optional across chat, model, and backend while allocations require them", () => {
  const { api } = backend();
  api.setupProdEngOrgSheet();
  for (const role of ["Eng leader", "PM", "Engineer", "QA", "Team member"]) {
    const row = assignment({ id: "", role, team: "" });
    assert.equal(validateOrgAssignment(row, context), "");
    const saved = api.saveOrgAssignment_(row);
    assert(saved.org.assignments.some((entry) => entry.role === role && entry.team === ""));
    assert.equal(commandPreview(`add Example Person as ${role} for FreeCME`).row.team, "");
  }
  assert.match(validateOrgAssignment(assignment({ role: "Team & Partners", personName: "", personId: "", team: "" }), context), /requires a team/);
  assert.throws(() => api.saveOrgAssignment_(assignment({ id: "", role: "Team & Partners", personName: "", personId: "", team: "" })), /require.*team/i);
  const model = commandModel();
  assert.equal(commandPreview("update Example Person: notes Keep team", model).row.team, "core");
  assert.equal(commandPreview("update Example Person: team blank", model).row.team, "");
  const question = orgConversationTurn("add Example Person for FreeCME as PM; team Unknown", null, model);
  assert.equal(question.field, "team");
  assert.equal(orgConversationTurn("skip", question, model).row.team, "");
});

test("conversation extracts names domains roles and dates in different orders", () => {
  const model = commandModel([assignment({ personName: "Janaky Nemmara", role: "PM", team: "" })]);
  const now = new Date(2032, 10, 1);
  for (const text of [
    "Please add Janaky for FreeCME, starting from October 12th",
    "FreeCME PM Janaky add starting October 12th",
    "starting October 12th, add Janaky PM FreeCME",
    "role: PM, domain: FreeCME, name: Janaky, add",
    "Janaky FreeCME please include PM",
  ]) {
    const result = orgConversationTurn(text, null, model, now);
    assert.equal(result.kind, "preview", `${text}: ${JSON.stringify(result)}`);
    assert.equal(result.row.personName, "Janaky Nemmara");
    assert.equal(result.row.domain, "freecme");
    assert.equal(result.row.role, "PM");
    assert.equal(result.row.endDate, "");
    if (/October/.test(text)) assert.equal(result.row.startDate, "2032-10-12");
  }
});

test("conversation confirms close spellings and retains the other supplied information", () => {
  const model = commandModel([assignment({ personName: "Janaky Nemmara", role: "PM", team: "", domain: "freecme" })]);
  let result = orgConversationTurn("add Janaky to Wond Care as PM; start October 12", null, model, new Date(2032, 10, 1));
  assert.equal(result.kind, "clarify");
  assert.equal(result.field, "domain");
  assert(result.options.some((option) => option.value === "wound-care"));
  result = chooseOrgConversation(result, "wound-care", model);
  assert.equal(result.kind, "preview");
  assert.equal(result.row.startDate, "2032-10-12");
  result = orgConversationTurn("add Janakyy Nemmara to Wound Care as PM", null, model);
  assert.equal(result.kind, "clarify");
  assert.equal(result.field, "target");
  result = chooseOrgConversation(result, "Janaky Nemmara", model);
  assert.equal(result.row.personId, "p1");
});

test("conversation gathers missing information over typed replies and does not reset dates", () => {
  const model = commandModel();
  let result = orgConversationTurn("add", null, model);
  assert.equal(result.field, "target");
  result = orgConversationTurn("Example", result, model);
  assert.equal(result.field, "domain");
  result = orgConversationTurn("FreeCME", result, model);
  assert.equal(result.kind, "preview");
  assert.equal(result.row.startDate, "");
  assert.equal(result.row.endDate, "");
  result = orgConversationTurn("Example Person FreeCME PM starting October 12", null, model, new Date(2032, 10, 1));
  assert.equal(result.field, "action");
  result = orgConversationTurn("add", result, model);
  assert.equal(result.row.startDate, "2032-10-12");
});

test("conversation keeps invalid date requests until corrected and validates overlapping entries", () => {
  const model = commandModel();
  let result = orgConversationTurn("FreeCME PM Example Person add starting February 30", null, model, new Date(2032, 10, 1));
  assert.equal(result.field, "startDate");
  result = orgConversationTurn("still wrong", result, model);
  assert.equal(result.field, "startDate");
  result = orgConversationTurn("October 12", result, model, new Date(2032, 10, 1));
  assert.equal(result.kind, "preview");
  assert.equal(result.row.startDate, "2032-10-12");
  result = orgConversationTurn("add Example Person to Wound Care as Engineer; team Core", null, model);
  assert.equal(result.field, "correction");
  result = orgConversationTurn("domain FreeCME", result, model);
  assert.equal(result.kind, "preview");
  assert.equal(result.row.domain, "freecme");
});

test("conversation confirms new identities without requiring a team", () => {
  const model = commandModel();
  let result = orgConversationTurn("add New Person to FreeCME as Engineer; start Oct 12", null, model, new Date(2032, 10, 1));
  assert.equal(result.field, "target");
  assert(result.options.some((option) => option.value === "new person: New Person"));
  result = chooseOrgConversation(result, "new person: New Person", model);
  assert.equal(result.field, "organization");
  result = orgConversationTurn("Relias", result, model);
  assert.equal(result.kind, "preview");
  assert.equal(result.row.personName, "New Person");
  assert.equal(result.row.startDate, "2032-10-12");
});

test("conversation supports assignment choice replies cancellation and uncertain matches", () => {
  const model = commandModel([assignment(), assignment({ id: "a2", domain: "freecme" })]);
  let result = orgConversationTurn("update Example Person: notes Ready", null, model);
  assert.equal(result.kind, "choose");
  result = orgConversationTurn("2", result, model);
  assert.equal(result.kind, "preview");
  assert.equal(result.row.id, "a2");
  assert.equal(orgConversationTurn("cancel", result, model).kind, "cancelled");
  const matched = matchOrgText("Wond Care", domains, ["id", "name"]);
  assert.equal(matched.exact, false);
  assert.equal(matched.matches[0].id, "wound-care");
  const names = [{ name: "Janaky Nemmara" }, { name: "Janaky Other" }];
  assert.equal(matchOrgText("Janaky", names, ["name"], true).matches.length, 2);
  assert.equal(matchOrgText("Janakyy", names, ["name"], true).exact, false);
  assert.equal(matchOrgText("Janakyy", names, ["name"], true).matches.length, 2);
});

test("conversation accepts extra details in a clarification reply and blocks destructive requests", () => {
  const model = commandModel();
  let result = orgConversationTurn("add Example Person", null, model);
  assert.equal(result.field, "domain");
  result = orgConversationTurn("FreeCME PM starting October 12", result, model, new Date(2032, 10, 1));
  assert.equal(result.kind, "preview");
  assert.equal(result.row.role, "PM");
  assert.equal(result.row.startDate, "2032-10-12");
  for (const text of ["update everyone to PM", "add Example Person and add Another Person", "do not add Example Person to FreeCME as PM"]) {
    assert.equal(orgConversationTurn(text, null, model).kind, "clarify");
  }
});

test("conversation suggests partial domain names and understands engineering leader synonyms", () => {
  const model = commandModel([assignment({ personName: "Mike Toothaker" })]);
  let result = orgConversationTurn("Please add Mike as Engineering leader along with me on FreeCME", null, model);
  assert.equal(result.kind, "preview");
  assert.equal(result.row.role, "Eng leader");
  assert.equal(result.row.personName, "Mike Toothaker");
  assert.equal(result.row.startDate, "");
  result = orgConversationTurn("add Mike as Engineering leader for Wound", null, model);
  assert.equal(result.field, "domain");
  assert(result.options.some((option) => option.value === "wound-care"));
  result = orgConversationTurn("Wound Care", result, model);
  assert.equal(result.kind, "preview");
  assert.equal(result.row.domain, "wound-care");
});

test("guided commands preview explicit assignment dates without mutating the directory", () => {
  const model = commandModel();
  const before = JSON.stringify(model);
  const preview = commandPreview("update Example Person in Wound Care: start 2026-12-15; end blank", model);
  assert.equal(preview.kind, "preview");
  assert.equal(preview.row.startDate, "2026-12-15");
  assert.equal(preview.row.endDate, "");
  assert.equal(preview.row.id, "a1");
  assert.equal(preview.row.personId, "p1");
  assert.deepEqual(preview.differences.map((item) => item.field), ["startDate"]);
  assert.equal(JSON.stringify(model), before);
  assert.equal(commandPreview("end Example Person in Wound Care on 2026-12-31").row.endDate, "2026-12-31");
});

test("guided commands accept configured references case-insensitively, IDs, and all editable fields", () => {
  const preview = commandPreview("UPDATE Example Person: domain FREECME; role pm; team blank; organization BrillMark; name New Person; status assigned; notes New work; start date: 2026-11-01; end date=2026-12-31");
  assert.equal(preview.row.domain, "freecme");
  assert.equal(preview.row.role, "PM");
  assert.equal(preview.row.organization, "BrillMark");
  assert.equal(preview.row.team, "");
  assert.equal(preview.row.personName, "New Person");
  assert.equal(preview.row.personId, "");
  assert.equal(preview.row.notes, "New work");
  assert.equal(commandPreview("update Example Person in wound-care: notes Changed").row.domain, "wound-care");
});

test("guided commands require selection across domains, repeated periods, and duplicate names", () => {
  const entries = [
    assignment({ endDate: "2026-11-30" }),
    assignment({ id: "a2", startDate: "2026-12-01" }),
    assignment({ id: "a3", domain: "freecme" }),
    assignment({ id: "a4", personId: "p2", organization: "BrillMark" }),
  ];
  const model = commandModel(entries);
  const command = "update Example Person: end 2026-12-31";
  assert.equal(commandPreview(command, model).candidates.length, 4);
  assert.equal(commandPreview("update Example in Wound Care: notes Later", model).candidates.length, 3);
  assert.throws(() => commandPreview(command, model, "a2"), /already exists/);
  const preview = commandPreview("update Example Person: start 2026-12-01; end 2026-12-31", model, "a2");
  assert.equal(preview.row.id, "a2");
  assert.equal(preview.row.startDate, "2026-12-01");
  assert.throws(() => commandPreview(command, model, "missing"), /no longer uniquely/);
});

test("guided commands search historical rows even when no people are active", () => {
  const model = buildOrganization({ domains, teams, org: { ...org, assignments: [assignment({ endDate: "2026-01-01" })] } }, "2026-12-15");
  assert.equal(model.people.length, 0);
  const preview = commandPreview("update Example Person: notes Historical", model);
  assert.equal(preview.row.endDate, "");
});

test("guided commands default every omitted date to blank on adds and updates", () => {
  const model = commandModel([assignment({ startDate: "2026-11-01", endDate: "2026-11-30" })]);
  const cleared = commandPreview("update Example Person: notes Undated", model);
  assert.equal(cleared.row.startDate, "");
  assert.equal(cleared.row.endDate, "");
  assert.deepEqual(cleared.differences.map((item) => item.field), ["notes", "startDate", "endDate"]);
  const startOnly = commandPreview("update Example Person: start 2026-12-15", model);
  assert.equal(startOnly.row.startDate, "2026-12-15");
  assert.equal(startOnly.row.endDate, "");
  const endOnly = commandPreview("end Example Person on 2026-12-31", model);
  assert.equal(endOnly.row.startDate, "");
  assert.equal(endOnly.row.endDate, "2026-12-31");
  const added = commandPreview("add Example Person as PM for FreeCME", model);
  assert.equal(added.row.startDate, "");
  assert.equal(added.row.endDate, "");
});

test("guided commands reject unknown and ambiguous references instead of inventing them", () => {
  for (const clause of ["domain Unknown", "team Unknown", "role Unknown", "organization Unknown", "status Unknown"]) {
    assert.throws(() => commandPreview(`update Example Person: ${clause}`), /was not found/);
  }
  const model = commandModel([], { roles: [...DEFAULT_ORG_ROLES, { name: "pm", category: "PM" }] });
  assert.throws(() => commandPreview("assign New Person to Wound Care as PM; organization Relias", model), /ambiguous/);
  assert.throws(() => commandPreview("update Missing Person: end 2026-12-31"), /No matching/);
});

test("guided commands add one person assignment with explicit role and team", () => {
  const preview = commandPreview("assign New Person to FreeCME as Engineer; organization Relias; team Core; start 2026-12-15");
  assert.equal(preview.before, null);
  assert.equal(preview.row.id, "");
  assert.equal(preview.row.personId, "");
  assert.equal(preview.row.domain, "freecme");
  assert.equal(preview.row.team, "core");
  assert.equal(preview.row.startDate, "2026-12-15");
  assert.equal(preview.row.status, "Assigned");
  const known = commandPreview("assign Example Person to FreeCME as PM");
  assert.equal(known.row.organization, "Relias");
  assert.equal(known.row.personId, "p1");
  assert.equal(commandPreview("assign New Person to FreeCME as PM").field, "organization");
  assert.equal(commandPreview("assign New Person to FreeCME as Engineer; organization Relias").row.team, "");
});

test("guided commands accept add person as role for domain and resolve unique short names", () => {
  const model = commandModel([assignment({ personName: "Kamal Bisht" })]);
  const preview = commandPreview("add Kamal as PM for FreeCME", model);
  assert.equal(preview.row.personName, "Kamal Bisht");
  assert.equal(preview.row.personId, "p1");
  assert.equal(preview.row.role, "PM");
  assert.equal(preview.row.domain, "freecme");
  assert.throws(() => commandPreview("add Kamal as PM for FreeCME", commandModel([
    assignment({ personName: "Kamal Bisht" }),
    assignment({ id: "a2", personId: "p2", personName: "Kamal Other", domain: "freecme" }),
  ])), /Several people/);
});

test("guided commands preserve identity on updates but do not rename other rows", () => {
  const model = commandModel([assignment(), assignment({ id: "a2", domain: "freecme" })]);
  const renamed = commandPreview("update Example Person in Wound Care: name Another Person", model);
  assert.equal(renamed.row.personId, "");
  assert.equal(model.assignments[1].personName, "Example Person");
  const reused = commandPreview("update Example Person in Wound Care: name Existing Person", commandModel([
    assignment(), assignment({ id: "a2", personId: "p2", personName: "Existing Person", domain: "freecme" }),
  ]));
  assert.equal(reused.row.personId, "p2");
});

test("guided commands do not merge different identities with identical names", () => {
  const model = commandModel([
    assignment({ endDate: "2026-11-30" }),
    assignment({ id: "a2", personId: "p2", startDate: "2026-12-01" }),
  ]);
  const changed = commandPreview("update Example Person: notes Correct person; start 2026-12-01", model, "a2");
  assert.equal(changed.row.personId, "p2");
  assert.throws(() => commandPreview("assign Example Person to FreeCME as PM", model), /Several people/);
});

test("guided commands support selecting team allocations, open roles, and explicit UX None", () => {
  const model = commandModel([
    assignment({ role: "Team & Partners", personId: "", personName: "" }),
    assignment({ id: "a2", role: "PM", personId: "", personName: "", status: "Open" }),
    assignment({ id: "a3", role: "UX", personId: "", personName: "", status: "Not applicable", team: "", organization: "" }),
  ]);
  assert.equal(commandPreview("update team allocation in Wound Care: end 2026-12-31", model).row.id, "a1");
  assert.equal(commandPreview("update open PM in Wound Care: notes Recruiting", model).row.id, "a2");
  assert.equal(commandPreview("update UX None in Wound Care: start 2026-12-01", model).row.id, "a3");
  assert.equal(commandPreview("update assignment a2: notes Hiring", model).row.id, "a2");
  assert.throws(() => commandPreview("update Example Person: status Open"), /must not contain a person/);
  assert.equal(commandPreview("update Example Person: status Open; name blank").row.personId, "");
});

test("guided commands strictly validate dates, periods, overlapping assignments, and no-op changes", () => {
  for (const date of ["2026-02-29", "next winter", "12/10/2026", "December 32"]) {
    assert.throws(() => commandPreview(`update Example Person: start ${date}`), /valid calendar|couldn't read|could mean/);
  }
  assert.throws(() => commandPreview("update Example Person: start 2026-12-31; end 2026-12-15"), /on or after/);
  assert.throws(() => commandPreview("update Example Person: role Engineer"), /Nothing needs saving/);
  assert.throws(() => commandPreview("assign Example Person to Wound Care as Engineer; team Core"), /already exists/);
});

test("conversational dates normalize named months and current-year dates without locale guessing", () => {
  const now = new Date(2032, 10, 1);
  for (const value of ["October 12th", "12 October", "Oct. 12", "12th Oct", "October 12, 2032", "2032-10-12"]) assert.equal(orgCommandDate(value, now), "2032-10-12");
  assert.equal(orgCommandDate("12/15", now), "2032-12-15");
  assert.equal(orgCommandDate("15/12/2033", now), "2033-12-15");
  assert.equal(orgCommandDate("Feb 29", now), "2032-02-29");
  assert.equal(orgCommandDate("January 1st", new Date(2033, 11, 31)), "2033-01-01");
  assert.equal(orgCommandDate("Sept 5th 2034", now), "2034-09-05");
  assert.equal(orgCommandDate("null", now), "");
  for (const value of ["02/03", "2032-13-01", "October 0", "February 29 2033", "October 12 32", "later", "Foo 12"]) assert.throws(() => orgCommandDate(value, now));
});

test("the conversational add example infers one known role and previews the current year", () => {
  const model = commandModel([assignment({ personName: "Janaky Nemmara", role: "PM", team: "" })]);
  const command = parseOrgCommand("Can you please add Janaky for FreeCME, starting from October 12th", new Date(2032, 10, 1));
  assert.equal(command.changes.startDate, "2032-10-12");
  const preview = prepareOrgCommand(command, model);
  assert.equal(preview.kind, "preview");
  assert.equal(preview.row.personName, "Janaky Nemmara");
  assert.equal(preview.row.role, "PM");
  assert.equal(preview.row.organization, "Relias");
  assert.equal(preview.row.startDate, "2032-10-12");
  assert.equal(preview.row.endDate, "");
});

test("conversational commands support polite wording, flexible separators, and natural date boundaries", () => {
  const now = new Date(2032, 10, 1);
  for (const input of [
    "Please add Example Person as PM for FreeCME, starting from October 12th and ending on December 31.",
    "Could you assign Example Person to FreeCME as PM starting from October 12th, end date December 31",
    "add Example Person to FreeCME as PM\nstart October 12\nend December 31",
    "add Example Person for FreeCME; role PM; start 12 October; end 31 December",
    "add Example Person for FreeCME as PM starting October 12th ending December 31st",
  ]) {
    const parsed = parseOrgCommand(input, now);
    const preview = prepareOrgCommand(parsed, commandModel());
    assert.equal(preview.row.role, "PM");
    assert.equal(preview.row.startDate, "2032-10-12");
    assert.equal(preview.row.endDate, "2032-12-31");
  }
  for (const input of [
    "Please update Example Person in Wound Care, start date to October 12th and end date to December 31",
    "edit Example Person for Wound Care, starting from Oct 12, ending on Dec 31",
    "update Example Person in Wound Care: start October 12 and end December 31",
  ]) {
    const preview = prepareOrgCommand(parseOrgCommand(input, now), commandModel());
    assert.equal(preview.row.startDate, "2032-10-12");
    assert.equal(preview.row.endDate, "2032-12-31");
  }
  assert.equal(parseOrgCommand("Set Example Person's end date to December 31", now).changes.endDate, "2032-12-31");
  assert.equal(parseOrgCommand("Please end Example Person for Wound Care on Oct 12th 2034", now).changes.endDate, "2034-10-12");
  assert.equal(parseOrgCommand('update Example Person: notes "Discuss start date and team changes"', now).changes.notes, "Discuss start date and team changes");
});

test("missing roles prompt for a choice instead of inventing a responsibility", () => {
  const model = commandModel([assignment(), assignment({ id: "a2", role: "PM", domain: "freecme", team: "" })]);
  const command = parseOrgCommand("Please add Example Person for FreeCME, starting from October 12");
  const result = prepareOrgCommand(command, model);
  assert.equal(result.kind, "clarify");
  assert.equal(result.field, "role");
  assert(result.options.includes("PM"));
  assert(!result.options.includes("Team & Partners"));
  const resolved = prepareOrgCommand({ ...command, changes: { ...command.changes, role: "UX" } }, model);
  assert.equal(resolved.kind, "preview");
  assert.equal(resolved.row.role, "UX");
  assert.equal(orgConversationTurn("please delete Example Person", null, model).field, "domain");
});

test("conversation removes exactly one role assignment with stale-preview checks", () => {
  const model = commandModel([assignment({ role: "Eng leader", team: "" }), assignment({ id: "a2", role: "PM", team: "" }), assignment({ id: "a3", domain: "freecme" })]);
  const result = orgConversationTurn("remove Example Person from Eng leader on Wound Care", null, model);
  assert.equal(result.kind, "preview");
  assert.equal(result.action, "remove");
  assert.equal(result.row.id, "a1");
  assert.equal(validateOrgCommandPreview(result, model).id, "a1");
  assert.throws(() => validateOrgCommandPreview(result, commandModel([assignment({ role: "Eng leader", notes: "Changed", team: "" })])), /changed after/);
  const ambiguous = orgConversationTurn("delete Example Person from Wound Care", null, model);
  assert.equal(ambiguous.kind, "choose");
  assert.equal(ambiguous.candidates.length, 2);
  const chosen = orgConversationTurn("2", ambiguous, model);
  assert.equal(chosen.row.id, "a2");
  assert.equal(chosen.action, "remove");
  const missingDomain = orgConversationTurn("remove Example Person", null, model);
  assert.equal(missingDomain.field, "domain");
  assert.equal(orgConversationTurn("FreeCME", missingDomain, model).row.id, "a3");
  assert.equal(orgConversationTurn("remove everyone from Wound Care", null, model).kind, "clarify");
  assert.equal(orgConversationTurn("cancel", result, model).kind, "cancelled");
});

test("incomplete new-person requests clarify organization and role without requiring team", () => {
  let command = parseOrgCommand("Please add New Person for FreeCME, starting from October 12", new Date(2032, 10, 1));
  const model = commandModel();
  for (const [field, value] of [["organization", "Relias"], ["role", "Engineer"]]) {
    const result = prepareOrgCommand(command, model);
    assert.equal(result.kind, "clarify");
    assert.equal(result.field, field);
    assert(result.options.includes(value));
    command = { ...command, changes: { ...command.changes, [field]: value } };
  }
  const preview = prepareOrgCommand(command, model);
  assert.equal(preview.row.startDate, "2032-10-12");
  assert.equal(preview.row.endDate, "");
  assert.equal(preview.row.personName, "New Person");
  assert.equal(preview.row.team, "");
  assert.throws(() => prepareOrgCommand(parseOrgCommand("add New Person for FreeCME"), commandModel([], { organizations: [] })), /No organization options/);
});

test("guided command previews detect changed or removed assignments before save", () => {
  const preview = commandPreview("update Example Person: end 2026-12-31");
  assert.equal(validateOrgCommandPreview(preview, commandModel()).endDate, "2026-12-31");
  assert.throws(() => validateOrgCommandPreview(preview, commandModel([assignment({ notes: "Changed elsewhere" })])), /changed after your preview/);
  assert.throws(() => validateOrgCommandPreview(preview, commandModel([])), /changed after your preview/);
  assert.throws(() => validateOrgCommandPreview(preview, commandModel([assignment(), assignment()])), /changed after your preview/);
  assert.throws(() => validateOrgCommandPreview(preview, commandModel([assignment()], { roles: [] })), /configured role/);
  const added = commandPreview("assign New Person to FreeCME as PM; organization Relias");
  assert.throws(() => validateOrgCommandPreview(added, commandModel([assignment({ id: "a2", domain: "freecme", role: "PM", team: "", personId: "p2", personName: "New Person" })])), /already exists/);
});

test("guided commands preserve quoted notes and reject unparsed instructions", () => {
  assert.equal(commandPreview('update Example Person: notes "Contains; a semicolon"; end blank').row.notes, "Contains; a semicolon");
  for (const input of [
    "", "delete Example Person", "update Example Person: unknown value", "update Example Person: id a2",
    "update Example Person: start blank; start date 2026-12-15", "update Example Person: notes Hello;",
    'update Example Person: notes "Unclosed', "assign New Person to FreeCME as PM; role UX",
    "end Example Person on 2026-12-31; notes ignored", "x".repeat(2001),
  ]) assert.throws(() => parseOrgCommand(input));
});

test("assignment dates have inclusive boundaries and independent open limits", () => {
  for (const date of ["2020-01-01", "2026-12-15", "2030-01-01"]) assert(assignmentActiveOn(assignment(), date));
  const period = assignment({ startDate: "2026-11-01", endDate: "2026-11-30" });
  assert(!assignmentActiveOn(period, "2026-10-31"));
  assert(assignmentActiveOn(period, "2026-11-01"));
  assert(assignmentActiveOn(period, "2026-11-30"));
  assert(!assignmentActiveOn(period, "2026-12-15"));
  assert(assignmentActiveOn(assignment({ startDate: "2026-12-15" }), "2030-01-01"));
  assert(!assignmentActiveOn(assignment({ startDate: "2026-12-15" }), "2026-12-14"));
  assert(assignmentActiveOn(assignment({ endDate: "2026-11-30" }), "2020-01-01"));
});

test("invalid dates and reversed periods are rejected in client and Apps Script", () => {
  const { api } = backend();
  api.setupProdEngOrgSheet();
  for (const value of ["2026-02-29", "2026-13-01", "2026-04-31", "0000-01-01", "11/30/2026", "2026-1-01"]) {
    assert.equal(validOrgDate(value), false);
    assert.match(validateOrgAssignment(assignment({ startDate: value }), context), /valid dates/);
    assert.throws(() => api.saveOrgAssignment_(assignment({ id: "", endDate: value })), /valid dates/);
  }
  assert(validOrgDate("2028-02-29"));
  const reversed = assignment({ startDate: "2026-12-01", endDate: "2026-11-30" });
  assert.match(validateOrgAssignment(reversed, context), /on or after/);
  assert.throws(() => api.saveOrgAssignment_({ ...reversed, id: "" }), /on or after/);
});

test("snapshots apply to every role, partners, people, vacancies, and gaps", () => {
  const entries = DEFAULT_ORG_ROLES.map((role, index) => assignment({
    id: `role-${index}`, role: role.name, personId: `person-${index}`,
    personName: `Person ${index}`, startDate: "2026-11-01", endDate: "2026-11-30",
    ...(role.category === "Team & Partners" ? { personId: "", personName: "", organization: "BrillMark" } : {}),
  }));
  entries.push(assignment({ id: "open", personId: "", personName: "", status: "Open", startDate: "2026-12-01" }));
  const data = { domains, teams, org: { ...org, assignments: entries } };
  const november = buildOrganization(data, "2026-11-30");
  assert.equal(november.filled.length, 7);
  assert.equal(november.people.length, 6);
  assert.equal(november.open.length, 0);
  assert.equal(november.gaps.length, 5);
  const december = buildOrganization(data, "2026-12-15");
  assert.equal(december.filled.length, 0);
  assert.equal(december.people.length, 0);
  assert.equal(december.open.length, 1);
  assert.equal(december.gaps.length, 10);
  assert.equal(december.assignments.length, 8);
  assert.equal(buildOrganization(data).filled.length, 7);
  assert.throws(() => buildOrganization(data, "invalid"), /snapshot date/);
});

test("separate periods preserve identity while overlapping assignments are rejected", () => {
  const first = assignment({ endDate: "2026-11-30" });
  const next = assignment({ id: "a2", startDate: "2026-12-01" });
  assert.equal(validateOrgAssignment(next, { ...context, assignments: [first] }), "");
  assert.match(validateOrgAssignment({ ...next, startDate: "2026-11-30" }, { ...context, assignments: [first] }), /already exists/);
  const data = { domains, teams, org: { ...org, assignments: [first, next] } };
  assert.equal(buildOrganization(data).people.length, 1);
  assert.equal(buildOrganization(data, "2026-12-15").people[0].assignments[0].id, "a2");
  const { api } = backend();
  api.setupProdEngOrgSheet();
  api.saveOrgAssignment_({ ...first, id: "" });
  api.saveOrgAssignment_({ ...next, id: "" });
  assert.throws(() => api.saveOrgAssignment_(assignment({ id: "", startDate: "2026-11-30" })), /already exists/);
});

test("UX None can transition to dated UX without contradictory coverage", () => {
  const none = assignment({ role: "UX", status: "Not applicable", personId: "", personName: "", team: "", organization: "", endDate: "2026-11-30" });
  const ux = assignment({ id: "a2", role: "UX", startDate: "2026-12-01" });
  const data = { domains, teams, org: { ...org, assignments: [none, ux] } };
  assert.equal(buildOrganization(data).issues.length, 0);
  assert.equal(buildOrganization(data, "2026-11-30").notApplicable.length, 1);
  assert.equal(buildOrganization(data, "2026-12-15").notApplicable.length, 0);
  const { api } = backend();
  api.setupProdEngOrgSheet();
  api.saveOrgAssignment_({ ...none, id: "" });
  const saved = api.saveOrgAssignment_({ ...ux, id: "" }).org.assignments.find((row) => row.status === "Assigned");
  assert.throws(() => api.saveOrgAssignment_({ ...saved, startDate: "2026-11-30" }), /explicit None/);
});

test("date upgrade and CRUD preserve reference columns, legacy keys, and old-client dates", () => {
  const { api, book } = backend();
  api.setupProdEngOrgSheet();
  const sheet = book.getSheetByName("Prod Eng Org");
  sheet.cells[0] = sheet.cells[0].slice(0, 22);
  const original = assignment({ id: "" });
  sheet.getRange(2, 1, 1, 9).setValues([ORG_FIELDS.slice(0, 9).map((key) => original[key])]);
  const before = JSON.stringify(sheet.cells.map((row) => row.slice(0, 22)));
  const legacyId = api.readOrg_().assignments[0].id;
  assert.equal(legacyId, assignmentKey(original));
  assert.equal(api.readOrg_().assignmentDatesSupported, true);
  const result = api.saveOrgAssignment_({ ...original, id: legacyId, startDate: "2026-11-01", endDate: "2026-11-30" });
  assert.deepEqual(sheet.cells[0].slice(22, 24), ["Start Date", "End Date"]);
  const unchanged = sheet.cells.map((row) => row.slice(0, 22));
  unchanged[1][0] = "";
  assert.equal(JSON.stringify(unchanged), before);
  const saved = result.org.assignments[0];
  assert.equal(saved.startDate, "2026-11-01");
  assert.equal(saved.endDate, "2026-11-30");
  const oldClient = { ...saved, notes: "Updated by an older client" };
  delete oldClient.startDate;
  delete oldClient.endDate;
  assert.equal(api.saveOrgAssignment_(oldClient).org.assignments[0].endDate, "2026-11-30");
  const references = JSON.stringify(sheet.cells.map((row) => row.slice(10, 22)));
  api.deleteOrgAssignment_({ id: saved.id });
  assert.equal(sheet.cells[1][22], "");
  assert.equal(sheet.cells[1][23], "");
  assert.equal(JSON.stringify(sheet.cells.map((row) => row.slice(10, 22))), references);
});

test("Save appends missing date columns safely and does not migrate on invalid input", () => {
  const { api, book } = backend();
  api.setupProdEngOrgSheet();
  const sheet = book.getSheetByName("Prod Eng Org");
  sheet.cells[0] = sheet.cells[0].slice(0, 22).concat(["Custom field"]);
  sheet.getRange(2, 23).setValue("Keep this");
  const before = JSON.stringify(sheet.cells);
  assert.throws(() => api.saveOrgAssignment_(assignment({ id: "", startDate: "2026-02-30" })), /valid dates/);
  assert.equal(JSON.stringify(sheet.cells), before);
  api.saveOrgAssignment_(assignment({ id: "", startDate: "2026-12-01" }));
  assert.equal(sheet.cells[1][22], "Keep this");
  assert.deepEqual(sheet.cells[0].slice(22), ["Custom field", "Start Date", "End Date"]);
  assert.equal(sheet.cells[1][23], "2026-12-01");
  const count = sheet.getLastColumn();
  const saved = api.readOrg_().assignments[0];
  api.saveOrgAssignment_({ ...saved, endDate: "2026-12-31" });
  assert.equal(sheet.getLastColumn(), count);
  assert.equal(api.readOrg_().assignments[0].endDate, "2026-12-31");
});

test("native spreadsheet dates use the workbook timezone rather than display formatting", () => {
  const { api, book } = backend();
  api.setupProdEngOrgSheet();
  api.saveOrgAssignment_(assignment({ id: "" }));
  book.getSpreadsheetTimeZone = () => "America/New_York";
  api.Utilities.formatDate = (date, zone, format) => {
    assert.equal(zone, "America/New_York");
    assert.equal(format, "yyyy-MM-dd");
    return new Intl.DateTimeFormat("en-CA", { timeZone: zone, year: "numeric", month: "2-digit", day: "2-digit" }).format(date);
  };
  const sheet = book.getSheetByName("Prod Eng Org");
  sheet.getRange(2, 23).setValue(vm.runInContext('new Date("2026-12-01T02:00:00Z")', api));
  assert.equal(api.readOrg_().assignments[0].startDate, "2026-11-30");
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
  for (const changes of [{ domain: "missing" }, { role: "missing" }, { organization: "" }, { status: "Open" }]) {
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
      getValue() { return this.getValues()[0][0]; },
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
  sheet.getRange(8, 1, 1, 9).setValues([ORG_FIELDS.slice(0, 9).map((field) => assignment({ id: "" })[field])]);
  const row = api.readOrg_().assignments[0];
  assert(row.id.startsWith("sheet:"));
  sheet.getRange(8, 1, 1, 9).setValues([Array(9).fill("")]);
  sheet.getRange(9, 1, 1, 9).setValues([ORG_FIELDS.slice(0, 9).map((field) => assignment({ id: "" })[field])]);
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
