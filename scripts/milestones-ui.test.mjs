import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { join } from "node:path";
import { after, before, test } from "node:test";
import { chromium } from "playwright";
import { createServer } from "vite";

let browser, activeServer, activeMode, activeUrl;
async function server(mode) {
  if (activeMode === mode) return activeUrl;
  await activeServer?.close();
  const app = await createServer({
      envFile: false, base: "/", cacheDir: `node_modules/.vite-milestones-${mode}`,
      optimizeDeps: { include: ["react", "react-dom/client", "dexie"] },
      define: {
        "import.meta.env.VITE_DATA_SOURCE": JSON.stringify(mode),
        "import.meta.env.VITE_SHEETS_API_URL": JSON.stringify("https://milestones.test/exec"),
        "import.meta.env.VITE_ADMIN_TOKEN": JSON.stringify("milestone-test-site"),
      },
      server: { host: "127.0.0.1", port: 0 },
  });
  await app.listen();
  activeServer = app; activeMode = mode;
  activeUrl = `http://127.0.0.1:${app.httpServer.address().port}`;
  return activeUrl;
}
before(async () => {
  browser = await chromium.launch({ channel: process.env.PLAYWRIGHT_CHANNEL || undefined });
});
after(async () => { await browser?.close(); await activeServer?.close(); });

async function appPage() {
  const localUrl = await server("local");
  const page = await browser.newPage({ viewport: { width: 1440, height: 1100 } });
  page.setDefaultTimeout(7000);
  await page.goto(`${localUrl}/?token=milestone-test-site#/milestones`);
  try { await page.locator(".milestone-card").first().waitFor(); }
  catch (error) {
    console.error("Local app did not load:", await page.locator("body").innerText());
    await page.close(); throw error;
  }
  return page;
}

const domainDefs = [{ id: "nurse-enablement", name: "Nurse Recruiting (Nuxt)" }, { id: "nurse-mobile-app", name: "Nurse Mobile App" }];
const empty = () => ({ domains: domainDefs, milestones: { version: 1, configured: true, items: [] } });
async function remotePage(handler) {
  const remoteUrl = await server("remote");
  const page = await browser.newPage({ viewport: { width: 1280, height: 950 } });
  page.setDefaultTimeout(7000);
  await page.route("https://milestones.test/exec**", route => {
    if (route.request().method() === "GET" && new URL(route.request().url()).searchParams.get("action") !== "milestones") {
      return route.fulfill({ json: { projects: [], domains: domainDefs, teams: [], statuses: [], priorities: [] } });
    }
    return handler(route);
  });
  await page.goto(`${remoteUrl}/?token=milestone-test-site#/milestones`);
  return page;
}
async function fillForm(page) {
  await page.getByRole("checkbox", { name: "Nurse Recruiting (Nuxt)", exact: true }).check();
  await page.getByRole("checkbox", { name: "Nurse Mobile App", exact: true }).check();
  await page.getByLabel("Title (required)").fill("Synthetic browser milestone");
  await page.getByLabel("Date (required)").fill(`${new Date().getFullYear()}-09-30`);
  await page.getByLabel("Impact (required)").fill("Synthetic impact only.");
}

