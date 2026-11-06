import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { randomUUID, createHash } from "node:crypto";
import vm from "node:vm";
import { after, before, test } from "node:test";
import { chromium } from "playwright";
import { createServer } from "vite";
import { ROUTES } from "../src/config/navigation.js";
import { FEEDBACK_CATEGORIES, validateFeedback, validateFeedbackReceipt } from "../src/config/feedbackConfig.js";

const source = readFileSync(new URL("./google-apps-script/Code.gs", import.meta.url), "utf8");
const input = (overrides = {}) => ({
  action: "submitFeedback", requestId: randomUUID(), name: "Test name",
  category: "Share feedback", page: "overview", message: "Synthetic test message", ...overrides,
});
const receipt = (body) => ({ ok: true, id: `FB-${randomUUID()}`, submittedAt: new Date().toISOString(), requestId: body.requestId });

function backend() {
  const sheets = new Map([["Projects", { untouched: true }]]);
  let locked = false;
  const context = vm.createContext({
    console, Date, JSON,
    LockService: { getScriptLock: () => ({
      waitLock: () => { assert.equal(locked, false); locked = true; },
      releaseLock: () => { locked = false; },
    }) },
    PropertiesService: { getScriptProperties: () => ({ getProperty: () => "test-admin-token" }) },
    SpreadsheetApp: {
      getActiveSpreadsheet: () => ({
        getSheetByName: (name) => sheets.get(name),
        insertSheet: (name) => {
          const rows = [];
          const sheet = {
            rows, getLastRow: () => rows.length,
            getRange: (row, col, count = 1, width = 1) => ({
              getValues: () => Array.from({ length: count }, (_, index) =>
                Array.from({ length: width }, (__, column) => rows[row - 1 + index]?.[col - 1 + column] ?? "")),
              setValues: (values) => { for (let i = 0; i < values.length; i++) rows[row - 1 + i] = [...values[i]]; },
              setFontWeight: () => {},
              setNumberFormat: () => {},
            }),
            setFrozenRows: () => {}, appendRow: (values) => { assert.equal(locked, true); rows.push([...values]); },
          };
          sheets.set(name, sheet);
          return sheet;
        },
      }),
      flush: () => {},
    },
    Utilities: {
      getUuid: randomUUID, DigestAlgorithm: { SHA_256: "sha256" }, Charset: { UTF_8: "utf8" },
      computeDigest: (algorithm, value) => createHash(algorithm).update(value).digest(),
      base64Encode: (value) => Buffer.from(value).toString("base64"),
    },
  });
  vm.runInContext(source, context);
  context.jsonResponse = (value) => JSON.parse(JSON.stringify(value));
  context.parsePostBody_ = (event) => JSON.parse(event.postData.contents);
  const post = (body) => context.doPost({ postData: { contents: JSON.stringify(body) } });
  return { context, sheets, post };
}

test("backend creates only Feedback, generates IDs/timestamps, deduplicates and preserves headers/data", () => {
  const { sheets, post, context } = backend();
  const body = input({ name: "=1+1", message: "+SUM(1,1)" });
  const first = post(body);
  validateFeedbackReceipt(first, body.requestId);
  const rows = sheets.get("Feedback").rows;
  assert.equal(rows.length, 2);
  assert.deepEqual(rows[0], Array.from(context.FEEDBACK_HEADERS));
  assert.equal(rows[1][2], "'=1+1");
  assert.equal(rows[1][6], "'+SUM(1,1)");
  assert.equal(rows[1][7], "New");
  assert.equal(rows[1][5], "https://lkondragunta-relias.github.io/communities-toolbox/#/overview");
  assert.deepEqual(post(body), first);
  assert.equal(rows.length, 2);
  assert.equal(post({ ...body, message: "Changed" }).ok, false);
  assert.equal(rows.length, 2);
  context.setupFeedbackSheet();
  assert.equal(rows.length, 2);
  assert.equal(sheets.get("Projects").untouched, true);
  assert.deepEqual([...sheets.keys()], ["Projects", "Feedback"]);
});

