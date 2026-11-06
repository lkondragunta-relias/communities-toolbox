import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { after, before, test } from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { chromium } from "playwright";
import { createServer } from "vite";

const today = new Date(2026, 10, 6);
const item = (id, teams, status = "Done", confidence = "Committed") => ({
  id, name: id, teams, status, confidence, priority: "Revenue",
  timeline: ["2026-10-01", "2026-12-31"], color: "#4caf50",
});
const items = [
  item("Headless done", ["headless"]),
  item("Other done", ["other"]),
  item("Shared done", ["other", "headless"]),
  item("Unassigned done", []),
  item("Legacy shared done", "other; headless"),
  ...["In Progress", "Close to done", "At Risk", "Future", "Paused"].map(
    (status) => item(`Other ${status}`, ["other"], status),
  ),
  item("Other likely", ["other"], "Future", "Likely"),
  item("Other exploring", ["other"], "Future", "Exploring"),
  item("Headless likely", ["headless"], "Future", "Likely"),
  item("Headless exploring", ["headless"], "Future", "Exploring"),
];
const data = {
  domains: [{ id: "demo", name: "Demo domain" }, { id: "second", name: "Second domain" }],
  teams: [{ id: "headless", label: "Headless Heros" }, { id: "other", label: "Clearly Undefined" }],
  demo: items,
  second: [item("Second domain done", ["headless"])],
};
const css = readFileSync(new URL("../src/styles/roadmap.css", import.meta.url), "utf8");
let server;
let browser;
let page;
let Grid;
let Board;
let Table;
let utils;

before(async () => {
  server = await createServer({ server: { middlewareMode: true }, appType: "custom" });
  Grid = (await server.ssrLoadModule("/src/components/RoadmapGrid.jsx")).default;
  Board = (await server.ssrLoadModule("/src/components/RoadmapBoard.jsx")).default;
  Table = (await server.ssrLoadModule("/src/components/ProjectsTable.jsx")).default;
  utils = await server.ssrLoadModule("/src/utils/roadmapUtils.js");
  browser = await chromium.launch();
  page = await browser.newPage({ viewport: { width: 1440, height: 1100 }, reducedMotion: "reduce" });
  page.setDefaultTimeout(5000);
});

after(async () => {
  await browser?.close();
  await server?.close();
});

async function render(Component, filters = {}, theme = "light") {
  const filterState = { ...utils.INITIAL_FILTER_STATE, ...filters };
  const markup = renderToStaticMarkup(createElement(Component, {
    data, filterState, today,
    quarters: utils.setQuartersFromData({ quarters: utils.buildFocusQuartersRaw(today) }),
    onShowTooltip: () => {}, onHideTooltip: () => {},
  }));
  await page.setContent(`<html data-theme="${theme}"><head><style>${css}</style></head>
    <body><main><h1>Roadmap team filtering</h1><p>${filters.teams ? [...filters.teams].join(", ") : "All teams"}</p>${markup}</main></body></html>`);
}

async function cardStyle(name) {
  return page.locator(".initiative").filter({
    has: page.locator(".initiative__name", { hasText: new RegExp(`^${name}$`) }),
  }).evaluate((element) => {
    const style = getComputedStyle(element);
    return {
      dimmed: element.classList.contains("initiative--dimmed"),
      opacity: style.opacity, filter: style.filter, color: style.color,
      background: style.backgroundImage === "none" ? style.backgroundColor : style.backgroundImage,
      border: style.borderTopWidth,
      done: element.querySelector(".done-toggle")?.classList.contains("is-done") || false,
    };
  });
}

async function assertDimmed(name) {
  const style = await cardStyle(name);
  assert.equal(style.dimmed, true, name);
  assert.equal(style.opacity, "0.35", `${name}: entire card and checkmark must fade`);
  assert.equal(style.filter, "grayscale(1)", `${name}: status colors must be neutral`);
  assert.equal(style.border, "0px", `${name}: status/confidence border must not override filtering`);
}

async function assertProminent(name) {
  const style = await cardStyle(name);
  assert.equal(style.dimmed, false, name);
  assert.equal(style.opacity, "1", name);
  assert.equal(style.filter, "none", name);
  assert.notEqual(style.border, "0px", name);
}

