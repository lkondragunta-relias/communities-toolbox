/**
 * Real in-browser database (IndexedDB via Dexie).
 *
 * This is the app's source of truth while running locally. It exposes:
 *   - The roadmap contract used by sheetsApi.js: getRoadmap() / postToLocal()
 *   - Site + Cookiebot-report functions used by the Sites view.
 *
 * To move to a Microsoft (SharePoint/Excel) backend later, implement the same
 * GET/POST contract remotely and flip VITE_DATA_SOURCE=remote — no UI changes.
 */
import Dexie from "dexie";
import { DEFAULT_STATUSES } from "../config/statusConfig";
import { DEFAULT_PRIORITIES } from "../config/priorityConfig";

export const LOCAL_ADMIN_TOKEN =
  (import.meta.env.VITE_LOCAL_ADMIN_TOKEN || "local-dev").trim();

export const db = new Dexie("roadmap_app");

db.version(1).stores({
  // key = `${domain}::${id}` (unique); indexes on domain + id for lookups.
  projects: "key, domain, id",
  teams: "id",
  sites: "++id, name",
  reports: "++id, siteId, uploadedAt",
});

// v2 adds editable taxonomy: domains, statuses, priorities.
db.version(2)
  .stores({
    domains: "id",
    statuses: "id, order",
    priorities: "id, order",
  })
  .upgrade(async (tx) => {
    const projects = await tx.table("projects").toArray();
    const domainIds = [...new Set(projects.map((p) => p.domain))];
    if (domainIds.length === 0) SEED_DOMAINS.forEach((d) => domainIds.push(d.id));
    await tx.table("domains").bulkAdd(
      domainIds.map((id) => ({ id, name: id }))
    );
    await tx.table("statuses").bulkAdd(SEED_STATUSES.map((s) => ({ ...s })));
    await tx.table("priorities").bulkAdd(SEED_PRIORITIES.map((p) => ({ ...p })));
  });

// v3 adds a cache store (key/value blobs) for the stale-while-revalidate layer
// used in remote mode — caches the last roadmap payload fetched from Google Sheets.
db.version(3).stores({ cache: "key" });

function projectKey(domain, id) {
  return `${String(domain).toLowerCase()}::${String(id)}`;
}

function slug(value) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

const SEED_TEAMS = [
  { id: "core", label: "Core Eng", color: "#8b5cf6" },
  { id: "design", label: "Design", color: "#ec4899" },
  { id: "data", label: "Data", color: "#14b8a6" },
  { id: "qa", label: "QA", color: "#f97316" },
];

const SEED_PROJECTS = [
  { domain: "platform", id: "PLAT-1", name: "Auth revamp", description: "Replace legacy auth with SSO and MFA across all apps.", timeline: ["2026-01-12", "2026-03-28"], status: "In Progress", teams: ["core"], owner: "Jane Doe", priority: "High", link: "https://example.com/projects/plat-1", progress: 45 },
  { domain: "platform", id: "PLAT-2", name: "API gateway", description: "Centralize routing, rate limiting, and observability.", timeline: ["2026-03-02", "2026-06-30"], status: "Future", teams: ["core", "data"], owner: "Sam Lee", priority: "Medium", link: "", progress: 0 },
  { domain: "platform", id: "PLAT-3", name: "Cost optimization", description: "Right-size infrastructure and cut idle spend.", timeline: ["2026-07-01", "2026-09-15"], status: "At Risk", teams: ["core"], owner: "Priya N.", priority: "High", link: "", progress: 10 },
  { domain: "marketing", id: "MKT-1", name: "Brand refresh", description: "New visual identity, logo, and site theme.", timeline: ["2026-02-01", "2026-04-30"], status: "Close to done", teams: ["design"], owner: "Alex Park", priority: "Medium", link: "https://example.com/projects/mkt-1", progress: 80 },
  { domain: "marketing", id: "MKT-2", name: "Q3 campaign", description: "Multi-channel launch campaign for the new release.", timeline: ["2026-06-15", "2026-09-30"], status: "Future", teams: ["design", "data"], owner: "Jordan Kim", priority: "Low", link: "", progress: 0 },
  { domain: "mobile", id: "MOB-1", name: "Offline mode", description: "Local caching and sync for spotty connectivity.", timeline: ["2026-01-20", "2026-05-10"], status: "In Progress", teams: ["core", "qa"], owner: "Chris Wong", priority: "High", link: "", progress: 55 },
  { domain: "mobile", id: "MOB-2", name: "Accessibility pass", description: "WCAG AA audit and remediation across screens.", timeline: ["2026-05-01", "2026-07-31"], status: "Done", teams: ["design", "qa"], owner: "Robin Shah", priority: "Medium", link: "", progress: 100 },
];