test("full app timeline filters shared achievements once, preserves historical years and past Planned state", async () => {
  const page = await appPage();
  try {
    const year = String(new Date().getFullYear());
    assert.equal(await page.getByRole("button", { name: "Milestones", exact: true }).getAttribute("aria-current"), "page");
    assert.equal(await page.getByLabel("Milestone year").inputValue(), year);
    assert.equal(await page.locator(".milestone-card").count(), 3);
    assert.match(await page.locator(".milestone-quarter").first().innerText(), /Q4/);
    const names = await page.evaluate(async () => {
      const data = await (await import("/src/db/database.js")).getLocalMilestoneData();
      return data.milestones.items.find(item => item.title === "[Demo] A shared release").domainIds.map(id => data.domains.find(d => d.id === id).name);
    });
    await page.getByRole("button", { name: "All domains", exact: true }).click();
    await page.getByRole("checkbox", { name: names[0], exact: true }).check();
    await page.getByRole("checkbox", { name: names[1], exact: true }).check();
    await page.keyboard.press("Escape");
    assert.equal(await page.locator("#milestone-domain-options").count(), 0);
    assert.equal(await page.locator(".milestone-domain-filter > button").evaluate(el => el === document.activeElement), true);
    await page.getByRole("button", { name: "Q3", exact: true }).click();
    assert.equal(await page.locator(".milestone-card").count(), 1);
    await page.getByRole("button", { name: "Reset all filters", exact: true }).click();
    assert.equal(await page.locator(".milestone-card").count(), 3);
    await page.getByLabel("Milestone year").selectOption("all");
    assert.equal(await page.locator(".milestone-card").count(), 4);
    assert.equal(await page.locator(".milestone-planned").count(), 2);
    await page.getByLabel("Milestone year").selectOption(String(Number(year) - 1));
    assert.equal(await page.locator(".milestone-card").count(), 1);
    await page.getByRole("button", { name: "Q1", exact: true }).click();
    assert.equal(await page.getByText("No achievements in this view", { exact: true }).isVisible(), true);
    await page.getByRole("button", { name: "Reset all filters", exact: true }).first().click();
    await page.getByRole("button", { name: "Q1", exact: true }).click();
    assert.equal(await page.locator(".milestone-planned").count(), 1);
    assert.match(await page.locator(".milestone-planned").innerText(), /Awaiting confirmation/);
  } finally { await page.close(); }
});

