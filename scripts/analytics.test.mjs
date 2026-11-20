import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";
import { chromium } from "playwright";
import { createServer } from "vite";
import { comparisonChange, reportingDate, reportingWindows } from "../src/utils/analytics.js";
import { academy, analyticsReader, parseDomains, refreshSnapshot as refresh, reportRequests, verifiedMappings } from "./analytics/snapshot.mjs";
import { applyReports, createReportPlan, createSnapshotStore } from "./analytics/refresh.mjs";
import { MAIN_ENDPOINT } from "../.github/skills/feedback-pipeline/scripts/feedback-api.mjs";

const now = new Date("2026-03-09T01:00:00Z");
const roster = async () => [{ id: "academy-fixture", name: "Relias Academy" }, { id: "unmapped-fixture", name: "Example Unmapped" }];
const mappings = new Map([["academy-fixture", academy]]);
const refreshSnapshot = options => refresh({ roster, mappings, ...options });
function memory() {
  let state = { version: 1, domains: [] };
  return { read: async () => state, write: async next => { state = next; } };
}
function fixture(property, payload) {
  const values = { sessions: "100", totalUsers: "80", newUsers: "40", purchaseRevenue: "62.7", ecommercePurchases: "3",
    sessionKeyEventRate: "0.025", averagePurchaseRevenue: "20.9" };
  return {
    metadata: { currencyCode: property.currency, timeZone: property.timeZone },
    dimensionHeaders: [{ name: "dateRange" }], metricHeaders: payload.metrics,
    rows: payload.dateRanges.map(range => ({
      dimensionValues: [{ value: range.name }],
      metricValues: payload.metrics.map(({ name }) => ({ value: values[name] })),
    })),
  };
}

test("calendar dates follow property time and align comparison weekdays across DST", () => {
  assert.equal(reportingDate(now, academy.timeZone), "2026-03-08");
  assert.deepEqual(reportingWindows("2026-03-08"), {
    day: { startDate: "2026-03-07", endDate: "2026-03-07" },
    prior_day: { startDate: "2026-02-28", endDate: "2026-02-28" },
    week: { startDate: "2026-03-01", endDate: "2026-03-07" },
    prior_week: { startDate: "2026-02-22", endDate: "2026-02-28" },
    yoy_day: { startDate: "2025-03-08", endDate: "2025-03-08" },
    yoy_week: { startDate: "2025-03-02", endDate: "2025-03-08" },
  });
  assert.equal(comparisonChange("sessionKeyEventRate", 0.02, 0), 2);
  assert.equal(comparisonChange("sessions", 15, 0), null);
});

test("refresh overwrites the six date windows without saving history and preserves good dates on failure", async () => {
  const store = memory();
  const sizes = [];
  const load = { store, now, warn: () => {}, gaReport: (property, payload) => {
    sizes.push(payload.dateRanges.length);
    return fixture(property, payload);
  } };
  const first = await refreshSnapshot(load);
  assert.deepEqual(sizes, [4, 2]);
  assert.deepEqual(Object.keys(first.domains[0].windows).sort(), ["day", "prior_day", "prior_week", "week", "yoy_day", "yoy_week"]);
  assert.equal(first.domains[0].id, "academy-fixture");
  assert.equal(first.domains[0].propertyId, academy.propertyId);
  assert.deepEqual(first.domains[1], { id: "unmapped-fixture", name: "Example Unmapped", status: "Unavailable", reason: "No verified GA4 mapping" });
  assert.equal(first.domains[0].windows.day.metrics.averagePurchaseRevenue, 20.9);
  first.domains[0].previousGood = { fetchedAt: first.domains[0].fetchedAt };
  const next = new Date("2026-03-09T21:00:00Z");
  const partial = await refreshSnapshot({ ...load, now: next, gaReport: (property, payload) => {
    if (payload.dateRanges.length === 2) throw new Error("baseline unavailable");
    return fixture(property, payload);
  } });
  assert.equal(partial.domains[0].status, "Partial");
  assert.equal(partial.domains[0].windows.yoy_day, undefined);
  assert.notEqual(partial.domains[0].windows.day.endDate, first.domains[0].windows.day.endDate);
  assert.equal(partial.domains[0].previousGood, undefined);
  partial.domains[0].previousGood = { fetchedAt: first.domains[0].fetchedAt };
  partial.domains[0].windows.archived_day = first.domains[0].windows.day;
  const failed = await refreshSnapshot({ ...load, now: new Date("2026-03-10T21:00:00Z"), gaReport() { throw new Error("failed"); } });
  assert.equal(failed.domains[0].status, "Stale");
  const { archived_day: archivedDay, ...latestWindows } = partial.domains[0].windows;
  assert.notEqual(failed.domains[0].windows.day.endDate, archivedDay.endDate);
  assert.deepEqual(failed.domains[0].windows, latestWindows);
  assert.equal(failed.domains[0].previousGood, undefined);
  assert.equal(failed.domains[0].fetchedAt, partial.domains[0].fetchedAt);
});

