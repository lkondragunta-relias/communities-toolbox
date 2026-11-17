import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import { test } from "node:test";
import { validateMilestoneFields, validateMilestoneRequest, validateMilestoneData, validateMilestoneReceipt, isMilestoneDate } from "../src/config/milestoneConfig.js";
import { filterMilestones, formatMilestoneDate, groupMilestones, milestoneQuarter } from "../src/utils/milestoneUtils.js";
import { getDomainKeys } from "../src/utils/roadmapUtils.js";

const source = readFileSync(new URL("./google-apps-script/Code.gs", import.meta.url), "utf8");
const domains = [{ id: "recruiting", name: "Recruiting" }, { id: "mobile", name: "Mobile" }];
const body = (overrides = {}) => ({
  action: "addMilestone", adminToken: "test-only", requestId: randomUUID(), domainIds: ["recruiting", "mobile"],
  title: "Synthetic release", date: "2026-09-30", status: "Completed", impact: "Synthetic impact.",
  details: "", links: ["https://example.test/release"], ...overrides,
});

function backend() {
  const sheets = new Map(), props = new Map();
  let locked = false;
  const faults = {};
  function sheet(name, initial = []) {
    const rows = initial.map(row => [...row]);
    const entry = {
      rows, getName: () => name, getLastRow: () => rows.length,
      getLastColumn: () => Math.max(0, ...rows.map(row => row.length)),
      getMaxColumns: () => 26, insertColumnsAfter() {}, setFrozenRows() {},
      getRange(row, col, count = 1, width = 1) {
        const range = {
          getValues: () => Array.from({ length: count }, (_, r) => Array.from({ length: width }, (__, c) => rows[row - 1 + r]?.[col - 1 + c] ?? "")),
          setNumberFormat: () => range, setFontWeight: () => range,
          setValues(values) {
            assert.equal(locked, true);
            if (faults.beforeWrite) { delete faults.beforeWrite; throw new Error("Synthetic pre-write failure"); }
            values.forEach((value, r) => {
              rows[row - 1 + r] ??= [];
              value.forEach((cell, c) => { rows[row - 1 + r][col - 1 + c] = cell; });
            });
            if (faults.afterWrite) { delete faults.afterWrite; throw new Error("Synthetic lost write response"); }
            return range;
          },
        };
        return range;
      },
      deleteRow(row) { assert.equal(locked, true); rows.splice(row - 1, 1); },
    };
    sheets.set(name, entry);
    return entry;
  }
  sheet("Org Domains", [["ID", "Name"], ["wrong-source", "Wrong source"]]);
  sheet("Domains", [["Title", "Name"], ...domains.map(d => [d.id, d.name])]);
  sheet("Projects", [["Title", "Domain", "Name"], ["project-1", "recruiting", "Do not touch"]]);
  const spreadsheet = {
    getSheetByName: name => sheets.get(name), getSheets: () => [...sheets.values()],
    insertSheet: name => sheet(name), getSpreadsheetTimeZone: () => "America/Los_Angeles",
  };
  const properties = {
    getProperty: key => key === "ADMIN_TOKEN" ? "test-only" : props.get(key),
    getProperties: () => Object.fromEntries(props),
    setProperty(key, value) {
      assert.equal(locked, true);
      if (faults.receipt && JSON.parse(value).done) { delete faults.receipt; throw new Error("Synthetic receipt failure"); }
      props.set(key, value);
    },
  };
  const context = vm.createContext({
    console, Date, JSON,
    SpreadsheetApp: { getActiveSpreadsheet: () => spreadsheet, flush() {} },
    PropertiesService: { getScriptProperties: () => properties },
    LockService: { getScriptLock: () => ({
      waitLock() { if (faults.lock) throw new Error("busy"); assert.equal(locked, false); locked = true; },
      releaseLock() { assert.equal(locked, true); locked = false; },
    }) },
    Utilities: {
      getUuid: randomUUID, DigestAlgorithm: { SHA_256: "sha256" }, Charset: { UTF_8: "utf8" },
      computeDigest: (algorithm, value) => createHash(algorithm).update(value).digest(),
      base64Encode: value => Buffer.from(value).toString("base64"),
      formatDate: (date, timeZone) => new Intl.DateTimeFormat("sv-SE", { timeZone }).format(date),
    },
  });
  vm.runInContext(source, context);
  context.jsonResponse = value => JSON.parse(JSON.stringify(value));
  context.readOrg_ = () => ({ assignments: [] });
  const post = input => context.doPost({ postData: { contents: JSON.stringify(input) } });
  const setup = () => post({ action: "setupMilestones", adminToken: "test-only" });
  const read = () => context.doGet({ parameter: { action: "milestones" } });
  return { context, sheets, props, faults, post, setup, read };
}

