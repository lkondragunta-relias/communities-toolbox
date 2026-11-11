import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import { after, before, test } from "node:test";
import { chromium } from "playwright";
import { createServer } from "vite";

const source = readFileSync(new URL("./google-apps-script/Code.gs", import.meta.url), "utf8");
const headers = ["Title", "Domain", "Name", "Description", "TimelineStart", "TimelineEnd",
  "Status", "Priority", "Owner", "Teams", "Link", "Progress", "Confidence"];
const input = (extra = {}) => ({
  action: "add", adminToken: "test", team: "nurse-enablement", name: "Test",
  timelineStart: "2026-01-01", timelineEnd: "2026-12-31", ...extra,
});

function backend(initial = []) {
  const rows = [headers.slice(), ...initial.map((row) => row.slice())];
  let locked = false;
  let flushed = 0;
  const sheet = {
    rows,
    getName: () => "Projects",
    getLastRow: () => rows.length,
    getLastColumn: () => rows[0].length,
    getRange: (row, col, count = 1, width = 1) => ({
      getValues: () => Array.from({ length: count }, (_, i) =>
        Array.from({ length: width }, (_, j) => rows[row - 1 + i]?.[col - 1 + j] ?? "")),
      setValues: (values) => {
        assert.equal(locked, true);
        for (let i = 0; i < values.length; i++) {
          rows[row - 1 + i] ??= [];
          values[i].forEach((value, j) => { rows[row - 1 + i][col - 1 + j] = value; });
        }
      },
    }),
    appendRow: (values) => { assert.equal(locked, true); rows.push([...values]); },
  };
  const domainRows = [["Title", "Name"], ["ne", "Nurse Enablement"]];
  const domainSheet = {
    getName: () => "Domains",
    getLastRow: () => domainRows.length,
    getLastColumn: () => domainRows[0].length,
    getRange: (row, col, count = 1, width = 1) => ({
      getValues: () => Array.from({ length: count }, (_, i) =>
        Array.from({ length: width }, (_, j) => domainRows[row - 1 + i]?.[col - 1 + j] ?? "")),
    }),
  };
  const api = vm.createContext({
    LockService: { getScriptLock: () => ({
      waitLock: () => { assert.equal(locked, false); locked = true; },
      releaseLock: () => { assert.equal(locked, true); locked = false; },
    }) },
    PropertiesService: { getScriptProperties: () => ({ getProperty: () => "test" }) },
    SpreadsheetApp: {
      getActiveSpreadsheet: () => ({ getSheets: () => [sheet, domainSheet] }),
      flush: () => { assert.equal(locked, true); flushed++; },
    },
  });
  vm.runInContext(source, api);
  api.jsonResponse = (value) => JSON.parse(JSON.stringify(value));
  api.parsePostBody_ = (event) => JSON.parse(event.postData.contents);
  const post = (body) => api.doPost({ postData: { contents: JSON.stringify(body) } });
  return { post, rows, flushCount: () => flushed };
}

test("Apps Script preserves explicit IDs and generates domain-key sequences under the lock", () => {
  const { post, rows, flushCount } = backend([
    ["NE8", "nurse-enablement", "Legacy"],
    ["nurse-enablement-002", "Nurse-Enablement", "Existing"],
    ["nurse-enablement-8", "another", "Other domain"],
    ["nurse-enablement-5-extra", "nurse-enablement", "Not a sequence"],
  ]);
  assert.deepEqual(post(input()), { ok: true, id: "nurse-enablement-3" });
  assert.deepEqual(post(input({ id: " nurse-enablement-4 " })), { ok: true, id: "nurse-enablement-4" });
  assert.match(post(input({ id: "NURSE-ENABLEMENT-4" })).error, /ID already exists/);
  assert.deepEqual(post(input()), { ok: true, id: "nurse-enablement-5" });
  for (const id of ["", "  ", null]) {
    assert.match(post(input({ id })).error, /ID is required/);
  }
  assert.deepEqual(post(input({ id: "Legacy-9" })), { ok: true, id: "Legacy-9" });
  assert.deepEqual(post(input({ team: "another", id: "Legacy-9" })), { ok: true, id: "Legacy-9" });
  assert.deepEqual(post(input({ team: "new domain" })), { ok: true, id: "new-domain-1" });
  assert.deepEqual(post(input({ team: "ne" })), { ok: true, id: "ne-1" });
  assert.equal(flushCount(), 7);
  assert.equal(rows[1][0], "NE8");
  assert.equal(rows[2][0], "nurse-enablement-002");
  assert.equal(post(input({ action: "update", id: "NE8", name: "Changed" })).ok, true);
  assert.equal(rows[1][0], "NE8");
  assert.equal(rows[1][2], "Changed");
});