test("backend allows all categories/internal pages, rejects invalid or server-controlled fields before writes", () => {
  const { post, context, sheets } = backend();
  assert.deepEqual({ ...context.FEEDBACK_PAGES }, Object.fromEntries(ROUTES.map((route) => [route.id, route.path])));
  assert.deepEqual(Array.from(context.FEEDBACK_CATEGORIES), FEEDBACK_CATEGORIES);
  for (const invalid of [
    { name: "" }, { name: "  " }, { name: 1 }, { name: "a".repeat(101) },
    { message: "\n " }, { message: {} }, { message: "x".repeat(5001) }, { message: "x\u0000y" },
    { category: "Unknown" }, { page: "accessibility" }, { page: "__proto__" },
    { requestId: "invalid" }, { id: "FB-forged" }, { submittedAt: "tomorrow" },
    { status: "Resolved" }, { pageUrl: "https://evil.test" }, { adminToken: "anything" },
  ]) {
    const body = input(invalid);
    assert.throws(() => validateFeedback(body));
    assert.equal(post(body).ok, false, JSON.stringify(invalid));
    assert.equal(sheets.has("Feedback"), false);
  }
  for (const page of ROUTES) {
    for (const category of FEEDBACK_CATEGORIES) {
      assert.equal(post(input({ page: page.id, category })).ok, true);
    }
  }
  assert.equal(sheets.get("Feedback").rows.length, 1 + ROUTES.length * FEEDBACK_CATEGORIES.length);
});

test("admin branches remain authenticated and public reads never expose feedback", () => {
  const { context, post } = backend();
  assert.equal(post(input()).ok, true);
  for (const action of ["add", "delete", "addIncident", "setupIncidentConfig", "saveOrgAssignment", "unknown"]) {
    assert.match(post({ action }).error, /admin token/i);
    assert.match(post({ action, adminToken: "wrong" }).error, /admin token/i);
  }
  assert.match(post({ action: "unknown", adminToken: "test-admin-token" }).error, /Unknown action/);
  for (const reader of ["readProjects_", "readTeams_", "readDomains_", "readStatuses_", "readPriorities_", "readIncidents_", "readIncidentConfig_", "readOrg_", "readCookiebotSites_", "readCookiebotReports_"]) {
    context[reader] = () => [];
  }
  const publicData = context.doGet({});
  assert.equal("feedback" in publicData, false);
  assert.equal(JSON.stringify(publicData).includes("Synthetic test message"), false);
  assert.deepEqual(context.doGet({ parameter: { action: "feedbackCapabilities" } }), { ok: true, feedbackVersion: 1 });
});

test("formula prefixes are escaped and lock failure is an explicit failure", () => {
  const { context, post } = backend();
  for (const prefix of ["=", "+", "-", "@", "'"]) assert.equal(context.safeFeedbackCell_(`${prefix}test`), `'${prefix}test`);
  assert.equal(context.safeFeedbackCell_("<script>alert(1)</script>"), "<script>alert(1)</script>");
  context.LockService.getScriptLock = () => ({ waitLock: () => { throw new Error("busy"); }, releaseLock: () => assert.fail("Not acquired") });
  assert.equal(post(input()).ok, false);
});

let browser;
let local;
let remote;
let localUrl;
let remoteUrl;

before(async () => {
  const server = async (mode) => {
    const app = await createServer({
      envFile: false,
      base: "/",
      cacheDir: `node_modules/.vite-feedback-${mode}`,
      optimizeDeps: { include: ["react", "react-dom/client", "dexie"] },
      define: {
        "import.meta.env.VITE_DATA_SOURCE": JSON.stringify(mode),
        "import.meta.env.VITE_SHEETS_API_URL": JSON.stringify("https://feedback.test/exec"),
        "import.meta.env.VITE_ADMIN_TOKEN": JSON.stringify("feedback-test-site"),
      },
      server: { host: "127.0.0.1", port: 0 },
    });
    await app.listen();
    return app;
  };
  local = await server("local");
  remote = await server("remote");
  localUrl = `http://127.0.0.1:${local.httpServer.address().port}`;
  remoteUrl = `http://127.0.0.1:${remote.httpServer.address().port}`;
  browser = await chromium.launch();
});

after(async () => {
  await browser?.close();
  await local?.close();
  await remote?.close();
});