test("Milestones is explicit, read-only before setup, canonical to roadmap Domains, and all writes require auth", () => {
  const { read, post, sheets, setup } = backend();
  assert.equal(read().milestones.configured, false);
  assert.deepEqual(read().domains, domains);
  assert.equal(sheets.has("Milestones"), false);
  for (const action of ["setupMilestones", "addMilestone", "updateMilestone", "deleteMilestone"]) {
    assert.equal(post(body({ action, adminToken: "" })).code, "AUTH");
    assert.equal(post(body({ action, adminToken: "wrong" })).code, "AUTH");
  }
  assert.equal(sheets.has("Milestones"), false);
  assert.equal(post(body()).code, "NOT_CONFIGURED");
  assert.equal(setup().ok, true);
  assert.equal(setup().ok, true);
  assert.equal(sheets.get("Milestones").rows.length, 1);
  assert.deepEqual([...sheets.keys()], ["Org Domains", "Domains", "Projects", "Milestones"]);
  assert.equal(read().milestones.configured, true);
  assert.deepEqual(read().milestones.items, []);
});

test("CRUD has stable server identities, verified receipts, idempotency, exact revisions and preserves other cells", () => {
  const { post, setup, read, sheets } = backend();
  setup();
  const request = body(), created = post(request);
  validateMilestoneReceipt(created, request);
  assert.deepEqual(post(request), created);
  const first = read().milestones.items[0];
  validateMilestoneData(read());
  assert.deepEqual(first.domainIds, ["mobile", "recruiting"]);
  assert.equal(first.date, "2026-09-30");
  assert.equal(sheets.get("Milestones").rows.length, 2);
  assert.equal(post({ ...request, title: "Changed input" }).ok, false);
  sheets.get("Milestones").rows[0].push("Owner notes");
  sheets.get("Milestones").rows[1].push("=preserve formula");
  const edit = body({ action: "updateMilestone", id: first.id, expectedUpdatedAt: first.updatedAt, title: "Synthetic update", domainIds: ["mobile"], status: "Planned" });
  const changed = post(edit);
  validateMilestoneReceipt(changed, edit);
  assert.ok(changed.updatedAt > first.updatedAt);
  assert.deepEqual(post(edit), changed);
  assert.deepEqual(post(request), created);
  assert.equal(post({ ...edit, requestId: randomUUID() }).code, "CONFLICT");
  assert.equal(sheets.get("Milestones").rows[1][10], "=preserve formula");
  const current = read().milestones.items[0];
  assert.equal(current.status, "Planned");
  assert.equal(current.createdAt, first.createdAt);
  const deletion = { action: "deleteMilestone", adminToken: "test-only", id: first.id, expectedUpdatedAt: current.updatedAt, requestId: randomUUID() };
  const deleted = post(deletion);
  validateMilestoneReceipt(deleted, deletion);
  assert.deepEqual(post(deletion), deleted);
  assert.deepEqual(post(request), created);
  assert.equal(read().milestones.items.length, 0);
  assert.equal(sheets.get("Projects").rows[1][2], "Do not touch");
});

