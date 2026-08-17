import { resolveStatusDefinitions } from "../config/statusConfig";
import { resolvePriorityDefinitions, getValidPriorityLabels } from "../config/priorityConfig";
import { ROADMAP_DEFAULTS } from "../config/roadmapDefaults";
import { getRoadmap as getLocalRoadmap, postToLocal } from "../db/database";

function getApiUrl() {
  const url = import.meta.env.VITE_SHEETS_API_URL;
  return url ? String(url).trim().replace(/\/$/, "") : "";
}

/** "local" (dummy data) or "remote" (Google Sheets today, Microsoft later). */
export function getDataSource() {
  const explicit = String(import.meta.env.VITE_DATA_SOURCE || "").trim().toLowerCase();
  if (explicit === "local" || explicit === "remote") return explicit;
  return getApiUrl() ? "remote" : "local";
}

function isLocal() {
  return getDataSource() === "local";
}

/** True when running on the local in-browser DB (no auth / lock needed). */
export function isLocalMode() {
  return isLocal();
}

/** True when admin (add/edit/delete) features should be available. */
export function hasSheetsApi() {
  return isLocal() || Boolean(getApiUrl());
}

export function getGoogleSheetUrl() {
  if (isLocal()) return "";
  const url = import.meta.env.VITE_GOOGLE_SHEET_URL;
  return url ? String(url).trim() : "";
}

function isTeamFilterDefinition(entry) {
  return entry && typeof entry === "object" && entry.id && entry.label && !entry.timeline;
}

function resolveTeamFilterDefinitions(payload) {
  if (Array.isArray(payload?.cohorts) && isTeamFilterDefinition(payload.cohorts[0])) {
    return payload.cohorts;
  }
  if (Array.isArray(payload?.teams) && payload.teams.length > 0) {
    if (!payload.teams[0] || isTeamFilterDefinition(payload.teams[0])) {
      return payload.teams;
    }
  }
  return ROADMAP_DEFAULTS.teams;
}

/**
 * Accepts a FLAT remote payload (easy to produce from SharePoint/Power Automate):
 *   { projects:[{domain,id,name,description,timelineStart,timelineEnd,status,
 *                teams,owner,priority,link,progress}],
 *     teams:[{id,label,color}], domains:[{id,name}],
 *     statuses:[{id,label,color}], priorities:[{id,label,color}] }
 * and reshapes it into the nested form the UI expects. If the payload is already
 * nested (legacy/Apps Script), it is returned unchanged.
 */
export function normalizeRemotePayload(payload) {
  if (!payload || !Array.isArray(payload.projects)) return payload;

  const out = {
    teams: payload.teams || [],
    statuses: payload.statuses || [],
    priorities: payload.priorities || [],
  };

  const domainDefs = [];
  (payload.domains || []).forEach((d) => {
    const key = String(d.id || d.name || "").trim().toLowerCase();
    if (!key) return;
    out[key] = [];
    domainDefs.push({ id: key, name: d.name || key.charAt(0).toUpperCase() + key.slice(1) });
  });
  out.domains = domainDefs;

  payload.projects.forEach((p) => {
    const domain = String(p.domain || "").trim().toLowerCase();
    if (!domain) return;
    if (!out[domain]) out[domain] = [];
    out[domain].push({
      id: String(p.id || "").trim(),
      name: p.name || "",
      description: p.description || "",
      timeline: [
        p.timelineStart || p.start || p.timeline?.[0] || "",
        p.timelineEnd || p.end || p.timeline?.[1] || "",
      ],
      status: p.status || "",
      teams: Array.isArray(p.teams)
        ? p.teams
        : String(p.teams || "")
            .split(/[,;]/)
            .map((t) => t.trim())
            .filter(Boolean),
      owner: p.owner || "",
      priority: p.priority || "",
      link: p.link || "",
      progress: Number(p.progress) || 0,
    });
  });

  if (Array.isArray(payload.cookiebotSites)) out.cookiebotSites = payload.cookiebotSites;
  if (Array.isArray(payload.cookiebotReports)) out.cookiebotReports = payload.cookiebotReports;
  if (Array.isArray(payload.incidents)) out.incidents = payload.incidents;
  if (payload.incidentConfig && typeof payload.incidentConfig === "object") {
    out.incidentConfig = payload.incidentConfig;
  }

  return out;
}

export function mergeRoadmapData(sheetPayload) {
  const payload = sheetPayload || {};
  const sheetData = { ...payload };
  delete sheetData.teams;
  delete sheetData.cohorts;
  delete sheetData.statuses;
  delete sheetData.priorities;

  return {
    ...ROADMAP_DEFAULTS,
    ...sheetData,
    meta: { ...ROADMAP_DEFAULTS.meta, ...(payload.meta || {}) },
    teams: resolveTeamFilterDefinitions(payload),
    statuses: resolveStatusDefinitions(payload.statuses),
    priorities: resolvePriorityDefinitions(payload.priorities),
  };
}