async function widget(mode = "local", viewport = { width: 1280, height: 900 }) {
  const page = await browser.newPage({ viewport });
  page.setDefaultTimeout(5000);
  const url = mode === "local" ? localUrl : remoteUrl;
  await page.goto(url);
  await page.evaluate(async (dataMode) => {
    const { default: React } = await import(`/node_modules/.vite-feedback-${dataMode}/deps/react.js`);
    const { default: ReactDOM } = await import(`/node_modules/.vite-feedback-${dataMode}/deps/react-dom_client.js`);
    const { default: Widget } = await import("/src/components/FeedbackWidget.jsx");
    // Isolate the widget from the access gate without changing production auth.
    const host = document.createElement("div");
    document.body.replaceChildren(host);
    const root = ReactDOM.createRoot(host);
    window.renderFeedback = (view) => root.render(React.createElement(Widget, { view }));
    window.renderFeedback("overview");
  }, mode);
  await page.getByRole("button", { name: "Send feedback", exact: true }).waitFor();
  return page;
}

async function fill(page) {
  await page.getByLabel("Name (required)").fill("Test name");
  await page.getByLabel("Message (required)").fill("Synthetic browser feedback");
}

test("widget opens on every internal route, defaults current page, preserves draft, handles keyboard and saves locally", async () => {
  const page = await widget();
  try {
    for (const route of ROUTES) {
      await page.evaluate((view) => window.renderFeedback(view), route.id);
      await page.getByRole("button", { name: "Send feedback", exact: true }).click();
      await page.waitForFunction((view) => document.querySelector("#feedback-page").value === view, route.id);
      assert.equal(await page.getByLabel("Page", { exact: true }).inputValue(), route.id);
      assert.equal(await page.getByLabel("Name (required)").evaluate((element) => document.activeElement === element), true);
      const options = await page.locator("#feedback-page option").allTextContents();
      assert.deepEqual(options, ROUTES.map((entry) => entry.label));
      assert.equal(options.includes("Accessibility"), false);
      await page.keyboard.press("Escape");
      assert.equal(await page.locator("dialog").evaluate((element) => element.open), false);
      assert.equal(await page.getByRole("button", { name: "Send feedback", exact: true }).evaluate((element) => element === document.activeElement), true);
    }
    await page.getByRole("button", { name: "Send feedback", exact: true }).click();
    await fill(page);
    await page.getByLabel("Page", { exact: true }).selectOption("incidents");
    await page.getByLabel("What would you like to share?").selectOption("Report a bug");
    await page.getByRole("button", { name: "Close feedback", exact: true }).click();
    await page.getByRole("button", { name: "Send feedback", exact: true }).click();
    assert.equal(await page.getByLabel("Message (required)").inputValue(), "Synthetic browser feedback");
    await page.getByLabel("Page", { exact: true }).selectOption("incidents");
    await page.getByRole("button", { name: "Send", exact: true }).click();
    await page.getByRole("status").filter({ hasText: "has been sent" }).waitFor();
    const rows = await page.evaluate(async () => (await import("/src/db/database.js")).db.feedback.toArray());
    assert.equal(rows.length, 1);
    assert.equal(rows[0].page, "incidents");
    assert.equal(rows[0].category, "Report a bug");
    const data = await page.evaluate(async () => (await import("/src/db/database.js")).getRoadmap());
    assert.equal("feedback" in data, false);
    const again = await page.evaluate(async (row) => {
      const { postToLocal } = await import("/src/db/database.js");
      const body = { action: "submitFeedback", requestId: row.requestId, name: row.name, category: row.category, page: row.page, message: row.message };
      const response = await postToLocal(body);
      return { response, count: await (await import("/src/db/database.js")).db.feedback.count() };
    }, rows[0]);
    assert.equal(again.count, 1);
    assert.equal(again.response.id, rows[0].id);
    await page.getByRole("button", { name: "Done", exact: true }).click();
    await page.getByRole("button", { name: "Send feedback", exact: true }).click();
    assert.equal(await page.getByLabel("Name (required)").inputValue(), "");
  } finally { await page.close(); }
});