test("uncertain writes keep their reserved identity, block competing edits, and recover before/after write or receipt failures", () => {
  for (const fault of ["beforeWrite", "afterWrite", "receipt"]) {
    const { post, setup, read, faults, sheets } = backend();
    setup();
    const create = body();
    faults[fault] = true;
    assert.equal(post(create).ok, false);
    const confirmed = post(create);
    assert.equal(confirmed.ok, true, fault);
    assert.equal(sheets.get("Milestones").rows.length, 2);
    const item = read().milestones.items[0];
    const edit = body({ action: "updateMilestone", id: item.id, expectedUpdatedAt: item.updatedAt, title: "Updated" });
    faults[fault] = true;
    assert.equal(post(edit).ok, false);
    assert.equal(post({ ...edit, requestId: randomUUID() }).code, "CONFLICT");
    assert.equal(post(edit).ok, true);
    const deletion = { action: "deleteMilestone", adminToken: "test-only", requestId: randomUUID(), id: item.id, expectedUpdatedAt: read().milestones.items[0].updatedAt };
    faults.receipt = true;
    assert.equal(post(deletion).ok, false);
    assert.equal(post(deletion).ok, true);
    assert.equal(read().milestones.items.length, 0);
  }
});

test("validation rejects unknown fields, invalid dates/status/domains/links and unsafe cells before mutation", () => {
  const { setup, sheets, post } = backend();
  setup();
  for (const invalid of [
    { domainIds: [] }, { domainIds: ["wrong-source"] }, { domainIds: ["mobile", "mobile"] }, { domainIds: "mobile" },
    { date: "2026-02-29" }, { date: "2026-04-31" }, { date: "2026-01-01T00:00:00Z" }, { date: "0000-01-01" },
    { title: " " }, { title: "x".repeat(161) }, { impact: "" }, { impact: "x".repeat(301) },
    { details: "x".repeat(5001) }, { details: " \n=IMPORTXML(...)" }, { title: "+SUM(1)" }, { impact: "x\u0000y" },
    { status: "Done" }, { status: "completed" }, { links: ["javascript:alert(1)"] }, { links: ["https://user:pass@example.test"] },
    { links: ["https://example.test/has space"] }, { links: ["http://example.test"] }, { links: "https://example.test" },
    { links: ["https://example..test"] }, { links: ["https://-example.test"] }, { links: ["https://example.test:99999"] },
    { links: ["https://example.test/" + "x".repeat(1000)] }, { requestId: "bad" },
    { id: `MS-${randomUUID()}` }, { createdAt: new Date().toISOString() }, { unexpected: "no" },
  ]) {
    const request = body(invalid);
    assert.throws(() => validateMilestoneRequest(request, domains), JSON.stringify(invalid));
    assert.equal(post(request).ok, false, JSON.stringify(invalid));
    assert.equal(sheets.get("Milestones").rows.length, 1);
  }
  assert.equal(post(body({ date: "2024-02-29", details: "Line one\nLine two" })).ok, true);
});

test("schema errors, duplicate IDs, storage capacity and lock contention fail explicitly without replacing data", () => {
  for (const kind of ["headers", "duplicate", "bad-row", "capacity", "lock"]) {
    const { setup, post, read, sheets, props, faults } = backend();
    setup();
    post(body());
    const sheet = sheets.get("Milestones");
    if (kind === "headers") sheet.rows[0][2] = "Wrong title";
    if (kind === "duplicate") sheet.rows.push([...sheet.rows[1]]);
    if (kind === "bad-row") sheet.rows[1][3] = "2026-02-30";
    if (kind === "capacity") props.set("unrelated", "x".repeat(160000));
    if (kind === "lock") faults.lock = true;
    const before = JSON.stringify(sheet.rows);
    const request = body(), result = post(request);
    assert.equal(result.ok, false, kind);
    if (kind === "capacity") {
      assert.equal(result.code, "CAPACITY");
      assert.equal(props.has(`MILESTONE_REQUEST_${request.requestId}`), false);
    }
    assert.equal(JSON.stringify(sheet.rows), before);
    if (kind === "headers") assert.equal(setup().ok, false);
    if (["headers", "duplicate", "bad-row"].includes(kind)) assert.ok(read().error);
  }
});

test("domain deletion refuses existing and pending associations, including across multi-domain rows", () => {
  const { post, setup, read, faults } = backend();
  setup();
  const created = post(body());
  for (const id of ["mobile", "recruiting"]) {
    assert.match(post({ action: "deleteDomain", adminToken: "test-only", id }).error, /milestones/);
  }
  const item = read().milestones.items[0];
  post({ action: "deleteMilestone", adminToken: "test-only", id: created.id, expectedUpdatedAt: item.updatedAt, requestId: randomUUID() });
  const pending = body({ domainIds: ["mobile"] });
  faults.beforeWrite = true;
  post(pending);
  assert.match(post({ action: "deleteDomain", adminToken: "test-only", id: "mobile" }).error, /pending/);
  assert.equal(post(pending).ok, true);
});