export function getValidTeamIds(data) {
  return (data?.teams || []).map((t) => t.id).filter(Boolean);
}

export function getTeamOptionsForAdmin(data) {
  return (data?.teams || []).map((t) => ({
    id: t.id,
    label: t.label === t.id ? t.label : `${t.label} (${t.id})`,
  }));
}

async function parseJsonResponse(res) {
  const text = await res.text();
  let json;
  try {
    json = JSON.parse(text);
  } catch {
    throw new Error(`Invalid JSON response (HTTP ${res.status})`);
  }
  if (!res.ok) {
    throw new Error(json.error || `HTTP ${res.status}`);
  }
  return json;
}

export async function fetchRoadmap() {
  if (isLocal()) {
    return mergeRoadmapData(await getLocalRoadmap());
  }

  const apiUrl = getApiUrl();
  if (!apiUrl) {
    throw new Error(
      "VITE_SHEETS_API_URL is not set. Copy .env.example to .env and add your Google Apps Script Web App URL (see README.md)."
    );
  }

  const res = await fetch(apiUrl);
  const payload = await parseJsonResponse(res);
  // Apps Script can't set HTTP status codes, so errors arrive as 200s with an
  // {error} body. Without this check a backend hiccup would render (and cache)
  // an empty roadmap instead of surfacing the failure.
  if (payload?.error && !Array.isArray(payload.projects)) {
    throw new Error(payload.error);
  }
  return mergeRoadmapData(normalizeRemotePayload(payload));
}

async function postToSheetsApi(payload) {
  if (isLocal()) {
    // Mirror the remote contract: throws on error, returns the result object.
    return postToLocal(payload);
  }

  const apiUrl = getApiUrl();
  if (!apiUrl) {
    throw new Error(
      "VITE_SHEETS_API_URL is not set. Configure the Google Apps Script URL to add initiatives."
    );
  }

  const res = await fetch(apiUrl, {
    method: "POST",
    headers: { "Content-Type": "text/plain;charset=utf-8" },
    body: JSON.stringify(payload),
  });

  const json = await parseJsonResponse(res);
  if (json.ok === false) {
    throw new Error(json.error || "Request failed.");
  }
  return json;
}

export async function addInitiative(payload) {
  return postToSheetsApi({ ...payload, action: "add" });
}

export async function updateInitiative(payload) {
  return postToSheetsApi({ ...payload, action: "update" });
}

export async function deleteInitiative({ adminToken, team, id }) {
  return postToSheetsApi({
    action: "delete",
    adminToken,
    team: String(team || "").trim().toLowerCase(),
    id: String(id || "").trim(),
  });
}

export async function addTeam({ adminToken, teamId, teamName, color }) {
  return postToSheetsApi({
    action: "addTeam",
    adminToken,
    teamId: String(teamId || "").trim(),
    teamName: String(teamName || "").trim(),
    color: String(color || "").trim(),
  });
}

export async function deleteTeam({ adminToken, teamId }) {
  return postToSheetsApi({
    action: "deleteTeam",
    adminToken,
    teamId: String(teamId || "").trim(),
  });
}

export async function addDomain({ adminToken, name }) {
  return postToSheetsApi({ action: "addDomain", adminToken, name: String(name || "").trim() });
}

export async function deleteDomain({ adminToken, id }) {
  return postToSheetsApi({ action: "deleteDomain", adminToken, id: String(id || "").trim() });
}

export async function addStatusDef({ adminToken, label, color }) {
  return postToSheetsApi({
    action: "addStatus",
    adminToken,
    label: String(label || "").trim(),
    color: String(color || "").trim(),
  });
}

export async function deleteStatusDef({ adminToken, label }) {
  return postToSheetsApi({ action: "deleteStatus", adminToken, label: String(label || "").trim() });
}

export async function addPriorityDef({ adminToken, label, color }) {
  return postToSheetsApi({
    action: "addPriority",
    adminToken,
    label: String(label || "").trim(),
    color: String(color || "").trim(),
  });
}

export async function deletePriorityDef({ adminToken, label }) {
  return postToSheetsApi({ action: "deletePriority", adminToken, label: String(label || "").trim() });
}

export async function addCookiebotSite({ adminToken, name, domain }) {
  return postToSheetsApi({
    action: "addCookiebotSite",
    adminToken,
    name: String(name || "").trim(),
    domain: String(domain || "").trim(),
  });
}

export async function deleteCookiebotSite({ adminToken, name }) {
  return postToSheetsApi({ action: "deleteCookiebotSite", adminToken, name: String(name || "").trim() });
}