test("required and length validation never writes whitespace-only feedback", async () => {
  const page = await widget();
  try {
    await page.getByRole("button", { name: "Send feedback", exact: true }).click();
    await page.getByRole("button", { name: "Send", exact: true }).click();
    assert.equal(await page.getByLabel("Name (required)").evaluate((element) => element.validity.valueMissing), true);
    await page.getByLabel("Name (required)").fill("  ");
    await page.getByLabel("Message (required)").fill("  ");
    await page.getByRole("button", { name: "Send", exact: true }).click();
    await page.getByRole("alert").filter({ hasText: "Please enter your name" }).waitFor();
    assert.equal(await page.getByLabel("Name (required)").getAttribute("maxlength"), "100");
    assert.equal(await page.getByLabel("Message (required)").getAttribute("maxlength"), "5000");
  } finally { await page.close(); }
});

test("full app exposes Feedback on every internal page, including presentation mode", async () => {
  const page = await browser.newPage();
  try {
    await page.goto(`${localUrl}/?token=feedback-test-site`);
    await page.getByRole("button", { name: "Send feedback", exact: true }).waitFor({ timeout: 15000 });
    for (const route of ROUTES) {
      await page.evaluate((path) => { window.location.hash = `#/${path}`; }, route.path);
      await page.waitForFunction((title) => document.title.startsWith(title), route.title);
      assert.equal(await page.getByRole("button", { name: "Send feedback", exact: true }).isVisible(), true);
    }
    await page.evaluate(() => { window.location.hash = "#/roadmap"; });
    await page.getByRole("button", { name: "Present", exact: false }).click();
    assert.equal(await page.getByRole("button", { name: "Send feedback", exact: true }).isVisible(), true);
    await page.getByRole("button", { name: "Send feedback", exact: true }).click();
    await page.keyboard.press("Escape");
    assert.equal(await page.getByRole("button", { name: "Exit (Esc)", exact: true }).isVisible(), true);
    if (process.env.FEEDBACK_EVIDENCE_DIR) {
      await page.getByRole("button", { name: "Exit (Esc)", exact: true }).click();
      await page.screenshot({ path: join(process.env.FEEDBACK_EVIDENCE_DIR, "feedback-on-roadmap.png") });
      await page.getByRole("button", { name: "Send feedback", exact: true }).click();
      await fill(page);
      await page.screenshot({ path: join(process.env.FEEDBACK_EVIDENCE_DIR, "feedback-desktop-light.png") });
      await page.setViewportSize({ width: 390, height: 844 });
      await page.evaluate(() => { document.documentElement.dataset.theme = "dark"; });
      await page.screenshot({ path: join(process.env.FEEDBACK_EVIDENCE_DIR, "feedback-mobile-dark.png") });
    }
  } finally { await page.close(); }
});

test("remote receipt errors keep one request across retry/close, double clicks cannot append twice", async () => {
  const page = await widget("remote");
  const requests = [];
  try {
    await page.route("https://feedback.test/exec**", async (route) => {
      const body = route.request().postDataJSON();
      if (!body) return route.fulfill({ json: { ok: true, feedbackVersion: 1 } });
      requests.push(body);
      await new Promise((resolve) => setTimeout(resolve, 100));
      return route.fulfill({ json: requests.length === 1 ? { ok: false, error: "Synthetic failure" } : receipt(body) });
    });
    await page.getByRole("button", { name: "Send feedback", exact: true }).click();
    await fill(page);
    await page.getByRole("button", { name: "Send", exact: true }).dblclick();
    await page.getByRole("alert").filter({ hasText: "Synthetic failure" }).waitFor();
    assert.equal(requests.length, 1);
    assert.equal("adminToken" in requests[0], false);
    assert.equal(await page.getByLabel("Message (required)").isDisabled(), true);
    await page.getByRole("button", { name: "Close feedback", exact: true }).click();
    await page.evaluate(() => window.renderFeedback("timeline"));
    await page.getByRole("button", { name: "Send feedback", exact: true }).click();
    assert.equal(await page.getByLabel("Page", { exact: true }).inputValue(), "overview");
    await page.getByRole("button", { name: "Retry send", exact: true }).click();
    await page.getByRole("status").filter({ hasText: "has been sent" }).waitFor();
    assert.deepEqual(requests[0], requests[1]);
  } finally { await page.close(); }
});