test("pending readback errors stay unconfirmed; native date cells use the workbook timezone without writes", () => {
  const { setup, post, sheets, read, faults } = backend();
  setup();
  const request = body({ date: "2026-03-31" });
  faults.receipt = true;
  assert.equal(post(request).ok, false);
  const row = sheets.get("Milestones").rows[1];
  row[2] = "=unexpected manual edit";
  assert.equal(post(request).code, "UNCONFIRMED");
  assert.equal(sheets.get("Milestones").rows.length, 2);
  row[2] = request.title;
  assert.equal(post(request).ok, true);
  row[3] = new Date("2026-04-01T04:30:00Z");
  const before = row.slice();
  assert.equal(read().milestones.items[0].date, "2026-03-31");
  assert.deepEqual(row, before);
});

test("completed create receipts remain replayable after deletion or workbook unavailability", () => {
  const { setup, post, read, context } = backend();
  setup();
  const request = body();
  const created = post(request);
  const item = read().milestones.items[0];
  assert.equal(post({ action: "deleteMilestone", adminToken: "test-only", id: item.id, expectedUpdatedAt: item.updatedAt, requestId: randomUUID() }).ok, true);
  for (const id of request.domainIds) assert.equal(post({ action: "deleteDomain", adminToken: "test-only", id }).ok, true);
  assert.deepEqual(post(request), created);
  assert.equal(read().milestones.items.length, 0);
  context.SpreadsheetApp.getActiveSpreadsheet = () => { throw new Error("Synthetic unavailable workbook"); };
  assert.deepEqual(post(request), created);
});

test("date-only grouping is timezone independent, shared milestones count once, and status is never inferred", () => {
  for (const value of ["2024-02-29", "2026-03-31", "2026-04-01", "2026-12-31"]) assert.equal(isMilestoneDate(value), true);
  for (const value of ["1900-02-29", "2026-02-29", "2026-13-01", "2026-00-01", "2026-01-00"]) assert.equal(isMilestoneDate(value), false);
  const items = [
    { id: "1", date: "2026-03-31", domainIds: ["mobile", "recruiting"], status: "Completed" },
    { id: "2", date: "2026-04-01", domainIds: ["mobile"], status: "Planned" },
    { id: "3", date: "2025-12-31", domainIds: ["recruiting"], status: "Completed" },
  ];
  assert.equal(milestoneQuarter(items[0].date), 1);
  assert.equal(milestoneQuarter(items[1].date), 2);
  assert.equal(formatMilestoneDate("2026-03-31", true), "March 31, 2026");
  assert.equal(filterMilestones(items, { year: "2026", quarter: "1", domainIds: ["mobile", "recruiting"] }).length, 1);
  assert.deepEqual(groupMilestones(items).map(group => group.key), ["2026-Q2", "2026-Q1", "2025-Q4"]);
  assert.equal(filterMilestones(items, { year: "all", quarter: "all", domainIds: [] })[1].status, "Planned");
  assert.deepEqual(getDomainKeys({ mobile: [], milestones: [] }), ["mobile"]);
});

test("read contracts and receipts distinguish missing APIs, malformed data and mismatched confirmations", () => {
  const { post, setup, read } = backend();
  setup();
  const request = body(), receipt = post(request);
  validateMilestoneData(read());
  assert.throws(() => validateMilestoneData({ projects: [] }), /not supported/);
  assert.throws(() => validateMilestoneData({ milestones: { version: 1, configured: false, items: [{}] }, domains }), /Invalid/);
  for (const invalid of [{ ok: false }, { id: "bad" }, { requestId: randomUUID() }, { updatedAt: "yesterday" }, { action: "updateMilestone" }, { deleted: true }]) {
    assert.throws(() => validateMilestoneReceipt({ ...receipt, ...invalid }, request));
  }
  assert.throws(() => validateMilestoneFields({ ...request, date: "not a date" }, domains));
});