test("restricted GA4 results never become good snapshots", async () => {
  const store = memory();
  const state = await refreshSnapshot({ store, now, warn: () => {}, gaReport: (property, payload) => {
    const report = fixture(property, payload);
    report.metadata.schemaRestrictionResponse = { activeMetricRestrictions: [{ metricName: "purchaseRevenue" }] };
    return report;
  } });
  assert.equal(state.domains[0].status, "Unavailable");
  assert.equal(state.domains[0].windows, undefined);
});

test("reader denies access before reading and excludes previous snapshots from private no-store responses", async () => {
  const snapshot = await refreshSnapshot({ store: memory(), now, gaReport: fixture });
  snapshot.domains[0].previousGood = { windows: snapshot.domains[0].windows };
  let reads = 0;
  const reader = analyticsReader({ authorize: request => request.headers.get("test-auth") === "yes",
    store: { read() { reads++; return snapshot; } }, clock: () => new Date("2026-03-09T23:00:00Z") });
  const url = "https://toolbox.example/communities-toolbox/api/analytics";
  assert.equal((await reader(new Request(url))).status, 403);
  assert.equal((await reader(new Request(url, { method: "POST" }))).status, 405);
  assert.equal(reads, 0);
  const response = await reader(new Request(url, { headers: { "test-auth": "yes" } }));
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("cache-control"), "private, no-store");
  const { domains } = await response.json();
  assert.equal(domains[0].status, "Stale");
  assert.equal(domains[0].previousGood, undefined);
  assert.equal(domains[1].reason, "No verified GA4 mapping");
});

test("the roster uses stable IDs and rejects duplicates and unknown configured keys without overwriting the snapshot", async () => {
  assert.deepEqual(parseDomains([["Label", "Title"], ["New display name", " ACADEMY-FIXTURE "], ["", ""], ["", "OTHER"]]), [
    { id: "academy-fixture", name: "New display name" }, { id: "other", name: "OTHER" },
  ]);
  assert.throws(() => parseDomains([["ID"], ["A"], [" a "]]), /duplicate domain IDs/);
  await assert.rejects(refreshSnapshot({
    roster: async () => [{ id: "different-key", name: "Relias Academy" }],
    store: { read() { assert.fail("Invalid configuration should not reach snapshot storage"); } },
  }), /unknown Toolbox domain ID/);
});

test("the default refresh filters verified traffic scopes and leaves unverified commerce unavailable", async () => {
  const queried = [];
  const snapshot = await refresh({
    now, store: memory(),
    roster: async () => [...[...verifiedMappings.keys()].map(id => ({
      id, name: id === "relias-academy" ? "Renamed Academy" : id,
    })), { id: "academy-portals", name: "Relias Academy" }],
    gaReport(property, payload) {
      queried.push({ id: property.id, payload });
      return fixture(property, payload);
    },
  });
  const find = id => snapshot.domains.find(domain => domain.id === id);
  assert.equal(find("relias-academy").name, "Renamed Academy");
  assert.equal(find("relias-academy").status, "Reported");
  assert.equal(find("academy-portals").status, "Unavailable");
  assert.equal(find("academy-portals").windows, undefined);
  assert.ok(!queried.some(item => item.id === "academy-portals"));
  const reports = queried.filter(item => item.id === "woundcare-blog");
  assert.equal(reports.length, 2);
  for (const { payload } of reports) {
    assert.deepEqual(payload.metrics.map(metric => metric.name), ["sessions", "totalUsers", "newUsers"]);
    assert.deepEqual(payload.dimensionFilter.andGroup.expressions, [
      { filter: { fieldName: "streamId", stringFilter: { matchType: "EXACT", value: "2797075565" } } },
      { filter: { fieldName: "hostName", inListFilter: { values: ["blog.wcei.net"], caseSensitive: true } } },
    ]);
  }
  assert.equal(find("woundcare-blog").status, "Partial");
  assert.deepEqual(find("woundcare-blog").windows.yoy_week.metrics, {
    sessions: 100, totalUsers: 80, newUsers: 40, purchaseRevenue: null, ecommercePurchases: null,
    sessionKeyEventRate: null, averagePurchaseRevenue: null,
  });
});