test("Apps Script rejects invalid domains, missing columns and unsafe sequences without appending", () => {
  const one = backend();
  assert.match(one.post(input({ team: "!!!" })).error, /Domain must contain/);
  one.rows[0][1] = "Other";
  assert.match(one.post(input()).error, /ID and Domain/);
  assert.equal(one.rows.length, 1);
  const missingId = backend();
  missingId.rows[0][0] = "Other";
  assert.match(missingId.post(input({ id: "old-client" })).error, /ID column/);
  assert.equal(missingId.rows.length, 1);
  const huge = backend([["nurse-enablement-9007199254740991", "nurse-enablement"]]);
  assert.match(huge.post(input()).error, /sequence is too large/);
  assert.equal(huge.rows.length, 2);
});

let server;
let browser;
before(async () => {
  server = await createServer({
    envFile: false,
    base: "/",
    define: { "import.meta.env.VITE_DATA_SOURCE": JSON.stringify("local") },
    server: { host: "127.0.0.1", port: 0 },
  });
  await server.listen();
  browser = await chromium.launch();
});
after(async () => {
  await browser?.close();
  await server?.close();
});

test("local IndexedDB serializes concurrent creates and preserves legacy edits", async () => {
  const page = await browser.newPage();
  try {
    await page.goto(`http://127.0.0.1:${server.httpServer.address().port}/`);
    const result = await page.evaluate(async () => {
      const { db, postToLocal } = await import("/src/db/database.js");
      await db.projects.clear();
      await db.domains.put({ id: "ne", name: "Nurse Enablement" });
      await db.projects.bulkAdd([
        { key: "nurse-enablement::NE8", domain: "nurse-enablement", id: "NE8", name: "Legacy" },
        { key: "nurse-enablement::nurse-enablement-002", domain: "nurse-enablement", id: "nurse-enablement-002" },
        { key: "other::nurse-enablement-9", domain: "other", id: "nurse-enablement-9" },
      ]);
      const body = { action: "add", team: "nurse-enablement", name: "New" };
      const created = await Promise.all(Array.from({ length: 10 }, () => postToLocal(body)));
      const empty = await postToLocal({ ...body, team: "empty domain" });
      const named = await postToLocal({ ...body, team: "ne" });
      const explicit = await postToLocal({ ...body, id: " Legacy-9 " });
      const errors = [];
      for (const id of ["legacy-9", "", "  ", null]) {
        try { await postToLocal({ ...body, id }); } catch (error) { errors.push(error.message); }
      }
      const competing = await Promise.allSettled([
        postToLocal({ ...body, team: "parallel", id: "parallel-1" }),
        postToLocal({ ...body, team: "parallel" }),
      ]);
      const parallelRows = await db.projects.where("domain").equals("parallel").toArray();
      await postToLocal({ action: "update", team: "nurse-enablement", id: "NE8", name: "Changed" });
      return { created, empty, named, explicit, errors, competing, parallelRows, legacy: await db.projects.get("nurse-enablement::NE8") };
    });
    assert.deepEqual(result.created.map((x) => x.id).sort(), Array.from({ length: 10 }, (_, i) => `nurse-enablement-${i + 3}`).sort());
    assert.deepEqual(result.empty, { ok: true, id: "empty-domain-1" });
    assert.deepEqual(result.named, { ok: true, id: "ne-1" });
    assert.deepEqual(result.explicit, { ok: true, id: "Legacy-9" });
    assert.match(result.errors[0], /ID already exists/);
    for (const error of result.errors.slice(1)) assert.match(error, /ID is required/);
    assert.equal(result.errors.length, 4);
    assert.equal(result.competing[1].status, "fulfilled");
    const parallelIds = result.parallelRows.map((row) => row.id);
    assert.equal(new Set(parallelIds).size, parallelIds.length);
    assert.ok(parallelIds.includes("parallel-1"));
    if (result.competing[0].status === "fulfilled") {
      assert.deepEqual(parallelIds.sort(), ["parallel-1", "parallel-2"]);
    } else {
      assert.deepEqual(parallelIds, ["parallel-1"]);
    }
    assert.equal(result.legacy.id, "NE8");
    assert.equal(result.legacy.name, "Changed");
  } finally {
    await page.close();
  }
});