const SEED_SITES = [
  { name: "Main marketing site", url: "https://www.example.com" },
  { name: "Docs portal", url: "https://docs.example.com" },
];

const SEED_DOMAINS = [
  { id: "platform", name: "Platform" },
  { id: "marketing", name: "Marketing" },
  { id: "mobile", name: "Mobile" },
];

const SEED_STATUSES = DEFAULT_STATUSES.map((s, i) => ({ ...s, order: i }));
const SEED_PRIORITIES = DEFAULT_PRIORITIES.map((p, i) => ({ ...p, order: i }));

db.on("populate", () => {
  db.teams.bulkAdd(SEED_TEAMS.map((t) => ({ ...t })));
  db.projects.bulkAdd(
    SEED_PROJECTS.map((p) => ({ ...p, key: projectKey(p.domain, p.id) }))
  );
  db.sites.bulkAdd(SEED_SITES.map((s) => ({ ...s })));
  db.domains.bulkAdd(SEED_DOMAINS.map((d) => ({ ...d })));
  db.statuses.bulkAdd(SEED_STATUSES.map((s) => ({ ...s })));
  db.priorities.bulkAdd(SEED_PRIORITIES.map((p) => ({ ...p })));
});

/** Strip the internal storage key + domain before handing a project to the UI. */
function toInitiative(row) {
  const { key, domain, ...rest } = row;
  void key;
  void domain;
  return rest;
}

/* ------------------------------- Roadmap ------------------------------- */

const byOrder = (a, b) => (a.order ?? 0) - (b.order ?? 0);

/** Assemble the nested payload the rest of the app expects. */
export async function getRoadmap() {
  const [projects, teams, domains, statuses, priorities, sites, reports] = await Promise.all([
    db.projects.toArray(),
    db.teams.toArray(),
    db.domains.toArray(),
    db.statuses.toArray(),
    db.priorities.toArray(),
    db.sites.toArray(),
    db.reports.toArray(),
  ]);

  const statusDefs = statuses.length ? statuses.slice().sort(byOrder) : DEFAULT_STATUSES;
  const priorityDefs = priorities.length ? priorities.slice().sort(byOrder) : DEFAULT_PRIORITIES;

  const payload = {
    teams: teams.map((t) => ({ ...t })),
    domains: domains.map((d) => ({ id: d.id, name: d.name || d.id })),
    statuses: statusDefs.map((s) => ({ id: s.id, label: s.label, color: s.color })),
    priorities: priorityDefs.map((p) => ({ id: p.id, label: p.label, color: p.color })),
  };

  // Ensure every defined domain appears, even with no projects yet.
  domains.forEach((d) => {
    payload[d.id] = [];
  });
  projects.forEach((row) => {
    if (!payload[row.domain]) payload[row.domain] = [];
    payload[row.domain].push(toInitiative(row));
  });

  payload.cookiebotSites = sites.map((s) => ({
    name: s.name,
    domain: s.domain || s.url || "",
  }));
  payload.cookiebotReports = reports.map((r) => ({
    site: r.site || "",
    fileName: r.fileName || "",
    uploaded: r.uploaded || r.uploadedAt || "",
    size: r.size || "",
    data: r.data || r.summary || null,
  }));
  return payload;
}