export async function addCookiebotReport({ adminToken, site, fileName, uploaded, size, data }) {
  return postToSheetsApi({
    action: "addCookiebotReport",
    adminToken,
    site: String(site || "").trim(),
    fileName: String(fileName || "").trim(),
    uploaded: String(uploaded || "").trim(),
    size: String(size || "").trim(),
    data: data || {},
  });
}

export async function deleteCookiebotReport({ adminToken, site, fileName, uploaded }) {
  return postToSheetsApi({
    action: "deleteCookiebotReport",
    adminToken,
    site: String(site || "").trim(),
    fileName: String(fileName || "").trim(),
    uploaded: String(uploaded || "").trim(),
  });
}

/* ------------------ Operations timeline (Incidents tab) ------------------ */

/** Only the 13 sheet columns travel to the backend — nothing derived. */
function incidentPayload(entry) {
  return {
    id: String(entry.id || "").trim(),
    key: String(entry.key || entry.externalId || "").trim(),
    start: String(entry.start || entry.date || "").trim(),
    end: String(entry.end || "").trim(),
    domain: String(entry.domain || "").trim(),
    title: String(entry.title || "").trim(),
    type: String(entry.type || "").trim(),
    cause: String(entry.cause || "").trim(),
    severity: String(entry.severity || "").trim(),
    duration: String(entry.duration || "").trim(),
    customerImpact: String(entry.customerImpact || "").trim(),
    revenueImpact: String(entry.revenueImpact || "").trim(),
    status: String(entry.status || "").trim(),
    notes: String(entry.notes || "").trim(),
    links: String(entry.links || "").trim(),
  };
}

export async function addIncident({ adminToken, ...entry }) {
  return postToSheetsApi({ action: "addIncident", adminToken, ...incidentPayload(entry) });
}

export async function updateIncident({ adminToken, ...entry }) {
  return postToSheetsApi({ action: "updateIncident", adminToken, ...incidentPayload(entry) });
}

/**
 * Close an already-logged incident. Identify it by `id`, by `key` (the caller's
 * own correlation id), or by domain + title — so an automated poster that keeps
 * no state can still close the row it opened. `end` defaults to now.
 */
export async function resolveIncident({ adminToken, id, key, domain, title, end, ...rest }) {
  return postToSheetsApi({
    action: "resolveIncident",
    adminToken,
    id: String(id || "").trim(),
    key: String(key || "").trim(),
    domain: String(domain || "").trim(),
    title: String(title || "").trim(),
    end: String(end || "").trim(),
    ...rest,
  });
}

/** Everything still Active / Monitoring — "what have I already logged?" */
export async function listOpenIncidents({ adminToken }) {
  return postToSheetsApi({ action: "listOpenIncidents", adminToken });
}

export async function deleteIncident({ adminToken, id }) {
  return postToSheetsApi({
    action: "deleteIncident",
    adminToken,
    id: String(id || "").trim(),
  });
}

export function validateIncidentForm(fields, options = {}) {
  const {
    validTypes = [],
    validCauses = [],
    validSeverities = [],
    validStatuses = [],
    // Both default to the built-in two-type model so an older caller that
    // passes neither behaves exactly as before.
    requireCause = true,
    requireSeverity = String(fields.type || "").trim() === "Outage",
    parseDuration = null,
  } = options;
  const errors = {};

  const startDate = String(fields.startDate || fields.date || "").trim();
  const startTime = String(fields.startTime || fields.time || "").trim();
  const endDate = String(fields.endDate || "").trim();
  const endTime = String(fields.endTime || "").trim();
  const title = String(fields.title || "").trim();
  const domain = String(fields.domain || "").trim();
  const duration = String(fields.duration || "").trim();

  const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
  const TIME_RE = /^\d{2}:\d{2}$/;

  if (!startDate) errors.startDate = "Start date is required.";
  else if (!DATE_RE.test(startDate)) errors.startDate = "Use YYYY-MM-DD.";
  if (startTime && !TIME_RE.test(startTime)) errors.startTime = "Use HH:MM (24h).";

  if (endDate && !DATE_RE.test(endDate)) errors.endDate = "Use YYYY-MM-DD.";
  if (endTime && !TIME_RE.test(endTime)) errors.endTime = "Use HH:MM (24h).";
  // A time with no date has nothing to anchor it to.
  if (endTime && !endDate) errors.endDate = "Add an end date for that time.";

  // Chronology, only once both sides are well-formed. Times default to 00:00
  // so a same-day range without times is treated as valid, not inverted.
  if (!errors.startDate && !errors.endDate && !errors.startTime && !errors.endTime && endDate) {
    const from = `${startDate} ${startTime || "00:00"}`;
    const to = `${endDate} ${endTime || "00:00"}`;
    if (to < from) errors.endDate = "End must be on or after the start.";
  }

  if (!domain) errors.domain = "Domain is required.";
  if (!title) errors.title = "Title is required.";

  const check = (value, list, key, name) => {
    const v = String(value || "").trim();
    if (!v) errors[key] = `${name} is required.`;
    else if (list.length && !list.includes(v)) errors[key] = `${name} must be one of: ${list.join(", ")}.`;
  };
  check(fields.type, validTypes, "type", "Type");
  // Cause is required whenever the config tab offers causes for the type.
  if (requireCause) check(fields.cause, validCauses, "cause", "Cause");
  // Severity only applies to unplanned work (Outage by default).
  if (requireSeverity) {
    check(fields.severity, validSeverities, "severity", "Severity");
  }
  check(fields.status, validStatuses, "status", "Status");

  // Duration stays optional (blank = ongoing, or a point-in-time event), but a
  // value that can't be read would silently render a zero-length bar.
  if (duration && parseDuration && parseDuration(duration) === null) {
    errors.duration = 'Try "2h 30m", "33h", "45m" or "1d 4h".';
  }

  return { errors, valid: Object.keys(errors).length === 0 };
}

