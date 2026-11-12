import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { createServer } from "vite";

let server;
let view;
let utils;

before(async () => {
  server = await createServer({ server: { middlewareMode: true }, appType: "custom" });
  view = (await server.ssrLoadModule("/src/components/views/IncidentsView.jsx")).default;
  utils = await server.ssrLoadModule("/src/utils/incidentUtils.js");
});

after(async () => {
  await server?.close();
});

const row = (id, type, cause, start, domain = "RLP") => ({
  id, type, cause, start, domain, title: id, status: "Resolved",
});
const data = {
  incidents: [
    row("release", "Track Event", " Release ", "2026-11-02"),
    row("legacy", "Release", "", "2026-11-03"),
    row("maintenance", "Track Event", "Scheduled Maintenance", "2026-11-04"),
    row("hotfix", "Track Event", "Hotfix", "2026-11-05"),
    row("outage", "Outage", "Release", "2026-11-06"),
    row("other-domain", "Track Event", "Release", "2026-10-01", "RLMS"),
  ],
};

test("release summary counts release causes and legacy types within the existing filters", () => {
  const entries = utils.getIncidents(data);
  const stats = (filters = {}) => utils.computeIncidentStats(
    utils.filterIncidents(entries, { ...utils.INITIAL_INCIDENT_FILTERS, ...filters }), entries,
  );
  assert.equal(stats().releaseCount, 3);
  assert.equal(stats({ year: "2026", month: "11", domains: new Set(["rlp"]) }).releaseCount, 2);
  assert.equal(stats({ search: "legacy" }).releaseCount, 1);
  assert.equal(stats({ causes: { "Track Event": new Set(["Release"]) } }).releaseCount, 2);
  assert.equal(stats({ types: new Set(["Outage"]) }).releaseCount, 0);
  assert.equal(stats({ causes: { "Track Event": new Set(["Scheduled Maintenance"]) } }).releaseCount, 0);
  assert.equal(stats().incidentCount, 1);
});

test("release card is next to active incidents and shows the count or empty state", () => {
  const render = (incidents) => renderToStaticMarkup(createElement(view, { data: { incidents } }));
  const html = render(data.incidents);
  const labels = [...html.matchAll(/class="ops-stat__label">([^<]+)<\/span>/g)].map((match) => match[1]);
  assert.equal(labels[0], "Active incidents");
  assert.match(labels[1], /^Releases · /);
  assert.match(html, /Releases · [^<]+<\/span><\/div><span class="ops-stat__value">3<\/span>/);
  assert.match(render([data.incidents[2]]), /Releases · [^<]+<\/span><\/div><span class="ops-stat__value">0<\/span><span class="ops-stat__hint">No releases in this scope/);
});