function parseTeams(value) {
  if (Array.isArray(value)) return value.map((t) => String(t).trim()).filter(Boolean);
  return String(value || "")
    .split(/[,;]/)
    .map((t) => t.trim())
    .filter(Boolean);
}

async function addProject(payload) {
  const domain = String(payload.team || "").trim().toLowerCase();
  const id = String(payload.id || "").trim();
  if (!domain) throw new Error("Domain is required.");
  if (!id) throw new Error("ID is required.");
  const key = projectKey(domain, id);
  if (await db.projects.get(key)) throw new Error(`ID already exists: ${id}`);
  await db.projects.add({
    key,
    domain,
    id,
    name: String(payload.name || "").trim(),
    description: String(payload.description || "").trim(),
    timeline: [String(payload.timelineStart || ""), String(payload.timelineEnd || "")],
    status: String(payload.status || "").trim(),
    teams: parseTeams(payload.teams),
    owner: String(payload.owner || "").trim(),
    priority: String(payload.priority || "").trim(),
    link: String(payload.link || "").trim(),
    progress: Number(payload.progress) || 0,
  });
  return { ok: true };
}

async function updateProject(payload) {
  const domain = String(payload.team || "").trim().toLowerCase();
  const id = String(payload.id || "").trim();
  const key = projectKey(domain, id);
  const row = await db.projects.get(key);
  if (!row) throw new Error(`ID not found: ${id}`);
  const next = {
    ...row,
    name: String(payload.name ?? row.name).trim(),
    description: String(payload.description ?? row.description).trim(),
    timeline: [
      String(payload.timelineStart || row.timeline?.[0] || ""),
      String(payload.timelineEnd || row.timeline?.[1] || ""),
    ],
    status: String(payload.status ?? row.status ?? "").trim(),
    teams: parseTeams(payload.teams),
    owner: String(payload.owner ?? row.owner ?? "").trim(),
    priority: String(payload.priority ?? row.priority ?? "").trim(),
    link: String(payload.link ?? row.link ?? "").trim(),
  };
  if (payload.progress !== undefined) next.progress = Number(payload.progress) || 0;
  await db.projects.put(next);
  return { ok: true };
}

async function deleteProject(payload) {
  const key = projectKey(payload.team, payload.id);
  const existing = await db.projects.get(key);
  if (!existing) throw new Error(`ID not found: ${payload.id}`);
  await db.projects.delete(key);
  return { ok: true };
}

async function updateStatus(payload) {
  const key = projectKey(payload.team, payload.id);
  const row = await db.projects.get(key);
  if (!row) throw new Error(`ID not found: ${payload.id}`);
  await db.projects.update(key, { status: String(payload.status || "").trim() });
  return { ok: true };
}