test("unsupported backend disables send; malformed/error/HTTP/network responses never count as saved", async () => {
  const page = await widget("remote");
  try {
    await page.route("https://feedback.test/exec**", (route) => route.fulfill({ json: { projects: [] } }));
    await page.getByRole("button", { name: "Send feedback", exact: true }).click();
    await page.getByRole("alert").filter({ hasText: "not available yet" }).waitFor();
    assert.equal(await page.getByRole("button", { name: "Send", exact: true }).isDisabled(), true);
    for (const failure of ["contract", "json", "http", "network", "error"]) {
      await page.unroute("https://feedback.test/exec**");
      await page.route("https://feedback.test/exec**", (route) => {
        if (failure === "network") return route.abort();
        if (failure === "http") return route.fulfill({ status: 503, json: { error: "busy" } });
        if (failure === "json") return route.fulfill({ body: "not json" });
        return route.fulfill({ json: failure === "error" ? { error: "failed" } : { ok: true } });
      });
      const result = await page.evaluate(async (body) => {
        try { await (await import("/src/services/sheetsApi.js")).submitFeedback(body); return "saved"; }
        catch (err) { return err.message; }
      }, input());
      assert.notEqual(result, "saved");
    }
  } finally { await page.close(); }
});

test("modal stays accessible in dark/mobile themes without horizontal overflow and captures evidence", async () => {
  const page = await widget("local", { width: 390, height: 844 });
  try {
    await page.evaluate(() => { document.documentElement.dataset.theme = "dark"; });
    await page.getByRole("button", { name: "Send feedback", exact: true }).click();
    await fill(page);
    await page.getByRole("button", { name: "Send", exact: true }).focus();
    await page.keyboard.press("Tab");
    assert.equal(await page.getByRole("button", { name: "Send feedback", exact: true }).evaluate((element) => element === document.activeElement), false);
    assert.equal(await page.locator("dialog").evaluate((element) => element.scrollWidth <= element.clientWidth), true);
    const box = await page.locator("dialog").boundingBox();
    assert.ok(Math.abs(box.x - (390 - box.width) / 2) < 2);
  } finally { await page.close(); }
});

test("organization Edit launcher and expanded panel never overlap Feedback", async () => {
  const page = await browser.newPage();
  page.setDefaultTimeout(5000);
  const feedback = page.getByRole("button", { name: "Send feedback", exact: true });
  const edit = page.getByRole("button", { name: "Edit with chat", exact: true });
  const panel = page.getByRole("region", { name: "Edit organization with guided commands", exact: true });
  const intersects = (a, b) => a.x < b.x + b.width && a.x + a.width > b.x &&
    a.y < b.y + b.height && a.y + a.height > b.y;
  try {
    await page.goto(`${localUrl}/?token=feedback-test-site#/prod-eng-org`);
    await feedback.waitFor({ timeout: 15000 });
    for (const [width, height] of [[1280, 900], [723, 963], [560, 740], [390, 844], [320, 568], [844, 390]]) {
      await page.setViewportSize({ width, height });
      const feedbackBox = await feedback.boundingBox();
      const editBox = await edit.boundingBox();
      assert.equal(intersects(feedbackBox, editBox), false, `${width}: closed launchers`);
      assert.ok(feedbackBox.x - (editBox.x + editBox.width) >= 12, `${width}: launcher gap`);
      await edit.click();
      const panelBox = await panel.boundingBox();
      assert.equal(intersects(feedbackBox, panelBox), false, `${width}: open panel and Feedback`);
      assert.ok(feedbackBox.y - (panelBox.y + panelBox.height) >= 11, `${width}: panel gap`);
      assert.ok(panelBox.x >= 0 && panelBox.y >= 0 &&
        panelBox.x + panelBox.width <= width && panelBox.y + panelBox.height <= height, `${width}: panel stays on screen`);
      await feedback.click();
      assert.equal(await page.locator("dialog").evaluate((element) => element.open), true);
      await page.keyboard.press("Escape");
      assert.equal(await panel.isVisible(), true);
      if (process.env.FEEDBACK_EVIDENCE_DIR && [1280, 390].includes(width)) {
        await page.screenshot({ path: join(process.env.FEEDBACK_EVIDENCE_DIR, `feedback-edit-${width}-after.png`) });
      }
      await page.getByRole("button", { name: "Close assistant", exact: true }).click();
    }
  } finally { await page.close(); }
});