const writerToken = "synthetic-writer-token-0123456789abcdef";
const readerToken = "synthetic-reader-token-0123456789abcdef";
async function sheetFixture() {
  let cell = "";
  let reads = 0;
  let writes = 0;
  const domains = await roster();
  const ctx = vm.createContext({
    PropertiesService: { getScriptProperties: () => ({ getProperty: key => ({
      ADMIN_TOKEN: "old-admin", ANALYTICS_WRITE_TOKEN: writerToken, ANALYTICS_READ_TOKEN: readerToken,
    })[key] }) },
    SpreadsheetApp: { getActiveSpreadsheet: () => ({
      getSheetByName(name) {
        assert.equal(name, "Analytics");
        return { getRange(row, col) {
          assert.deepEqual([row, col], [1, 1]);
          return {
            getFormula: () => "", getValue() { reads++; return cell; },
            setValue(value) { writes++; cell = value; },
          };
        } };
      },
    }), flush() {} },
    LockService: { getScriptLock: () => ({ waitLock() {}, releaseLock() {} }) },
    Utilities: { DigestAlgorithm: { SHA_256: "sha256" }, Charset: { UTF_8: "utf8" },
      computeDigest: (algorithm, value) => createHash(algorithm).update(value).digest(),
      base64Encode: value => Buffer.from(value).toString("base64"),
    },
  });
  vm.runInContext(readFileSync(new URL("./google-apps-script/Code.gs", import.meta.url), "utf8"), ctx);
  Object.assign(ctx, { readDomains_: () => domains, readRoadmap_: () => ({ domains }), jsonResponse: value => value });
  const post = body => ctx.doPost({ postData: { contents: JSON.stringify(body) } });
  const fetcher = async (url, options) => {
    assert.equal(url, MAIN_ENDPOINT);
    assert.equal(options.method, "POST");
    return Response.json(post(JSON.parse(options.body)));
  };
  return { ctx, post, fetcher, state: () => ({ cell, reads, writes }) };
}

test("Apps Script denies legacy tokens, restricts writer access, and does not expose Analytics via GET", async () => {
  const sheet = await sheetFixture();
  assert.equal(sheet.post({ action: "readAnalyticsSnapshot", analyticsToken: "old-admin" }).code, "AUTH");
  assert.equal(sheet.post({ action: "replaceAnalyticsSnapshot", analyticsToken: readerToken }).code, "AUTH");
  assert.equal(sheet.state().reads, 0);
  assert.equal(sheet.ctx.doGet({ parameter: { action: "readAnalyticsSnapshot" } }).snapshot, undefined);
  const store = createSnapshotStore({ endpoint: MAIN_ENDPOINT, token: writerToken, fetcher: sheet.fetcher });
  await store.read();
  const prior = sheet.post({ action: "readAnalyticsSnapshot", analyticsToken: writerToken });
  const snapshot = { version: 1, attemptedAt: now.toISOString(), domains: await roster() };
  await store.write(snapshot);
  const conflict = sheet.post({ action: "replaceAnalyticsSnapshot", analyticsToken: writerToken,
    expectedRevision: prior.revision, snapshot: JSON.stringify(snapshot) });
  assert.equal(conflict.code, "CONFLICT");
  assert.equal(sheet.state().writes, 1);
});

function mcpReports() {
  const plan = createReportPlan(now, mappings);
  const reports = reportRequests(academy, now).map((request, index) => {
    assert.deepEqual(plan.requests[index].args.metrics, request.metrics.map(metric => metric.name));
    const report = fixture(academy, request);
    return [plan.requests[index].id, {
      metadata: { currency_code: report.metadata.currencyCode, time_zone: report.metadata.timeZone },
      dimension_headers: report.dimensionHeaders, metric_headers: report.metricHeaders,
      rows: report.rows.map(row => ({ dimension_values: row.dimensionValues, metric_values: row.metricValues })),
    }];
  });
  return { runAt: plan.runAt, reports: Object.fromEntries(reports) };
}

test("the refresh leaves the existing cell untouched if every MCP report fails", async () => {
  const sheet = await sheetFixture();
  const store = createSnapshotStore({ endpoint: MAIN_ENDPOINT, token: writerToken, fetcher: sheet.fetcher });
  const run = mcpReports();
  await applyReports(run, { store, roster, clock: () => now, mappings });
  const { cell, writes } = sheet.state();
  await assert.rejects(applyReports({ ...run, reports: {} }, { store, roster, clock: () => now, mappings }),
    /ANALYTICS_NO_CURRENT_REPORTS/);
  assert.equal(sheet.state().cell, cell);
  assert.equal(sheet.state().writes, writes);
});