test("add dialog submits without an ID and stays open until the save finishes", async () => {
  const page = await browser.newPage();
  try {
    await page.goto(`http://127.0.0.1:${server.httpServer.address().port}/`);
    await page.evaluate(async () => {
      const { default: React } = await import("/node_modules/.vite/deps/react.js");
      const { default: ReactDOM } = await import("/node_modules/.vite/deps/react-dom_client.js");
      const { default: AdminModal } = await import("/src/components/AdminModal.jsx");
      document.body.innerHTML = '<div id="test-root"></div>';
      window.savedPayload = null;
      window.dialogClosed = false;
      const pending = new Promise((resolve) => { window.finishSave = resolve; });
      ReactDOM.createRoot(document.getElementById("test-root")).render(React.createElement(AdminModal, {
        domains: ["nurse-enablement"], adminToken: "test",
        initialValues: {
          domain: "nurse-enablement", name: "Test", description: "Description",
          timelineStart: "2026-01-01", timelineEnd: "2026-03-31",
        },
        onSave: (payload) => { window.savedPayload = payload; return pending; },
        onClose: () => { window.dialogClosed = true; },
      }));
    });
    await page.getByRole("button", { name: "Add project" }).click();
    assert.equal(await page.evaluate(() => "id" in window.savedPayload), false);
    await page.getByRole("button", { name: "Adding..." }).waitFor();
    assert.equal(await page.getByRole("button", { name: "Close", exact: true }).isDisabled(), true);
    await page.keyboard.press("Escape");
    assert.equal(await page.evaluate(() => window.dialogClosed), false);
    await page.evaluate(() => window.finishSave());
    await page.waitForFunction(() => window.dialogClosed);
  } finally {
    await page.close();
  }
});

test("remote add requires a valid generated ID receipt and surfaces backend errors", async () => {
  const remote = await createServer({
    envFile: false,
    base: "/",
    define: {
      "import.meta.env.VITE_DATA_SOURCE": JSON.stringify("remote"),
      "import.meta.env.VITE_SHEETS_API_URL": JSON.stringify("https://roadmap.test/exec"),
    },
    server: { host: "127.0.0.1", port: 0 },
  });
  let page;
  try {
    await remote.listen();
    page = await browser.newPage();
    const receipts = [
      { ok: true, id: "ne-1" }, { ok: true }, { ok: false, error: "ID already exists" },
      { id: "ne-2" },
    ];
    const sent = [];
    await page.route("https://roadmap.test/exec", async (route) => {
      const request = route.request();
      if (request.method() !== "POST") {
        await route.fulfill({ json: { projects: [], domains: [] } });
        return;
      }
      sent.push(request.postDataJSON());
      await route.fulfill({ json: receipts.shift() });
    });
    await page.goto(`http://127.0.0.1:${remote.httpServer.address().port}/`);
    const result = await page.evaluate(async () => {
      const { addInitiative } = await import("/src/services/sheetsApi.js");
      const body = { team: "ne", name: "Test" };
      const saved = await addInitiative(body);
      const errors = [];
      for (let i = 0; i < 3; i++) {
        try { await addInitiative(body); } catch (error) { errors.push(error.message); }
      }
      return { saved, errors };
    });
    assert.deepEqual(result.saved, { ok: true, id: "ne-1" });
    assert.match(result.errors[0], /Could not confirm/);
    assert.match(result.errors[1], /ID already exists/);
    assert.match(result.errors[2], /Could not confirm/);
    assert.equal(result.errors.length, 3);
    assert.equal(sent.length, 4);
    assert.ok(sent.every((body) => body.action === "add" && !("id" in body)));
  } finally {
    await page?.close();
    await remote.close();
  }
});