export async function updateInitiativeStatus({ adminToken, team, id, status }) {
  return postToSheetsApi({
    action: "updateStatus",
    adminToken,
    team: String(team || "").trim().toLowerCase(),
    id: String(id || "").trim(),
    status: String(status || "").trim(),
  });
}

function normalizeTeamsField(teams) {
  if (Array.isArray(teams)) {
    return teams.map((t) => String(t).trim()).filter(Boolean);
  }
  return String(teams || "")
    .split(/[,;]/)
    .map((t) => t.trim())
    .filter(Boolean);
}

export function getValidStatusLabels(data) {
  return (data?.statuses || []).map((s) => s.label).filter(Boolean);
}

export function validateInitiativeForm(
  fields,
  validTeamIds = [],
  validStatusLabels = [],
  validPriorityLabels = getValidPriorityLabels()
) {
  const errors = {};
  const domain = String(fields.domain ?? fields.team ?? "").trim();
  const id = String(fields.id || "").trim();
  const name = String(fields.name || "").trim();
  const description = String(fields.description || "").trim();
  const timelineStart = String(fields.timelineStart || "").trim();
  const timelineEnd = String(fields.timelineEnd || "").trim();
  const status = String(fields.status || "").trim();
  const priority = String(fields.priority || "").trim();
  const link = String(fields.link || "").trim();
  const teamIds = normalizeTeamsField(fields.teams ?? fields.cohort);

  if (!domain) errors.domain = "Domain is required.";
  if (!id) errors.id = "ID is required.";
  if (!name) errors.name = "Name is required.";
  if (!description) errors.description = "Description is required.";
  if (!timelineStart) errors.timelineStart = "Start date is required.";
  if (!timelineEnd) errors.timelineEnd = "End date is required.";
  if (timelineStart && timelineEnd && timelineEnd < timelineStart) {
    errors.timelineEnd = "End date must be on or after start date.";
  }

  if (teamIds.length > 0 && validTeamIds.length > 0) {
    const invalid = teamIds.filter((t) => !validTeamIds.includes(t));
    if (invalid.length > 0) {
      errors.teams = `Teams must be one of: ${validTeamIds.join(", ")}.`;
    }
  }

  if (status && validStatusLabels.length > 0 && !validStatusLabels.includes(status)) {
    errors.status = `Status must be one of: ${validStatusLabels.join(", ")}.`;
  }

  if (priority && validPriorityLabels.length > 0 && !validPriorityLabels.includes(priority)) {
    errors.priority = `Priority must be one of: ${validPriorityLabels.join(", ")}.`;
  }

  if (link && !/^https?:\/\//i.test(link)) {
    errors.link = "Link must start with http:// or https://";
  }

  return { errors, valid: Object.keys(errors).length === 0 };
}

const TEAM_ID_PATTERN = /^[a-zA-Z0-9_-]+$/;

export function validateTeamForm({ teamId, teamName, color }) {
  const errors = {};
  const id = String(teamId || "").trim();
  const name = String(teamName || "").trim();
  const colorVal = String(color || "").trim();

  if (!id) errors.teamId = "Team Id is required.";
  else if (!TEAM_ID_PATTERN.test(id)) {
    errors.teamId = "Use letters, numbers, hyphens, or underscores only.";
  }

  if (!name) errors.teamName = "Team Name is required.";

  if (colorVal && !/^#[0-9A-Fa-f]{6}$/.test(colorVal)) {
    errors.color = "Color must be a hex value like #8b5cf6.";
  }

  return { errors, valid: Object.keys(errors).length === 0 };
}