test("local create/edit/delete uses multi-domain IDs, calendar dates and revision checks, with accessible details", async () => {
  const page = await appPage();
  const errors = [];
  page.on("pageerror", error => errors.push(error.message));
  try {
    await page.getByRole("button", { name: "+ Add milestone", exact: true }).click();
    const checks = page.locator(".milestone-form__domains input");
    await checks.nth(0).check(); await checks.nth(1).check();
    await page.getByLabel("Title (required)").fill("Synthetic browser achievement");
    await page.getByLabel("Date (required)").fill(`${new Date().getFullYear()}-03-31`);
    await page.getByLabel("Impact (required)").fill("Synthetic impact, no real delivery claim.");
    await page.getByLabel("Details (optional)").fill("Synthetic detailed story.");
    await page.getByLabel("Evidence links (optional)").fill("javascript:alert(1)");
    await page.getByRole("button", { name: "Save milestone", exact: true }).click();
    await page.getByRole("alert").filter({ hasText: "HTTPS" }).waitFor();
    await page.getByLabel("Evidence links (optional)").fill("https://example.test/evidence");
    await page.getByRole("button", { name: "Save milestone", exact: true }).dblclick();
    await page.locator(".milestone-card").filter({ hasText: "Synthetic browser achievement" }).waitFor();
    const record = await page.evaluate(async () => (await (await import("/src/db/database.js")).db.milestones.toArray()).filter(m => m.title === "Synthetic browser achievement"));
    assert.equal(record.length, 1);
    assert.equal(record[0].domainIds.length, 2);
    await page.locator(".milestone-card").filter({ hasText: "Synthetic browser achievement" }).click();
    assert.match(page.url(), /#\/milestones\/MS-/);
    assert.equal(await page.getByRole("link", { name: "https://example.test/evidence" }).getAttribute("rel"), "noopener noreferrer");
    await page.getByRole("button", { name: "Edit milestone", exact: true }).click();
    await page.getByLabel("Title (required)").fill("Synthetic updated achievement");
    await page.getByLabel("Status", { exact: true }).selectOption("Planned");
    await page.getByRole("button", { name: "Save milestone", exact: true }).click();
    await page.locator(".milestone-planned").filter({ hasText: "Synthetic updated achievement" }).waitFor();
    assert.equal(await page.locator(".milestone-card").filter({ hasText: "Synthetic updated achievement" }).count(), 0);
    const stale = await page.evaluate(async old => {
      const { postToLocal, deleteDomain } = await import("/src/db/database.js");
      try { await deleteDomain(old.domainIds[0]); return "deleted"; } catch (err) {
        const guard = err.message;
        try {
          await postToLocal({ action: "deleteMilestone", requestId: crypto.randomUUID(), id: old.id, expectedUpdatedAt: old.updatedAt });
          return "overwritten";
        } catch (revision) { return `${guard} ${revision.message}`; }
      }
    }, record[0]);
    assert.match(stale, /milestones.*changed/s);
    await page.locator(".milestone-planned").filter({ hasText: "Synthetic updated achievement" }).click();
    await page.locator(".milestone-dialog").waitFor();
    await page.keyboard.press("Escape");
    await page.locator(".milestone-dialog").waitFor({ state: "detached" });
    await page.locator(".milestone-planned").filter({ hasText: "Synthetic updated achievement" }).click();
    await page.getByRole("button", { name: "Delete milestone", exact: true }).click();
    await page.getByText("This removes the achievement", { exact: false }).waitFor();
    await page.getByRole("button", { name: "Keep milestone", exact: true }).click();
    await page.getByRole("button", { name: "Delete milestone", exact: true }).click();
    await page.getByRole("button", { name: "Confirm delete milestone", exact: true }).click();
    await page.waitForFunction(() => !document.querySelector(".milestone-dialog"));
    assert.equal(await page.locator(".milestone-planned").filter({ hasText: "Synthetic updated achievement" }).count(), 0);
    assert.deepEqual(errors, []);
  } finally { await page.close(); }
});

test("old API, unconfigured sheet, empty history, and malformed/error/network responses remain distinct", async () => {
  for (const kind of ["old", "unconfigured", "empty", "schema", "network", "http", "json"]) {
    const page = await remotePage(route => {
      if (kind === "network") return route.abort();
      if (kind === "http") return route.fulfill({ status: 503, json: { error: "Synthetic HTTP failure" } });
      if (kind === "json") return route.fulfill({ body: "not JSON" });
      return route.fulfill({ json: kind === "old" ? { projects: [] } :
        kind === "schema" ? { error: "Synthetic schema failure" } :
        kind === "unconfigured" ? { ...empty(), milestones: { version: 1, configured: false, items: [] } } : empty() });
    });
    try {
      const expected = kind === "old" ? "not supported" : kind === "unconfigured" ? "has not been set up" :
        kind === "empty" ? "Your milestone history starts here" : kind === "schema" ? "Synthetic schema failure" :
        kind === "http" ? "Synthetic HTTP failure" : kind === "json" ? "Invalid JSON" : "could not be loaded";
      await page.getByText(expected, { exact: false }).first().waitFor();
      assert.equal(await page.getByRole("button", { name: "+ Add milestone", exact: true }).isDisabled(), kind !== "empty");
    } finally { await page.close(); }
  }
});

test("uncertain create survives closing and reload with the same identity, no token in pending storage, and no duplicate POST", async () => {
  const requests = [];
  const result = empty();
  const page = await remotePage(async route => {
    if (route.request().method() === "GET") return route.fulfill({ json: result });
    const request = route.request().postDataJSON();
    requests.push(request);
    await new Promise(resolve => setTimeout(resolve, 80));
    if (requests.length === 1) return route.fulfill({ json: { ok: true, id: "malformed receipt" } });
    const stamp = new Date().toISOString();
    const { action, requestId, adminToken, ...fields } = request;
    void adminToken;
    const id = `MS-${randomUUID()}`;
    result.milestones.items = [{ id, ...fields, createdAt: stamp, updatedAt: stamp }];
    return route.fulfill({ json: { ok: true, milestonesVersion: 1, action, requestId, id, updatedAt: stamp, deleted: false } });
  });
  try {
    await page.getByText("Your milestone history starts here").waitFor();
    await page.getByRole("button", { name: "+ Add milestone", exact: true }).click();
    await fillForm(page);
    await page.getByRole("button", { name: "Save milestone", exact: true }).dblclick();
    await page.getByRole("alert").filter({ hasText: "unconfirmed" }).waitFor();
    assert.equal(requests.length, 1);
    assert.equal(await page.getByLabel("Title (required)").isDisabled(), true);
    const persisted = await page.evaluate(() => sessionStorage.getItem(Object.keys(sessionStorage).find(key => key.startsWith("milestone-pending:"))));
    assert.equal(persisted.includes("milestone-test-site"), false);
    await page.getByRole("button", { name: "Close milestone panel", exact: true }).click();
    await page.reload();
    await page.getByRole("button", { name: "Retry original request", exact: true }).waitFor();
    await page.getByRole("button", { name: "Retry original request", exact: true }).click();
    await page.locator(".milestone-card").filter({ hasText: "Synthetic browser milestone" }).waitFor();
    assert.deepEqual(requests[0], requests[1]);
    assert.equal(await page.locator(".milestone-card").count(), 1);
  } finally { await page.close(); }
});

test("remote explicit auth/conflict errors preserve drafts but never count as saves; stale loads disable writes", async () => {
  let mode = "AUTH";
  const page = await remotePage(route => route.fulfill({ json: route.request().method() === "GET" ?
    mode === "load-error" ? { error: "Synthetic unavailable" } : empty() :
    { ok: false, code: mode, error: mode === "AUTH" ? "Invalid admin token." : "Milestone changed since it was opened." } }));
  try {
    await page.getByText("Your milestone history starts here").waitFor();
    await page.getByRole("button", { name: "+ Add milestone", exact: true }).click();
    await fillForm(page);
    await page.getByRole("button", { name: "Save milestone", exact: true }).click();
    await page.getByRole("alert").filter({ hasText: "Invalid admin token" }).waitFor();
    assert.equal(await page.getByLabel("Title (required)").inputValue(), "Synthetic browser milestone");
    assert.equal(await page.getByLabel("Title (required)").isDisabled(), false);
    mode = "CONFLICT";
    await page.getByRole("button", { name: "Save milestone", exact: true }).click();
    await page.getByRole("alert").filter({ hasText: "changed since" }).waitFor();
    await page.getByRole("button", { name: "Close milestone panel", exact: true }).click();
    mode = "load-error";
    await page.getByRole("button", { name: "Refresh", exact: true }).click();
    await page.getByText("The previous view is stale", { exact: false }).waitFor();
    assert.equal(await page.getByRole("button", { name: "+ Add milestone", exact: true }).isDisabled(), true);
  } finally { await page.close(); }
});

test("remote normalization and cache preserve milestones without treating metadata as project domains", async () => {
  const page = await appPage();
  try {
    const result = await page.evaluate(async () => {
      const api = await import("/src/services/sheetsApi.js");
      const utils = await import("/src/utils/roadmapUtils.js");
      const database = await import("/src/db/database.js");
      const source = { projects: [], domains: [{ id: "mobile", name: "Mobile" }], milestones: { version: 1, configured: true, items: [] }, org: { configured: true } };
      const normalized = api.mergeRoadmapData(api.normalizeRemotePayload(source));
      await database.cacheRoadmap(normalized);
      const cached = await database.getCachedRoadmap();
      return { milestones: cached.milestones, org: cached.org, keys: utils.getDomainKeys(cached) };
    });
    assert.deepEqual(result, { milestones: { version: 1, configured: true, items: [] }, org: { configured: true }, keys: ["mobile"] });
  } finally { await page.close(); }
});

test("concurrent local retries serialize to one record and uncertain receipts never redirect after navigation", async () => {
  const localPage = await appPage();
  try {
    const result = await localPage.evaluate(async () => {
      const { db, postToLocal } = await import("/src/db/database.js");
      const domainIds = (await db.domains.toArray()).slice(0, 2).map(d => d.id);
      const input = { action: "addMilestone", requestId: crypto.randomUUID(), domainIds, title: "Synthetic concurrent create", date: "2026-03-31", status: "Completed", impact: "Synthetic impact." };
      const receipts = await Promise.all([postToLocal(input), postToLocal(input), postToLocal(input)]);
      return { receipts, count: await db.milestones.filter(item => item.title === input.title).count() };
    });
    assert.equal(result.count, 1);
    assert.equal(new Set(result.receipts.map(receipt => receipt.id)).size, 1);
  } finally { await localPage.close(); }
  let release, posted;
  const started = new Promise(resolve => { posted = resolve; });
  const page = await remotePage(async route => {
    if (route.request().method() === "GET") return route.fulfill({ json: empty() });
    const request = route.request().postDataJSON();
    posted();
    await new Promise(resolve => { release = resolve; });
    return route.fulfill({ json: { ok: true, milestonesVersion: 1, action: request.action, requestId: request.requestId, id: `MS-${randomUUID()}`, updatedAt: new Date().toISOString(), deleted: false } });
  });
  try {
    await page.getByText("Your milestone history starts here").waitFor();
    await page.getByRole("button", { name: "+ Add milestone", exact: true }).click();
    await fillForm(page);
    await page.getByRole("button", { name: "Save milestone", exact: true }).click();
    await started;
    await page.evaluate(() => { location.hash = "#/roadmap"; });
    await page.waitForFunction(() => document.title.startsWith("Roadmap"));
    release();
    await page.waitForFunction(() => !Object.keys(sessionStorage).some(key => key.startsWith("milestone-pending:")));
    assert.match(page.url(), /#\/roadmap$/);
  } finally { release?.(); await page.close(); }
});

test("desktop and narrow dark dialogs support keyboard, outside dismissal and screenshots of synthetic local data", async () => {
  const page = await appPage();
  try {
    if (process.env.MILESTONE_EVIDENCE_DIR) await page.screenshot({ path: join(process.env.MILESTONE_EVIDENCE_DIR, "milestones-app-overview.png") });
    await page.getByRole("button", { name: "All domains", exact: true }).click();
    await page.getByRole("heading", { name: "Milestones", exact: true }).last().click();
    assert.equal(await page.locator("#milestone-domain-options").count(), 0);
    await page.getByRole("button", { name: "Q3", exact: true }).click();
    const card = page.locator(".milestone-card").first();
    await card.click();
    await page.locator(".milestone-dialog").waitFor();
    if (process.env.MILESTONE_EVIDENCE_DIR) await page.screenshot({ path: join(process.env.MILESTONE_EVIDENCE_DIR, "milestones-app-detail.png") });
    await page.getByRole("button", { name: "Delete milestone", exact: true }).focus();
    await page.keyboard.press("Tab");
    assert.equal(await page.getByRole("button", { name: "Close milestone panel", exact: true }).evaluate(el => el === document.activeElement), true);
    await page.keyboard.press("Escape");
    await page.locator(".milestone-dialog").waitFor({ state: "detached" });
    assert.equal(await card.evaluate(el => el === document.activeElement), true);
    await page.setViewportSize({ width: 390, height: 844 });
    await page.evaluate(() => { document.documentElement.dataset.theme = "dark"; });
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
    await card.click();
    await page.locator(".milestone-dialog").waitFor();
    assert.equal(await page.locator(".milestone-dialog").evaluate(el => el.scrollWidth <= el.clientWidth), true);
    if (process.env.MILESTONE_EVIDENCE_DIR) await page.screenshot({ path: join(process.env.MILESTONE_EVIDENCE_DIR, "milestones-app-mobile-dark.png") });
    await page.keyboard.press("Escape");
    await page.locator(".milestone-dialog").waitFor({ state: "detached" });
    await page.getByRole("button", { name: "+ Add milestone", exact: true }).click();
    await page.locator(".milestone-dialog").waitFor();
    assert.equal(await page.locator(".milestone-dialog").evaluate(el => el.scrollWidth <= el.clientWidth), true);
  } finally { await page.close(); }
});
