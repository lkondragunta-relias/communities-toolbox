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

const progressItem = (id, status, progress) => ({ ...item(id, ["other"], status), progress });
const progressData = {
  domains: [{ id: "demo", name: "Demo domain" }],
  teams: data.teams,
  demo: [
    progressItem("Ninety", "In Progress", 90),
    progressItem("Half at risk", "At Risk", 50),
    progressItem("Zero", "In Progress", 0),
    progressItem("Future stale", "Future", 40),
    progressItem("Done stale", "Done", 10),
  ],
};

async function renderProgress(Component) {
  const markup = renderToStaticMarkup(createElement(Component, {
    data: progressData, filterState: utils.INITIAL_FILTER_STATE, today,
    quarters: utils.setQuartersFromData({ quarters: utils.buildFocusQuartersRaw(today) }),
    onShowTooltip: () => {}, onHideTooltip: () => {},
  }));
  await page.setContent(`<html data-theme="light"><head><style>${css}</style></head><body><main>${markup}</main></body></html>`);
}

const fillRatio = (name, bar, fill) => page.locator(bar).filter({ hasText: new RegExp(`^${name}$|${name}`) }).first()
  .evaluate((el, fillSel) => {
    const f = el.querySelector(fillSel);
    if (!f) return null;
    const track = fillSel === ".initiative__progress" ? el : f.parentElement;
    return Math.round((f.getBoundingClientRect().width / track.clientWidth) * 100);
  }, fill);

test("timeline bars fill with light blue to the saved progress for started work", async () => {
  await renderProgress(Grid);
  assert.equal(await fillRatio("Ninety", ".initiative", ".initiative__progress"), 90);
  assert.equal(await fillRatio("Half at risk", ".initiative", ".initiative__progress"), 50);
  for (const name of ["Zero", "Future stale", "Done stale"]) {
    assert.equal(await fillRatio(name, ".initiative", ".initiative__progress"), null, name);
  }
  const fill = await page.locator(".initiative__progress").first().evaluate((el) => getComputedStyle(el).backgroundColor);
  assert.match(fill, /59, 130, 246|0\.231|oklab|color\(srgb 0\.23/, "fill is a light blue tint");
  const name = await page.locator(".initiative__name", { hasText: "Ninety" }).evaluate((el) => getComputedStyle(el).position);
  assert.equal(name, "relative", "label stays above the fill");
});

test("board cards show a progress strip for started work only", async () => {
  await renderProgress(Board);
  assert.equal(await fillRatio("Ninety", ".board-card", ".board-card__progress-fill"), 90);
  assert.equal(await page.locator(".board-card", { hasText: "Ninety" }).locator("[role=progressbar]").getAttribute("aria-valuenow"), "90");
  for (const name of ["Zero", "Future stale", "Done stale"]) {
    assert.equal(await fillRatio(name, ".board-card", ".board-card__progress-fill"), null, name);
  }
});

test("progress parsing and form validation accept only whole percents 0-100", async () => {
  for (const [input, expected] of [["90", 90], ["0", 0], ["100", 100], [" 45% ", 45], [7, 7]]) {
    assert.equal(utils.parseProgress(input), expected, String(input));
  }
  for (const input of ["", "101", "-5", "12.5", "abc", null, undefined]) {
    assert.equal(utils.parseProgress(input), null, String(input));
  }
  assert.equal(utils.displayProgress({ status: "Done", progress: 10 }), 100);
  assert.equal(utils.displayProgress({ status: "In Progress", progress: 250 }), 100);
  assert.equal(utils.displayProgress({ status: "In Progress" }), 0);
  assert.equal(utils.isProgressTrackable("In Progress"), true);
  assert.equal(utils.isProgressTrackable("Close to done"), true);
  for (const status of ["Done", "Future", ""]) assert.equal(utils.isProgressTrackable(status), false, status);

  const { validateInitiativeForm } = await server.ssrLoadModule("/src/services/sheetsApi.js");
  const base = {
    domain: "demo", id: "X1", name: "X", description: "d",
    timelineStart: "2026-10-01", timelineEnd: "2026-12-31", teams: [],
  };
  const check = (fields) => validateInitiativeForm({ ...base, ...fields }, [], [], []).errors.progress;
  assert.equal(check({ status: "In Progress", progress: "90" }), undefined);
  assert.match(check({ status: "In Progress", progress: "150" }), /0 to 100/);
  assert.match(check({ status: "In Progress", progress: "" }), /0 to 100/);
  assert.equal(check({ status: "Done", progress: "150" }), undefined, "hidden field is not validated");
  assert.equal(check({ status: "In Progress" }), undefined, "omitted progress keeps existing value");
});

test("add form omits the ID while edit retains the existing read-only ID", async () => {
  const AdminModal = (await server.ssrLoadModule("/src/components/AdminModal.jsx")).default;
  const props = { domains: ["demo"], adminToken: "test", onClose: () => {} };
  const add = renderToStaticMarkup(createElement(AdminModal, props));
  assert.doesNotMatch(add, />ID <span/);
  const edit = renderToStaticMarkup(createElement(AdminModal, {
    ...props, mode: "edit", initialValues: {
      domain: "demo", id: "Legacy ID", jiraEpicLink: "https://jira.example/browse/EPIC-1",
    },
  }));
  assert.match(edit, /value="Legacy ID"/);
  assert.match(edit, /disabled=""/);
  assert.match(add, /Jira epic link \(optional\)/);
  assert.match(edit, /value="https:\/\/jira\.example\/browse\/EPIC-1"/);

  const { validateInitiativeForm } = await server.ssrLoadModule("/src/services/sheetsApi.js");
  const form = {
    domain: "demo", name: "Example", description: "Description",
    timelineStart: "2026-10-01", timelineEnd: "2026-12-31",
  };
  assert.equal(validateInitiativeForm(form, [], [], [], { requireId: false }).valid, true);
  assert.equal(validateInitiativeForm(form, [], [], []).errors.id, "ID is required.");
  assert.equal(validateInitiativeForm({ ...form, jiraEpicLink: "" }, [], [], [], { requireId: false }).valid, true);
  assert.match(
    validateInitiativeForm({ ...form, jiraEpicLink: "EPIC-1" }, [], [], [], { requireId: false }).errors.jiraEpicLink,
    /http:\/\/ or https:\/\//
  );
});

test("flat roadmap data and initiative details preserve and display optional Jira epic links", async () => {
  const { normalizeRemotePayload } = await server.ssrLoadModule("/src/services/sheetsApi.js");
  const payload = {
    projects: [
      { domain: "demo", id: "linked", jiraEpicLink: "https://jira.example/browse/EPIC-1" },
      { domain: "demo", id: "blank" },
    ],
    domains: [{ id: "demo", name: "Demo" }],
  };
  const normalized = normalizeRemotePayload(payload);
  assert.equal(normalized.demo[0].jiraEpicLink, "https://jira.example/browse/EPIC-1");
  assert.equal(normalized.demo[1].jiraEpicLink, "");

  const ProjectDetail = (await server.ssrLoadModule("/src/components/ProjectDetail.jsx")).default;
  const details = renderToStaticMarkup(createElement(ProjectDetail, {
    data: {
      demo: [{ ...item("linked", [], "Future"), jiraEpicLink: "https://jira.example/browse/EPIC-1" }],
      teams: [], statuses: [], priorities: [],
    },
    selected: { domain: "demo", id: "linked" },
    canEdit: false, canDelete: false, onClose: () => {},
  }));
  assert.match(details, /Jira epic/);
  assert.match(details, /href="https:\/\/jira\.example\/browse\/EPIC-1"/);
});