for (const theme of ["light", "dark"]) {
  test(`timeline team mismatch wins over every status and confidence in ${theme} theme`, async () => {
    await render(Grid, {}, theme);
    const baseline = await cardStyle("Headless done");
    await render(Grid, { teams: new Set(["headless"]) }, theme);
    for (const entry of items.filter((entry) => entry.id.startsWith("Other") || entry.id.startsWith("Unassigned"))) {
      await assertDimmed(entry.id);
    }
    for (const name of ["Headless done", "Shared done", "Legacy shared done", "Headless likely", "Headless exploring"]) {
      await assertProminent(name);
    }
    const matched = await cardStyle("Headless done");
    assert.equal(matched.background, baseline.background, "matching Done retains its green status background");
    assert.equal(matched.color, baseline.color, "matching Done retains normal text");
    assert.equal(matched.done, true, "matching Done keeps its checkmark");
    assert.equal((await cardStyle("Other done")).done, true, "filtering does not change completed status");
    if (theme === "light" && process.env.ROADMAP_EVIDENCE_DIR) {
      await page.screenshot({ path: join(process.env.ROADMAP_EVIDENCE_DIR, "roadmap-headless-after.png"), fullPage: true });
    }
  });
}

test("switching team and resetting All teams restores status and confidence styles", async () => {
  await render(Grid);
  const baseline = new Map();
  for (const entry of items) baseline.set(entry.id, await cardStyle(entry.id));
  await render(Grid, { teams: new Set(["other"]) });
  await assertDimmed("Headless done");
  await assertDimmed("Unassigned done");
  await assertProminent("Other done");
  await assertProminent("Shared done");
  if (process.env.ROADMAP_EVIDENCE_DIR) {
    await page.screenshot({ path: join(process.env.ROADMAP_EVIDENCE_DIR, "roadmap-other-after.png"), fullPage: true });
  }
  await render(Grid, { teams: new Set() });
  for (const entry of items) assert.deepEqual(await cardStyle(entry.id), baseline.get(entry.id), entry.id);
  if (process.env.ROADMAP_EVIDENCE_DIR) {
    await page.screenshot({ path: join(process.env.ROADMAP_EVIDENCE_DIR, "roadmap-all-teams.png"), fullPage: true });
  }
});

test("team matching combines with status, priority, confidence, initiative and domain filters", async () => {
  await render(Grid, { teams: new Set(["headless"]), statuses: new Set(["Done"]) });
  await assertProminent("Headless done");
  await assertDimmed("Other done");
  await assertDimmed("Headless likely");
  for (const filters of [
    { priorities: new Set(["Tech Debt"]) },
    { confidences: new Set(["Likely"]) },
    { initiatives: new Set(["Shared done"]) },
  ]) {
    await render(Grid, { teams: new Set(["headless"]), ...filters });
    await assertDimmed("Headless done");
    await assertDimmed("Other done");
  }
  await render(Grid, {
    domains: new Set(["demo"]), teams: new Set(["headless"]), statuses: new Set(["Done"]),
    priorities: new Set(["Revenue"]), confidences: new Set(["Committed"]),
  });
  await assertProminent("Headless done");
  await assertProminent("Shared done");
  assert.equal(await page.locator(".initiative__name", { hasText: "Second domain done" }).count(), 0);
});

for (const surface of ["board", "list"]) {
  test(`${surface} hides nonmatching Done and shared cards use any assigned team`, async () => {
    const Component = surface === "board" ? Board : Table;
    const selector = surface === "board" ? ".board-card__name" : ".projects-table tbody tr";
    await render(Component, { teams: new Set(["headless"]) });
    const names = await page.locator(selector).allTextContents();
    assert.ok(names.some((name) => name.includes("Headless done")));
    assert.ok(names.some((name) => name.includes("Shared done")));
    assert.ok(names.some((name) => name.includes("Legacy shared done")));
    assert.ok(!names.some((name) => name.includes("Other done") || name.includes("Unassigned done")));
    await render(Component, { teams: new Set(["headless"]), statuses: new Set(["Future"]) });
    assert.ok(!(await page.locator(selector).allTextContents()).some((name) => name.includes("done")));
    await render(Component);
    const all = await page.locator(selector).allTextContents();
    assert.ok(all.some((name) => name.includes("Other done")));
    assert.ok(all.some((name) => name.includes("Unassigned done")));
  });
}