test("a lost write response is verified by reading the cell, without retrying the write", async () => {
  const sheet = await sheetFixture();
  const store = createSnapshotStore({ endpoint: MAIN_ENDPOINT, token: writerToken, async fetcher(url, options) {
    const response = await sheet.fetcher(url, options);
    if (JSON.parse(options.body).action === "replaceAnalyticsSnapshot") throw new Error("lost receipt");
    return response;
  } });
  await applyReports(mcpReports(), { store, roster, clock: () => now, mappings });
  assert.equal(sheet.state().writes, 1);
});

test("MCP reports feed the protected Analytics route and comparison controls", async () => {
  const keys = ["VITE_ADMIN_TOKEN", "VITE_PRIVATE_ANALYTICS"];
  const prior = Object.fromEntries(keys.map(key => [key, process.env[key]]));
  process.env.VITE_ADMIN_TOKEN = "analytics-browser-fixture";
  process.env.VITE_PRIVATE_ANALYTICS = "true";
  let server;
  let browser;
  try {
    const sheet = await sheetFixture();
    const config = { endpoint: MAIN_ENDPOINT, fetcher: sheet.fetcher };
    const store = createSnapshotStore({ ...config, token: writerToken });
    const run = mcpReports();
    assert.deepEqual(await applyReports(run, { store, roster, clock: () => now, mappings }), { domains: 2, incomplete: 0 });
    const snapshot = JSON.parse(sheet.state().cell);
    assert.equal(sheet.state().writes, 1);
    assert.deepEqual(Object.keys(snapshot.domains[0].windows).sort(), ["day", "prior_day", "prior_week", "week", "yoy_day", "yoy_week"]);

    const endpoint = "/communities-toolbox/api/analytics";
    const reader = analyticsReader({
      authorize: request => request.headers.get("authorization") === "Bearer browser-test-only",
      store: createSnapshotStore({ ...config, token: readerToken }), clock: () => now,
    });
    server = await createServer({
      server: { host: "127.0.0.1", port: 0 }, logLevel: "error",
      plugins: [{
        name: "analytics-test-endpoint",
        configureServer(vite) {
          vite.middlewares.use(endpoint, async (req, res) => {
            const response = await reader(new Request(`http://localhost${endpoint}`, { method: req.method, headers: req.headers }));
            res.writeHead(response.status, Object.fromEntries(response.headers));
            res.end(await response.text());
          });
        },
      }],
    });
    await server.listen();
    browser = await chromium.launch();
    const page = await browser.newPage({ viewport: { width: 390, height: 900 } });
    const origin = `http://127.0.0.1:${server.httpServer.address().port}`;
    const readsBeforeUnauthorized = sheet.state().reads;
    const denied = await page.request.get(`${origin}${endpoint}`);
    assert.equal(denied.status(), 403);
    assert.equal(await denied.text(), "");
    assert.equal(sheet.state().reads, readsBeforeUnauthorized);
    await page.route(`${origin}${endpoint}`, route => route.continue({
      headers: { ...route.request().headers(), authorization: "Bearer browser-test-only" },
    }));
    await page.goto(`${origin}/communities-toolbox/#/analytics`);
    await page.getByLabel("Admin password").fill("analytics-browser-fixture");
    const responsePromise = page.waitForResponse(`${origin}${endpoint}`);
    await page.getByRole("button", { name: "Unlock site" }).click();
    const response = await responsePromise;
    assert.equal(response.status(), 200);
    assert.equal(response.headers()["cache-control"], "private, no-store");
    assert.ok(sheet.state().reads > readsBeforeUnauthorized);
    const row = page.getByRole("row").filter({ hasText: "Relias Academy" });
    await row.waitFor();
    assert.match(await row.textContent(), /Mar 7, 2026.*Feb 28, 2026/);
    assert.match(await row.textContent(), /\$20\.90/);
    assert.equal(await row.getByRole("link").getAttribute("href"), academy.url);
    const unmapped = page.getByRole("row").filter({ hasText: "Example Unmapped" });
    assert.match(await unmapped.textContent(), /Unavailable.*No verified GA4 mapping/);
    assert.equal(await unmapped.getByRole("link").count(), 0);
    await page.getByRole("button", { name: "Last 7 days" }).click();
    await page.getByLabel("Compare to").selectOption("yoy");
    assert.match(await row.textContent(), /Mar 1.*7, 2026.*Mar 2.*8, 2025/);
    await page.getByLabel("Compare to").selectOption("off");
    assert.doesNotMatch(await row.textContent(), / vs\. /);
    const scroll = page.getByRole("region", { name: /Domain metrics/ });
    assert.equal(await scroll.evaluate(el => el.scrollWidth > el.clientWidth), true);
  } finally {
    await browser?.close();
    await server?.close();
    for (const key of keys) {
      if (prior[key] === undefined) delete process.env[key];
      else process.env[key] = prior[key];
    }
  }
});