/** Mirror of the remote POST handler; mutates the DB. (Local mode has no auth.) */
export async function postToLocal(payload) {
  const action = String(payload.action || "add").trim().toLowerCase();
  if (action === "addteam") {
    await createTeam({
      id: payload.teamId,
      name: payload.teamName || payload.label,
      color: payload.color,
    });
    return { ok: true };
  }
  if (action === "deleteteam") {
    await deleteTeamById(payload.teamId || payload.id);
    return { ok: true };
  }
  if (action === "adddomain") {
    await createDomain(payload.name || payload.label);
    return { ok: true };
  }
  if (action === "deletedomain") {
    await deleteDomain(String(payload.id || "").trim().toLowerCase());
    return { ok: true };
  }
  if (action === "addstatus") {
    await createStatus({ label: payload.label || payload.name, color: payload.color });
    return { ok: true };
  }
  if (action === "deletestatus") {
    await deleteStatusDef(slug(payload.id || payload.label));
    return { ok: true };
  }
  if (action === "addpriority") {
    await createPriority({ label: payload.label || payload.name, color: payload.color });
    return { ok: true };
  }
  if (action === "deletepriority") {
    await deletePriorityDef(slug(payload.id || payload.label));
    return { ok: true };
  }
  if (action === "addcookiebotsite") {
    const name = String(payload.name || "").trim();
    if (!name) throw new Error("Site name is required.");
    const existing = await db.sites.toArray();
    if (existing.some((s) => (s.name || "").toLowerCase() === name.toLowerCase())) {
      throw new Error(`Site already exists: ${name}`);
    }
    await db.sites.add({ name, domain: String(payload.domain || "").trim() });
    return { ok: true };
  }
  if (action === "deletecookiebotsite") {
    const name = String(payload.name || "").trim().toLowerCase();
    const rows = await db.sites.toArray();
    const hit = rows.find((s) => (s.name || "").toLowerCase() === name);
    if (hit) await db.sites.delete(hit.id);
    // Also remove that site's reports.
    const reps = await db.reports.toArray();
    await Promise.all(
      reps.filter((r) => (r.site || "").toLowerCase() === name).map((r) => db.reports.delete(r.id))
    );
    return { ok: true };
  }
  if (action === "addcookiebotreport") {
    await db.reports.add({
      site: String(payload.site || "").trim(),
      fileName: String(payload.fileName || "").trim(),
      uploaded: String(payload.uploaded || new Date().toISOString()),
      size: String(payload.size || ""),
      data: payload.data || null,
    });
    return { ok: true };
  }
  if (action === "deletecookiebotreport") {
    const site = String(payload.site || "").trim().toLowerCase();
    const file = String(payload.fileName || "").trim().toLowerCase();
    const up = String(payload.uploaded || "").trim().toLowerCase();
    const reps = await db.reports.toArray();
    const hit = reps.find(
      (r) =>
        (r.site || "").toLowerCase() === site &&
        (r.fileName || "").toLowerCase() === file &&
        (!up || String(r.uploaded || "").toLowerCase() === up)
    );
    if (hit) await db.reports.delete(hit.id);
    return { ok: true };
  }
  if (action === "delete") return deleteProject(payload);
  if (action === "updatestatus") return updateStatus(payload);
  if (action === "update") return updateProject(payload);
  return addProject(payload);
}

export async function resetLocalData() {
  await db.delete();
  await db.open();
}

/* ------------------------- Sites & Cookiebot --------------------------- */

export function listSites() {
  return db.sites.orderBy("name").toArray();
}

export async function addSite({ name, url }) {
  const cleanName = String(name || "").trim();
  if (!cleanName) throw new Error("Site name is required.");
  return db.sites.add({ name: cleanName, url: String(url || "").trim() });
}

export async function deleteSite(id) {
  await db.reports.where("siteId").equals(id).delete();
  await db.sites.delete(id);
}

export function listReports(siteId) {
  return db.reports.where("siteId").equals(siteId).reverse().sortBy("uploadedAt");
}

export async function getAllReports() {
  return db.reports.toArray();
}

export async function addReport({ siteId, file, summary, uploadedAt }) {
  return db.reports.add({
    siteId,
    fileName: file.name,
    fileType: file.type || "",
    size: file.size,
    blob: file,
    summary: summary || null,
    uploadedAt: uploadedAt || new Date().toISOString(),
  });
}

export async function deleteReport(id) {
  await db.reports.delete(id);
}

export async function getReportBlob(id) {
  const row = await db.reports.get(id);
  return row?.blob || null;
}

/* ----------------------- Taxonomy (Settings) -------------------------- */

async function projectsUsingDomain(domainId) {
  return db.projects.where("domain").equals(domainId).count();
}

export function listDomains() {
  return db.domains.toArray();
}

export async function createDomain(name) {
  const clean = String(name || "").trim();
  if (!clean) throw new Error("Domain name is required.");
  const id = slug(clean);
  if (!id) throw new Error("Domain name must contain letters or numbers.");
  if (await db.domains.get(id)) throw new Error(`Domain already exists: ${clean}`);
  await db.domains.add({ id, name: clean });
  return id;
}

