import assert from "node:assert/strict";
import test from "node:test";
import { chromium } from "playwright";
import { createServer } from "vite";
import { comparisonChange, reportingDate, reportingWindows } from "../src/utils/analytics.js";
import { academy, analyticsReader, googleAnalyticsAdapters, parseDomains, refreshSnapshot as refresh } from "./analytics/snapshot.mjs";

const now = new Date("2026-03-09T01:00:00Z");
const roster = async () => [{ id: "academy-fixture", name: "Relias Academy" }, { id: "unmapped-fixture", name: "Example Unmapped" }];
const mappings = new Map([["academy-fixture", academy]]);
const refreshSnapshot = options => refresh({ roster, mappings, ...options });
function memory() {
  let state = { version: 1, domains: [] };
  return { read: async () => state, write: async next => { state = next; } };
}
function fixture(property, payload) {
  return {
    metadata: { currencyCode: property.currency, timeZone: property.timeZone },
    dimensionHeaders: [{ name: "dateRange" }], metricHeaders: payload.metrics,
    rows: payload.dateRanges.map(range => ({
      dimensionValues: [{ value: range.name }],
      metricValues: ["100", "80", "40", "62.7", "3", "0.025", "20.9"].map(value => ({ value })),
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

test("refresh maps both report batches, retains one previous snapshot and preserves good dates on failure", async () => {
  const store = memory();
  const sizes = [];
  const load = { store, now, warn: () => {}, gaReport: (property, payload) => {
    sizes.push(payload.dateRanges.length);
    return fixture(property, payload);
  } };
  const first = await refreshSnapshot(load);
  assert.deepEqual(sizes, [4, 2]);
  assert.equal(first.domains[0].id, "academy-fixture");
  assert.equal(first.domains[0].propertyId, academy.propertyId);
  assert.deepEqual(first.domains[1], { id: "unmapped-fixture", name: "Example Unmapped", status: "Unavailable", reason: "No verified GA4 mapping" });
  assert.equal(first.domains[0].windows.day.metrics.averagePurchaseRevenue, 20.9);
  const next = new Date("2026-03-09T21:00:00Z");
  const partial = await refreshSnapshot({ ...load, now: next, gaReport: (property, payload) => {
    if (payload.dateRanges.length === 2) throw new Error("baseline unavailable");
    return fixture(property, payload);
  } });
  assert.equal(partial.domains[0].status, "Partial");
  assert.equal(partial.domains[0].windows.yoy_day, undefined);
  assert.deepEqual(partial.domains[0].previousGood.windows, first.domains[0].windows);
  const failed = await refreshSnapshot({ ...load, now: new Date("2026-03-10T21:00:00Z"), gaReport() { throw new Error("failed"); } });
  assert.equal(failed.domains[0].status, "Stale");
  assert.deepEqual(failed.domains[0].windows, partial.domains[0].windows);
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

test("the Toolbox workbook is used only for the existing Domains tab", async () => {
  assert.throws(() => googleAnalyticsAdapters({ spreadsheetId: "same", domainsSpreadsheetId: "same" }), /separate spreadsheet/);
  const { roster } = googleAnalyticsAdapters({ spreadsheetId: "private", domainsSpreadsheetId: "toolbox", getAccessToken: () => "fixture-token",
    fetchImpl: async (url, options) => {
      assert.match(url, /\/spreadsheets\/toolbox\/values\/Domains$/);
      assert.equal(options.method ?? "GET", "GET");
      return Response.json({ values: [["ID", "Name"], ["domain-key", "Toolbox Domain"]] });
    } });
  assert.deepEqual(await roster(), [{ id: "domain-key", name: "Toolbox Domain" }]);
});

test("the Sheets adapter writes the complete snapshot without exporting its previous version", async () => {
  const requests = [];
  const { store } = googleAnalyticsAdapters({ getAccessToken: () => "fixture-token", spreadsheetId: "fixture",
    fetchImpl: async (url, options) => {
      requests.push({ url, options });
      return Response.json({});
    } });
  assert.deepEqual(await store.read(), { version: 1, domains: [] });
  const snapshot = { version: 1, domains: [] };
  await store.write(snapshot);
  assert.match(requests[1].url, /Analytics!A1\?valueInputOption=RAW$/);
  assert.equal(requests[1].options.method, "PUT");
  assert.deepEqual(JSON.parse(requests[1].options.body), { values: [[JSON.stringify(snapshot)]] });
});

test("the Analytics route shows private snapshots and switches date and comparison controls", async () => {
  const keys = ["VITE_ADMIN_TOKEN", "VITE_PRIVATE_ANALYTICS"];
  const prior = Object.fromEntries(keys.map(key => [key, process.env[key]]));
  process.env.VITE_ADMIN_TOKEN = "analytics-browser-fixture";
  process.env.VITE_PRIVATE_ANALYTICS = "true";
  let server;
  let browser;
  try {
    server = await createServer({ server: { host: "127.0.0.1", port: 0 }, logLevel: "error" });
    await server.listen();
    const snapshot = await refreshSnapshot({ store: memory(), now, gaReport: fixture });
    browser = await chromium.launch();
    const page = await browser.newPage({ viewport: { width: 390, height: 900 } });
    const origin = `http://127.0.0.1:${server.httpServer.address().port}`;
    await page.route(`${origin}/communities-toolbox/api/analytics`, route => route.fulfill({ json: snapshot }));
    await page.goto(`${origin}/communities-toolbox/#/analytics`);
    await page.getByLabel("Admin password").fill("analytics-browser-fixture");
    await page.getByRole("button", { name: "Unlock site" }).click();
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