export async function deleteDomain(id) {
  const count = await projectsUsingDomain(id);
  if (count > 0) {
    throw new Error(`Cannot delete: ${count} project(s) still use this domain.`);
  }
  await db.domains.delete(id);
}

export function listTeams() {
  return db.teams.toArray();
}

export async function createTeam({ id: explicitId, name, color }) {
  const clean = String(name || "").trim();
  if (!clean) throw new Error("Team name is required.");
  const id = String(explicitId || "").trim() || slug(clean);
  if (!id) throw new Error("Team name must contain letters or numbers.");
  if (await db.teams.get(id)) throw new Error(`Team already exists: ${clean}`);
  await db.teams.add({ id, label: clean, color: String(color || "").trim() || "#64748b" });
  return id;
}

export async function deleteTeamById(id) {
  const projects = await db.projects.toArray();
  const used = projects.some((p) =>
    parseTeams(p.teams).some((t) => t.toLowerCase() === String(id).toLowerCase())
  );
  if (used) throw new Error("Cannot delete: team is assigned to projects.");
  await db.teams.delete(id);
}

async function nextOrder(table) {
  const rows = await table.toArray();
  return rows.reduce((max, r) => Math.max(max, r.order ?? 0), -1) + 1;
}

export function listStatuses() {
  return db.statuses.orderBy("order").toArray();
}

export async function createStatus({ label, color }) {
  const clean = String(label || "").trim();
  if (!clean) throw new Error("Status name is required.");
  const id = slug(clean);
  if (await db.statuses.get(id)) throw new Error(`Status already exists: ${clean}`);
  await db.statuses.add({ id, label: clean, color: String(color || "").trim() || "#64748b", order: await nextOrder(db.statuses) });
  return id;
}

export async function deleteStatusDef(labelOrId) {
  const target = slug(labelOrId);
  const rows = await db.statuses.toArray();
  // Seeded rows use label-style ids ("In Progress"); created rows use slugs
  // ("in-progress") — match either form so deletes never silently no-op.
  const hit = rows.find((r) => slug(r.id) === target || slug(r.label) === target);
  if (!hit) throw new Error(`Status not found: ${labelOrId}`);
  await db.statuses.delete(hit.id);
}

export function listPriorities() {
  return db.priorities.orderBy("order").toArray();
}

export async function createPriority({ label, color }) {
  const clean = String(label || "").trim();
  if (!clean) throw new Error("Priority name is required.");
  const id = slug(clean);
  if (await db.priorities.get(id)) throw new Error(`Priority already exists: ${clean}`);
  await db.priorities.add({ id, label: clean, color: String(color || "").trim() || "#64748b", order: await nextOrder(db.priorities) });
  return id;
}

export async function deletePriorityDef(labelOrId) {
  const target = slug(labelOrId);
  const rows = await db.priorities.toArray();
  const hit = rows.find((r) => slug(r.id) === target || slug(r.label) === target);
  if (!hit) throw new Error(`Priority not found: ${labelOrId}`);
  await db.priorities.delete(hit.id);
}

/* ----------------------- Remote cache (SWR) --------------------------- */

const ROADMAP_CACHE_KEY = "roadmap_payload";

/** Read the last cached roadmap payload (merged shape), or null. */
export async function getCachedRoadmap() {
  try {
    const row = await db.cache.get(ROADMAP_CACHE_KEY);
    return row?.value ?? null;
  } catch {
    return null;
  }
}

/** Store the latest roadmap payload fetched from the remote source. */
export async function cacheRoadmap(payload) {
  try {
    await db.cache.put({
      key: ROADMAP_CACHE_KEY,
      value: payload,
      cachedAt: new Date().toISOString(),
    });
  } catch {
    /* ignore quota / private-mode errors */
  }
}
