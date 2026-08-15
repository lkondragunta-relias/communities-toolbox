/**
 * Roadmap App — Google Apps Script backend (consolidated model).
 *
 * Bind this script to your spreadsheet (Extensions → Apps Script), then
 * Deploy → Web app. Set ADMIN_TOKEN in Project Settings → Script Properties
 * to override the default write token below.
 *
 * Expected tabs (the name only needs to CONTAIN the keyword, so
 * "Community Roadmap - Projects" or just "Projects" both work):
 *
 *   Projects   : Title(=id) | Domain | Name | Description | TimelineStart |
 *                TimelineEnd | Status | Priority | Owner | Teams | Link | Progress
 *   Teams      : Title(=id) | Label | Color
 *   Domains    : Title(=id) | Name
 *   Statuses   : Title(=label) | Color | SortOrder
 *   Priorities : Title(=label) | Color | SortOrder
 *   Incidents  : ID | Key | Start | End | Domain | Title | Type | Severity | Duration |
 *                Customer Impact | Revenue Impact | Status | Notes | Links
 *   Incident Config : Section | Outage Cause | Track Event Cause | Domain |
 *                     Severity | Status | Revenue Impact | Customer Impact Prefix
 *
 * The browser app reads GET (returns the flat JSON below) and writes via POST
 * with { action, adminToken, ... }. Column order is flexible — columns are
 * matched by header name, not position.
 */

var DEFAULT_ADMIN_TOKEN = 'relias-2026';
var DEFAULT_STATUS_COLOR = '#64748b';
var DEFAULT_TEAM_COLORS = [
  '#8b5cf6', '#eab308', '#14b8a6', '#3b82f6',
  '#ec4899', '#f97316', '#06b6d4', '#84cc16',
];

/* =============================== Entry points ============================== */

function doGet(e) {
  try {
    return jsonResponse(readRoadmap_());
  } catch (err) {
    return jsonResponse({ error: String(err && err.message || err) }, 500);
  }
}

function doPost(e) {
  // Serialize writes: without a lock, two concurrent adds can both pass the
  // duplicate-ID check and both append.
  var lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    return doPostLocked_(e);
  } finally {
    lock.releaseLock();
  }
}

function doPostLocked_(e) {
  try {
    var body = parsePostBody_(e);
    if (!body.adminToken || body.adminToken !== getAdminToken_()) {
      return jsonResponse({ ok: false, error: 'Invalid admin token.' }, 403);
    }
    var action = String(body.action || 'add').trim().toLowerCase();

    if (action === 'add') return jsonResponse(addProject_(body));
    if (action === 'update') return jsonResponse(updateProject_(body));
    if (action === 'delete') return jsonResponse(deleteProject_(body));
    if (action === 'updatestatus') return jsonResponse(updateStatus_(body));

    if (action === 'addteam') return jsonResponse(addTeam_(body));
    if (action === 'deleteteam') return jsonResponse(deleteTeam_(body));
    if (action === 'adddomain') return jsonResponse(addDomain_(body));
    if (action === 'deletedomain') return jsonResponse(deleteDomain_(body));
    if (action === 'addstatus') return jsonResponse(addStatus_(body));
    if (action === 'deletestatus') return jsonResponse(deleteStatus_(body));
    if (action === 'addpriority') return jsonResponse(addPriority_(body));
    if (action === 'deletepriority') return jsonResponse(deletePriority_(body));

    if (action === 'addincident') return jsonResponse(addIncident_(body));
    if (action === 'updateincident') return jsonResponse(updateIncident_(body));
    if (action === 'deleteincident') return jsonResponse(deleteIncident_(body));
    if (action === 'resolveincident') return jsonResponse(resolveIncident_(body));
    if (action === 'listopenincidents') return jsonResponse(listOpenIncidents_());
    if (action === 'setupincidentconfig') return jsonResponse(setupIncidentConfig_());

    if (action === 'addcookiebotsite') return jsonResponse(addCookiebotSite_(body));
    if (action === 'deletecookiebotsite') return jsonResponse(deleteCookiebotSite_(body));
    if (action === 'addcookiebotreport') return jsonResponse(addCookiebotReport_(body));
    if (action === 'deletecookiebotreport') return jsonResponse(deleteCookiebotReport_(body));

    return jsonResponse({ ok: false, error: 'Unknown action: ' + action }, 400);
  } catch (err) {
    return jsonResponse({ ok: false, error: String(err && err.message || err) }, 400);
  }
}

function getAdminToken_() {
  var fromProps = PropertiesService.getScriptProperties().getProperty('ADMIN_TOKEN');
  return fromProps || DEFAULT_ADMIN_TOKEN;
}

/* ============================== Sheet helpers ============================= */

function ss_() {
  return SpreadsheetApp.getActiveSpreadsheet();
}

function normalize_(value) {
  return String(value || '').trim().toLowerCase().replace(/\s+/g, ' ');
}

/** Find a tab whose name contains the keyword (e.g. 'project', 'team'). */
function getSheetByKeyword_(keyword) {
  var sheets = ss_().getSheets();
  for (var i = 0; i < sheets.length; i++) {
    if (normalize_(sheets[i].getName()).indexOf(keyword) >= 0) {
      return sheets[i];
    }
  }
  return null;
}

function requireSheetByKeyword_(keyword, label) {
  var sheet = getSheetByKeyword_(keyword);
  if (!sheet) {
    throw new Error('Missing a "' + label + '" tab (name must contain "' + keyword + '").');
  }
  return sheet;
}

/** Map of normalized-header -> 1-based column index. */
function headerMap_(sheet) {
  var lastCol = sheet.getLastColumn();
  if (lastCol < 1) return {};
  var headers = sheet.getRange(1, 1, 1, lastCol).getValues()[0];
  var map = {};
  for (var c = 0; c < headers.length; c++) {
    var key = normalize_(headers[c]);
    if (key && !(key in map)) map[key] = c + 1;
  }
  return map;
}

/** First matching column index from a list of candidate header names, or 0. */
function colOf_(map, names) {
  for (var i = 0; i < names.length; i++) {
    if (map[names[i]]) return map[names[i]];
  }
  return 0;
}

function cell_(row, col) {
  return col > 0 ? row[col - 1] : '';
}

function findRowByValue_(sheet, col, value) {
  if (col < 1) return -1;
  var lastRow = sheet.getLastRow();
  if (lastRow < 2) return -1;
  var target = String(value || '').trim().toLowerCase();
  if (!target) return -1;
  var values = sheet.getRange(2, col, lastRow - 1, 1).getValues();
  for (var i = 0; i < values.length; i++) {
    if (String(values[i][0] || '').trim().toLowerCase() === target) return i + 2;
  }
  return -1;
}

/**
 * Locate a project row by id, and by domain too when both the column and a
 * domain value exist — so same-id rows in different domains never collide.
 */
function findProjectRow_(sheet, c, domain, id) {
  var lastRow = sheet.getLastRow();
  if (lastRow < 2 || c.id < 1) return -1;
  var targetId = String(id || '').trim().toLowerCase();
  if (!targetId) return -1;
  var targetDomain = c.domain > 0 ? String(domain || '').trim().toLowerCase() : '';
  var lastCol = sheet.getLastColumn();
  var values = sheet.getRange(2, 1, lastRow - 1, lastCol).getValues();
  for (var i = 0; i < values.length; i++) {
    if (String(cell_(values[i], c.id) || '').trim().toLowerCase() !== targetId) continue;
    if (targetDomain &&
        String(cell_(values[i], c.domain) || '').trim().toLowerCase() !== targetDomain) {
      continue;
    }
    return i + 2;
  }
  return -1;
}

function formatDateCell_(value) {
  if (value === null || value === undefined || value === '') return '';
  if (Object.prototype.toString.call(value) === '[object Date]' && !isNaN(value.getTime())) {
    return Utilities.formatDate(value, Session.getScriptTimeZone(), 'yyyy-MM-dd');
  }
  var s = String(value).trim();
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s.slice(0, 10);
  return s;
}

function parseTeamsCell_(value) {
  if (!value) return [];
  return String(value)
    .split(/[,;]/)
    .map(function (p) { return String(p || '').trim(); })
    .filter(function (p) { return p.length > 0; });
}

/* ================================= Reads ================================== */

function readRoadmap_() {
  return {
    projects: readProjects_(),
    teams: readTeams_(),
    domains: readDomains_(),
    statuses: readStatuses_(),
    priorities: readPriorities_(),
    incidents: readIncidents_(),
    incidentConfig: readIncidentConfig_(),
    cookiebotSites: readCookiebotSites_(),
    cookiebotReports: readCookiebotReports_(),
  };
}

function projectColumns_(sheet) {
  var map = headerMap_(sheet);
  return {
    id: colOf_(map, ['title', 'id']),
    domain: colOf_(map, ['domain']),
    name: colOf_(map, ['name']),
    description: colOf_(map, ['description', 'desc']),
    start: colOf_(map, ['timelinestart', 'timeline start', 'start']),
    end: colOf_(map, ['timelineend', 'timeline end', 'end']),
    status: colOf_(map, ['status']),
    priority: colOf_(map, ['priority']),
    owner: colOf_(map, ['owner']),
    teams: colOf_(map, ['teams', 'team', 'cohort']),
    link: colOf_(map, ['link', 'links', 'url']),
    progress: colOf_(map, ['progress', 'progress %', 'percent']),
  };
}

function readProjects_() {
  var sheet = getSheetByKeyword_('project');
  if (!sheet) return [];
  var lastRow = sheet.getLastRow();
  if (lastRow < 2) return [];
  var c = projectColumns_(sheet);
  var lastCol = sheet.getLastColumn();
  var values = sheet.getRange(2, 1, lastRow - 1, lastCol).getValues();
  var out = [];
  for (var r = 0; r < values.length; r++) {
    var row = values[r];
    var id = String(cell_(row, c.id) || '').trim();
    if (!id) continue;
    out.push({
      id: id,
      domain: String(cell_(row, c.domain) || '').trim().toLowerCase(),
      name: String(cell_(row, c.name) || '').trim(),
      description: String(cell_(row, c.description) || '').trim(),
      timelineStart: formatDateCell_(cell_(row, c.start)),
      timelineEnd: formatDateCell_(cell_(row, c.end)),
      status: String(cell_(row, c.status) || '').trim(),
      priority: String(cell_(row, c.priority) || '').trim(),
      owner: String(cell_(row, c.owner) || '').trim(),
      teams: String(cell_(row, c.teams) || '').trim(),
      link: String(cell_(row, c.link) || '').trim(),
      progress: c.progress ? (Number(cell_(row, c.progress)) || 0) : 0,
    });
  }
  return out;
}

function readTeams_() {
  var sheet = getSheetByKeyword_('team');
  if (!sheet) return [];
  var lastRow = sheet.getLastRow();
  if (lastRow < 2) return [];
  var map = headerMap_(sheet);
  var idC = colOf_(map, ['title', 'id', 'team id']);
  var labelC = colOf_(map, ['label', 'name', 'team name']);
  var colorC = colOf_(map, ['color', 'colour']);
  var lastCol = sheet.getLastColumn();
  var values = sheet.getRange(2, 1, lastRow - 1, lastCol).getValues();
  var out = [];
  for (var r = 0; r < values.length; r++) {
    var row = values[r];
    var id = String(cell_(row, idC) || '').trim();
    if (!id) continue;
    var color = String(cell_(row, colorC) || '').trim();
    if (!/^#[0-9A-Fa-f]{6}$/.test(color)) {
      color = DEFAULT_TEAM_COLORS[out.length % DEFAULT_TEAM_COLORS.length];
    }
    out.push({ id: id, label: String(cell_(row, labelC) || id).trim() || id, color: color });
  }
  return out;
}

function readDomains_() {
  var sheet = getSheetByKeyword_('domain');
  if (!sheet) return [];
  var lastRow = sheet.getLastRow();
  if (lastRow < 2) return [];
  var map = headerMap_(sheet);
  var idC = colOf_(map, ['title', 'id']);
  var nameC = colOf_(map, ['name', 'label']);
  var lastCol = sheet.getLastColumn();
  var values = sheet.getRange(2, 1, lastRow - 1, lastCol).getValues();
  var out = [];
  for (var r = 0; r < values.length; r++) {
    var row = values[r];
    var id = String(cell_(row, idC) || '').trim();
    if (!id) continue;
    out.push({ id: id.toLowerCase(), name: String(cell_(row, nameC) || id).trim() || id });
  }
  return out;
}

function readDefsTab_(keyword) {
  var sheet = getSheetByKeyword_(keyword);
  if (!sheet) return [];
  var lastRow = sheet.getLastRow();
  if (lastRow < 2) return [];
  var map = headerMap_(sheet);
  var labelC = colOf_(map, ['title', 'label', 'name']);
  var colorC = colOf_(map, ['color', 'colour']);
  var orderC = colOf_(map, ['sortorder', 'sort order', 'order']);
  var lastCol = sheet.getLastColumn();
  var values = sheet.getRange(2, 1, lastRow - 1, lastCol).getValues();
  var out = [];
  for (var r = 0; r < values.length; r++) {
    var row = values[r];
    var label = String(cell_(row, labelC) || '').trim();
    if (!label) continue;
    var color = String(cell_(row, colorC) || '').trim();
    if (!/^#[0-9A-Fa-f]{6}$/.test(color)) color = DEFAULT_STATUS_COLOR;
    out.push({
      id: label,
      label: label,
      color: color,
      order: orderC ? (Number(cell_(row, orderC)) || 0) : r,
    });
  }
  out.sort(function (a, b) { return a.order - b.order; });
  return out.map(function (d) { return { id: d.id, label: d.label, color: d.color }; });
}

function readStatuses_() { return readDefsTab_('status'); }
function readPriorities_() { return readDefsTab_('priorit'); }

/* ============================ Project writes ============================== */

function buildEmptyRow_(sheet) {
  var lastCol = Math.max(sheet.getLastColumn(), 1);
  var row = [];
  for (var c = 0; c < lastCol; c++) row.push('');
  return row;
}

function setCol_(row, col, value) {
  if (col > 0 && col <= row.length) row[col - 1] = value;
}

function validateProjectFields_(body) {
  var id = String(body.id || '').trim();
  var name = String(body.name || '').trim();
  var start = String(body.timelineStart || '').trim();
  var end = String(body.timelineEnd || '').trim();
  if (!id) throw new Error('ID is required.');
  if (!name) throw new Error('Name is required.');
  if (!start || !end) throw new Error('Timeline start and end are required.');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(start) || !/^\d{4}-\d{2}-\d{2}$/.test(end)) {
    throw new Error('Dates must be YYYY-MM-DD.');
  }
  if (end < start) throw new Error('Timeline end must be on or after start.');
}

function projectValues_(body) {
  return {
    id: String(body.id || '').trim(),
    domain: String(body.team || body.domain || '').trim().toLowerCase(),
    name: String(body.name || '').trim(),
    description: String(body.description || '').trim(),
    start: String(body.timelineStart || '').trim(),
    end: String(body.timelineEnd || '').trim(),
    status: String(body.status || '').trim(),
    priority: String(body.priority || '').trim(),
    owner: String(body.owner || '').trim(),
    teams: formatTeamsValue_(body.teams),
    link: String(body.link || '').trim(),
    progress: (body.progress === '' || body.progress === undefined || body.progress === null)
      ? '' : (Number(body.progress) || 0),
  };
}

function formatTeamsValue_(teams) {
  if (Array.isArray(teams)) return teams.join(',');
  return String(teams || '').trim();
}

function writeProjectRow_(row, c, v) {
  setCol_(row, c.id, v.id);
  setCol_(row, c.domain, v.domain);
  setCol_(row, c.name, v.name);
  setCol_(row, c.description, v.description);
  setCol_(row, c.start, v.start);
  setCol_(row, c.end, v.end);
  setCol_(row, c.status, v.status);
  setCol_(row, c.priority, v.priority);
  setCol_(row, c.owner, v.owner);
  setCol_(row, c.teams, v.teams);
  setCol_(row, c.link, v.link);
  if (v.progress !== '') setCol_(row, c.progress, v.progress);
}

function addProject_(body) {
  validateProjectFields_(body);
  var sheet = requireSheetByKeyword_('project', 'Projects');
  var c = projectColumns_(sheet);
  var v = projectValues_(body);

  if (findProjectRow_(sheet, c, v.domain, v.id) >= 0) {
    throw new Error('ID already exists in this domain: ' + v.id);
  }

  var row = buildEmptyRow_(sheet);
  writeProjectRow_(row, c, v);
  sheet.appendRow(row);
  return { ok: true };
}

function updateProject_(body) {
  validateProjectFields_(body);
  var sheet = requireSheetByKeyword_('project', 'Projects');
  var c = projectColumns_(sheet);
  var v = projectValues_(body);

  var rowIndex = findProjectRow_(sheet, c, v.domain, v.id);
  if (rowIndex < 0) throw new Error('ID not found: ' + v.id);

  var lastCol = sheet.getLastColumn();
  var row = sheet.getRange(rowIndex, 1, 1, lastCol).getValues()[0];
  writeProjectRow_(row, c, v);
  sheet.getRange(rowIndex, 1, 1, lastCol).setValues([row]);
  return { ok: true };
}

function deleteProject_(body) {
  var sheet = requireSheetByKeyword_('project', 'Projects');
  var c = projectColumns_(sheet);
  var id = String(body.id || '').trim();
  if (!id) throw new Error('ID is required.');
  var rowIndex = findProjectRow_(sheet, c, body.team || body.domain, id);
  if (rowIndex < 0) throw new Error('ID not found: ' + id);
  sheet.deleteRow(rowIndex);
  return { ok: true };
}

function updateStatus_(body) {
  var sheet = requireSheetByKeyword_('project', 'Projects');
  var c = projectColumns_(sheet);
  var id = String(body.id || '').trim();
  var status = String(body.status || '').trim();
  if (!id) throw new Error('ID is required.');
  if (!status) throw new Error('Status is required.');
  var rowIndex = findProjectRow_(sheet, c, body.team || body.domain, id);
  if (rowIndex < 0) throw new Error('ID not found: ' + id);
  if (c.status < 1) throw new Error('Projects tab has no Status column.');
  sheet.getRange(rowIndex, c.status).setValue(status);
  return { ok: true, status: status };
}

/* ======================= Teams / Domains / Defs writes ==================== */

function addTeam_(body) {
  var id = String(body.teamId || body.id || '').trim();
  var label = String(body.teamName || body.label || body.name || '').trim();
  var color = String(body.color || '').trim();
  if (!id) throw new Error('Team Id is required.');
  if (!label) throw new Error('Team Name is required.');
  if (!/^[a-zA-Z0-9_-]+$/.test(id)) {
    throw new Error('Team Id may only contain letters, numbers, hyphens, underscores.');
  }
  if (color && !/^#[0-9A-Fa-f]{6}$/.test(color)) {
    throw new Error('Color must be a hex value like #8b5cf6.');
  }
  var sheet = requireSheetByKeyword_('team', 'Teams');
  var map = headerMap_(sheet);
  var idC = colOf_(map, ['title', 'id', 'team id']);
  if (findRowByValue_(sheet, idC, id) >= 0) throw new Error('Team Id already exists: ' + id);

  var row = buildEmptyRow_(sheet);
  setCol_(row, idC, id);
  setCol_(row, colOf_(map, ['label', 'name', 'team name']), label);
  setCol_(row, colOf_(map, ['color', 'colour']), color);
  sheet.appendRow(row);
  return { ok: true };
}

function deleteTeam_(body) {
  var id = String(body.teamId || body.id || '').trim();
  if (!id) throw new Error('Team Id is required.');
  var usage = countProjectsUsingTeam_(id);
  if (usage > 0) {
    throw new Error('Cannot delete team "' + id + '": used by ' + usage + ' project(s).');
  }
  var sheet = requireSheetByKeyword_('team', 'Teams');
  var idC = colOf_(headerMap_(sheet), ['title', 'id', 'team id']);
  var rowIndex = findRowByValue_(sheet, idC, id);
  if (rowIndex < 0) throw new Error('Team Id not found: ' + id);
  sheet.deleteRow(rowIndex);
  return { ok: true };
}

function countProjectsUsingTeam_(teamId) {
  var sheet = getSheetByKeyword_('project');
  if (!sheet) return 0;
  var lastRow = sheet.getLastRow();
  if (lastRow < 2) return 0;
  var c = projectColumns_(sheet);
  if (c.teams < 1) return 0;
  var target = String(teamId || '').trim().toLowerCase();
  var values = sheet.getRange(2, c.teams, lastRow - 1, 1).getValues();
  var count = 0;
  for (var i = 0; i < values.length; i++) {
    var ids = parseTeamsCell_(values[i][0]);
    for (var j = 0; j < ids.length; j++) {
      if (ids[j].toLowerCase() === target) { count++; break; }
    }
  }
  return count;
}

function addDomain_(body) {
  var name = String(body.name || body.label || '').trim();
  var id = String(body.id || '').trim().toLowerCase() ||
    name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
  if (!name) throw new Error('Domain name is required.');
  if (!id) throw new Error('Domain id could not be derived.');
  var reserved = ['meta', 'quarters', 'teams', 'cohorts', 'statuses', 'priorities',
    'cookiebotsites', 'cookiebotreports'];
  if (reserved.indexOf(id) >= 0) {
    throw new Error('"' + name + '" is a reserved name - pick a different one.');
  }
  var sheet = requireSheetByKeyword_('domain', 'Domains');
  var map = headerMap_(sheet);
  var idC = colOf_(map, ['title', 'id']);
  if (findRowByValue_(sheet, idC, id) >= 0) throw new Error('Domain already exists: ' + id);
  var row = buildEmptyRow_(sheet);
  setCol_(row, idC, id);
  setCol_(row, colOf_(map, ['name', 'label']), name);
  sheet.appendRow(row);
  return { ok: true };
}

function deleteDomain_(body) {
  var id = String(body.id || '').trim().toLowerCase();
  if (!id) throw new Error('Domain id is required.');
  var sheet = requireSheetByKeyword_('domain', 'Domains');
  var idC = colOf_(headerMap_(sheet), ['title', 'id']);
  var rowIndex = findRowByValue_(sheet, idC, id);
  if (rowIndex < 0) throw new Error('Domain not found: ' + id);
  sheet.deleteRow(rowIndex);
  return { ok: true };
}

function addDefRow_(keyword, label, body) {
  var color = String(body.color || '').trim();
  if (!label) throw new Error('Name is required.');
  if (color && !/^#[0-9A-Fa-f]{6}$/.test(color)) {
    throw new Error('Color must be a hex value like #3b82f6.');
  }
  var sheet = requireSheetByKeyword_(keyword, keyword);
  var map = headerMap_(sheet);
  var labelC = colOf_(map, ['title', 'label', 'name']);
  if (findRowByValue_(sheet, labelC, label) >= 0) throw new Error('Already exists: ' + label);
  var row = buildEmptyRow_(sheet);
  setCol_(row, labelC, label);
  setCol_(row, colOf_(map, ['color', 'colour']), color);
  var orderC = colOf_(map, ['sortorder', 'sort order', 'order']);
  if (orderC) setCol_(row, orderC, Math.max(0, sheet.getLastRow() - 1));
  sheet.appendRow(row);
  return { ok: true };
}

function deleteDefRow_(keyword, label) {
  var sheet = requireSheetByKeyword_(keyword, keyword);
  var labelC = colOf_(headerMap_(sheet), ['title', 'label', 'name']);
  var rowIndex = findRowByValue_(sheet, labelC, label);
  if (rowIndex < 0) throw new Error('Not found: ' + label);
  sheet.deleteRow(rowIndex);
  return { ok: true };
}

function addStatus_(body) {
  return addDefRow_('status', String(body.label || body.name || '').trim(), body);
}
function deleteStatus_(body) {
  return deleteDefRow_('status', String(body.label || body.id || '').trim());
}
function addPriority_(body) {
  return addDefRow_('priorit', String(body.label || body.name || '').trim(), body);
}
function deletePriority_(body) {
  return deleteDefRow_('priorit', String(body.label || body.id || '').trim());
}

/* ========================= Incident configuration ========================= */

var INCIDENT_CONFIG_SHEET_NAME = 'Incident Config';
var INCIDENT_CONFIG_COLUMN_DEFS = [
  { key: 'sections', header: 'Section', values: ['Outage', 'Track Event'], width: 130 },
  { key: 'outageCauses', header: 'Outage Cause', values: [
    'CDN / Akamai', 'Application Failure', 'Database Failure', 'Hosting Issue',
    'Third-Party Dependency', 'Bot Attack', 'Infrastructure Degradation', 'Other',
  ], width: 190 },
  { key: 'trackEventCauses', header: 'Track Event Cause', values: [
    'Release', 'Hotfix', 'Rollback', 'Infra Change', 'Scheduled Maintenance',
    'Security Incident', 'Partial Degradation', 'Functional Issue', 'Migration', 'Other',
  ], width: 190 },
  { key: 'domains', header: 'Domain', values: [
    'Relias Academy', 'Nurse.com', 'Relias Academy LMS', 'Relias Platform',
    'Relias Media', 'Multiple', 'Infrastructure',
  ], width: 170 },
  { key: 'severities', header: 'Severity', values: ['Critical', 'High', 'Medium', 'Low'], width: 110 },
  { key: 'statuses', header: 'Status', values: ['Active', 'Monitoring', 'Resolved'], width: 120 },
  { key: 'revenueImpacts', header: 'Revenue Impact', values: ['$', '$$', '$$$'], width: 140 },
  { key: 'customerImpactPrefixes', header: 'Customer Impact Prefix', values: [
    'None', 'Minor', 'Partial', 'Full',
  ], width: 190 },
];

function getIncidentConfigSheet_() {
  var sheets = ss_().getSheets();
  var target = normalize_(INCIDENT_CONFIG_SHEET_NAME);
  for (var i = 0; i < sheets.length; i++) {
    if (normalize_(sheets[i].getName()) === target) return sheets[i];
  }
  return null;
}

function incidentConfigColumn_(def) {
  for (var i = 0; i < INCIDENT_CONFIG_COLUMN_DEFS.length; i++) {
    if (INCIDENT_CONFIG_COLUMN_DEFS[i].key === def.key) return i + 1;
  }
  return 0;
}

function defaultIncidentConfig_() {
  var out = {};
  for (var i = 0; i < INCIDENT_CONFIG_COLUMN_DEFS.length; i++) {
    var def = INCIDENT_CONFIG_COLUMN_DEFS[i];
    out[def.key] = def.values.slice();
  }
  return out;
}

function readIncidentConfig_() {
  var sheet = getIncidentConfigSheet_();
  if (!sheet) return defaultIncidentConfig_();

  var out = {};
  // Bulk range reads are unsupported when Google Sheets assigns table column
  // types. Single-cell reads work for both typed tables and plain ranges.
  var maxRow = sheet.getMaxRows();
  for (var i = 0; i < INCIDENT_CONFIG_COLUMN_DEFS.length; i++) {
    var def = INCIDENT_CONFIG_COLUMN_DEFS[i];
    var col = incidentConfigColumn_(def);
    var values = [];
    if (col > 0 && maxRow >= 2) {
      for (var row = 2; row <= maxRow; row++) {
        var value = String(sheet.getRange(row, col).getValue() || '').trim();
        if (!value) break;
        values.push(value);
      }
    }
    out[def.key] = values;
  }
  return out;
}

/**
 * Create and seed a new config tab. Existing list values, including intentionally
 * empty lists, are never replaced when the setup is run again.
 */
function ensureIncidentConfigSheet_() {
  var sheet = getIncidentConfigSheet_();
  var seedDefaults = !sheet;
  if (!sheet) sheet = ss_().insertSheet(INCIDENT_CONFIG_SHEET_NAME);
  if (!seedDefaults) {
    seedDefaults = !String(sheet.getRange(1, 1).getValue() || '').trim();
  }

  ensureColumnCount_(sheet, INCIDENT_CONFIG_COLUMN_DEFS.length);
  for (var i = 0; i < INCIDENT_CONFIG_COLUMN_DEFS.length; i++) {
    var def = INCIDENT_CONFIG_COLUMN_DEFS[i];
    var col = i + 1;
    sheet.getRange(1, col).setValue(def.header);
    sheet.setColumnWidth(col, def.width);

    if (seedDefaults) {
      var values = def.values.map(function (value) { return [value]; });
      sheet.getRange(2, col, values.length, 1).setValues(values);
    }
  }

  styleIncidentHeaders_(sheet, INCIDENT_CONFIG_COLUMN_DEFS.length);
  return sheet;
}

function setupIncidentConfig_() {
  var configSheet = ensureIncidentConfigSheet_();
  var incidentSheet = getIncidentSheet_();
  if (incidentSheet) applyIncidentValidation_(incidentSheet, null);
  return {
    ok: true,
    sheet: configSheet.getName(),
    incidentConfig: readIncidentConfig_(),
  };
}

/** Run from the spreadsheet menu when setting up the workbook by hand. */
function setupIncidentConfigSheet() {
  var result = setupIncidentConfig_();
  return 'Incident Config tab ready: "' + result.sheet + '"';
}

/* ==================== Incidents (Operations Timeline) ==================== */
/*
 * Tab name must contain "incident". Headers (row 1, order flexible):
 *
 *   ID | Date | Domain | Title | Type | Severity | Duration |
 *   Customer Impact | Revenue Impact | Status | Notes | Links
 *
 * Nothing here needs to be set up by hand. The first save creates the tab if it
 * is missing, and adds any header the tab does not have yet (see
 * ensureIncidentSheet_). You can also run setupIncidentsSheet() once from the
 * script editor, or use the "Communities Toolbox" menu in the spreadsheet.
 *
 * ID is generated by the app (INC-0001, …) and is only used to find the row
 * again on edit/delete — nobody types it. Date accepts "2026-06-25" or
 * "2026-06-25 09:15"; Duration accepts "33h", "2h 30m", "45m", "1d 4h".
 */

var INCIDENT_SHEET_NAME = 'Incidents';
var INCIDENT_DATE_RE = /^\d{4}-\d{2}-\d{2}( \d{2}:\d{2})?$/;

/**
 * The canonical column list. `header` is what gets created; `aliases` are the
 * header names already accepted when reading, so a tab that calls the column
 * "Event" instead of "Title" is left alone rather than given a second column.
 */
var INCIDENT_COLUMN_DEFS = [
  { key: 'id', header: 'ID', aliases: ['id', 'event id', 'incident id'], width: 90 },
  { key: 'key', header: 'Key', aliases: ['key', 'external id', 'externalid', 'correlation id', 'dedupe key', 'alert id', 'source id'], width: 150 },
  // 'date' stays an alias so a sheet created before Start/End existed keeps
  // working: its Date column is read as the start and never duplicated.
  { key: 'start', header: 'Start', aliases: ['start', 'start date', 'start time', 'started', 'date', 'date time', 'date / time'], width: 140 },
  { key: 'end', header: 'End', aliases: ['end', 'end date', 'end time', 'ended', 'resolved', 'resolved at'], width: 140 },
  { key: 'domain', header: 'Domain', aliases: ['domain', 'system', 'site', 'property'], width: 150 },
  { key: 'title', header: 'Title', aliases: ['title', 'event', 'name', 'summary'], width: 220 },
  { key: 'type', header: 'Type', aliases: ['type', 'event type'], width: 160 },
  { key: 'cause', header: 'Cause', aliases: ['cause', 'root cause type', 'event cause'], width: 160 },
  { key: 'severity', header: 'Severity', aliases: ['severity', 'impact level'], width: 100 },
  { key: 'duration', header: 'Duration', aliases: ['duration'], width: 90 },
  { key: 'customerImpact', header: 'Customer Impact', aliases: ['customer impact', 'customer', 'impact'], width: 220 },
  { key: 'revenueImpact', header: 'Revenue Impact', aliases: ['revenue impact', 'revenue'], width: 130 },
  { key: 'status', header: 'Status', aliases: ['status'], width: 110 },
  { key: 'notes', header: 'Notes', aliases: ['notes', 'root cause', 'description'], width: 320 },
  { key: 'links', header: 'Links', aliases: ['links', 'link', 'references'], width: 220 },
];

/** Dropdown values written as data validation when a column is created. */
var INCIDENT_CHOICES = {
  type: ['Outage', 'Track Event'],
  cause: [
    // Outage causes
    'CDN / Akamai', 'Application Failure', 'Hosting Issue', 'Bot Attack', 'Infra Degradation', 'Other',
    // Track Event causes
    'Release', 'Hotfix', 'Infra Change', 'Scheduled Maintenance',
    'Security Incident', 'Partial Degradation', 'Functional Issue', 'Migration'
  ],
  severity: ['Critical', 'High', 'Medium', 'Low'],
  status: ['Active', 'Monitoring', 'Resolved'],
};

function incidentHeaders_() {
  return INCIDENT_COLUMN_DEFS.map(function (def) { return def.header; });
}

function incidentColumns_(sheet) {
  var map = headerMap_(sheet);
  var cols = {};
  for (var i = 0; i < INCIDENT_COLUMN_DEFS.length; i++) {
    var def = INCIDENT_COLUMN_DEFS[i];
    cols[def.key] = colOf_(map, def.aliases);
  }
  return cols;
}

function getIncidentSheet_() {
  var sheets = ss_().getSheets();
  var exact = normalize_(INCIDENT_SHEET_NAME);
  for (var i = 0; i < sheets.length; i++) {
    if (normalize_(sheets[i].getName()) === exact) return sheets[i];
  }
  for (var j = 0; j < sheets.length; j++) {
    var name = normalize_(sheets[j].getName());
    if (name.indexOf('incident') >= 0 && name !== normalize_(INCIDENT_CONFIG_SHEET_NAME)) {
      return sheets[j];
    }
  }
  return null;
}

/* ------------------------- Self-setup (create/repair) --------------------- */

/**
 * Hand back a usable Incidents tab, creating or repairing it as needed:
 *   - no tab whose name contains "incident"  -> create one, formatted
 *   - tab exists but row 1 is empty          -> write the full header row
 *   - tab exists but a column is missing     -> append just that header
 * Reads never call this; only writes do, so a GET can't mutate the spreadsheet.
 */
function ensureIncidentSheet_() {
  var sheet = getIncidentSheet_();
  if (!sheet) return createIncidentSheet_();
  addMissingIncidentHeaders_(sheet);
  return sheet;
}

function createIncidentSheet_() {
  var sheet = ss_().insertSheet(INCIDENT_SHEET_NAME);
  var headers = incidentHeaders_();
  sheet.getRange(1, 1, 1, headers.length).setValues([headers]);
  styleIncidentHeaders_(sheet, headers.length);

  for (var i = 0; i < INCIDENT_COLUMN_DEFS.length; i++) {
    sheet.setColumnWidth(i + 1, INCIDENT_COLUMN_DEFS[i].width);
  }
  // Trim the default blank columns so the tab reads as a purpose-built sheet.
  var extra = sheet.getMaxColumns() - headers.length;
  if (extra > 0) sheet.deleteColumns(headers.length + 1, extra);

  applyIncidentValidation_(sheet, null);
  return sheet;
}

function styleIncidentHeaders_(sheet, columnCount) {
  var range = sheet.getRange(1, 1, 1, columnCount);
  range.setFontWeight('bold');
  range.setBackground('#f1f3f4');
  if (sheet.getFrozenRows() < 1) sheet.setFrozenRows(1);
}

/** Add any canonical header the tab is missing, without touching its own columns. */
function addMissingIncidentHeaders_(sheet) {
  var map = headerMap_(sheet);
  var hasAnyHeader = false;
  for (var key in map) { if (map.hasOwnProperty(key)) { hasAnyHeader = true; break; } }

  if (!hasAnyHeader) {
    var headers = incidentHeaders_();
    ensureColumnCount_(sheet, headers.length);
    sheet.getRange(1, 1, 1, headers.length).setValues([headers]);
    styleIncidentHeaders_(sheet, headers.length);
    applyIncidentValidation_(sheet, null);
    return headers;
  }

  var addedKeys = [];
  var col = sheet.getLastColumn();
  for (var i = 0; i < INCIDENT_COLUMN_DEFS.length; i++) {
    var def = INCIDENT_COLUMN_DEFS[i];
    if (colOf_(map, def.aliases) > 0) continue;
    col++;
    ensureColumnCount_(sheet, col);
    sheet.getRange(1, col).setValue(def.header);
    addedKeys.push(def.key);
  }

  if (addedKeys.length > 0) {
    styleIncidentHeaders_(sheet, sheet.getLastColumn());
    applyIncidentValidation_(sheet, addedKeys);
  }
  return addedKeys;
}

function ensureColumnCount_(sheet, needed) {
  var max = sheet.getMaxColumns();
  if (needed > max) sheet.insertColumnsAfter(max, needed - max);
}

/**
 * Apply legacy Type validation plus config-backed Domain, Severity, Status, and
 * Revenue Impact validation. Invalid values remain allowed so historical data
 * is not blocked when an option is retired from the config.
 */
function applyIncidentValidation_(sheet, onlyKeys) {
  var cols = incidentColumns_(sheet);
  var rows = sheet.getMaxRows() - 1;
  if (rows < 1) return;
  var configSheet = getIncidentConfigSheet_();
  var configKeys = {
    domain: 'domains',
    severity: 'severities',
    status: 'statuses',
    revenueImpact: 'revenueImpacts',
  };

  for (var key in INCIDENT_CHOICES) {
    if (!INCIDENT_CHOICES.hasOwnProperty(key)) continue;
    if (onlyKeys && onlyKeys.indexOf(key) < 0) continue;
    var col = cols[key];
    if (!col || col < 1) continue;
    var rule = SpreadsheetApp.newDataValidation()
      .requireValueInList(INCIDENT_CHOICES[key], true)
      .setAllowInvalid(true)
      .build();
    sheet.getRange(2, col, rows, 1).setDataValidation(rule);
  }

  if (!configSheet) return;
  for (var incidentKey in configKeys) {
    if (!configKeys.hasOwnProperty(incidentKey)) continue;
    if (onlyKeys && onlyKeys.indexOf(incidentKey) < 0) continue;
    var incidentCol = cols[incidentKey];
    if (!incidentCol || incidentCol < 1) continue;

    var configKey = configKeys[incidentKey];
    var configDef = null;
    for (var i = 0; i < INCIDENT_CONFIG_COLUMN_DEFS.length; i++) {
      if (INCIDENT_CONFIG_COLUMN_DEFS[i].key === configKey) {
        configDef = INCIDENT_CONFIG_COLUMN_DEFS[i];
        break;
      }
    }
    if (!configDef) continue;
    var configCol = incidentConfigColumn_(configDef);
    if (!configCol || configCol < 1 || configSheet.getMaxRows() < 2) continue;

    var configRange = configSheet.getRange(2, configCol, configSheet.getMaxRows() - 1, 1);
    var configRule = SpreadsheetApp.newDataValidation()
      .requireValueInRange(configRange, true)
      .setAllowInvalid(true)
      .build();
    sheet.getRange(2, incidentCol, rows, 1).setDataValidation(configRule);
  }
}

/** Run once from the script editor (or the menu) to create/repair the tab. */
function setupIncidentsSheet() {
  var sheet = ensureIncidentSheet_();
  return 'Incidents tab ready: "' + sheet.getName() + '"';
}

function onOpen() {
  SpreadsheetApp.getUi()
    .createMenu('Communities Toolbox')
    .addItem('Set up Incident Config tab', 'setupIncidentConfigSheet')
    .addItem('Set up Incidents tab', 'setupIncidentsSheet')
    .addToUi();
}

/** Keep the clock when the cell has one, so hour-level bars stay accurate. */
function formatIncidentDateCell_(value) {
  if (value === null || value === undefined || value === '') return '';
  if (Object.prototype.toString.call(value) === '[object Date]' && !isNaN(value.getTime())) {
    var tz = Session.getScriptTimeZone();
    var hasTime = value.getHours() !== 0 || value.getMinutes() !== 0;
    return Utilities.formatDate(value, tz, hasTime ? 'yyyy-MM-dd HH:mm' : 'yyyy-MM-dd');
  }
  return String(value).trim();
}

function readIncidents_() {
  var sheet = getIncidentSheet_();
  if (!sheet) return [];
  var lastRow = sheet.getLastRow();
  if (lastRow < 2) return [];
  var c = incidentColumns_(sheet);
  var values = sheet.getRange(2, 1, lastRow - 1, sheet.getLastColumn()).getValues();
  var out = [];
  for (var r = 0; r < values.length; r++) {
    var row = values[r];
    var start = formatIncidentDateCell_(cell_(row, c.start));
    var end = formatIncidentDateCell_(cell_(row, c.end));
    var title = String(cell_(row, c.title) || '').trim();
    if (!start && !title) continue;
    out.push({
      id: String(cell_(row, c.id) || '').trim() || ('ROW-' + (r + 2)),
      key: String(cell_(row, c.key) || '').trim(),
      start: start,
      end: end,
      date: start, // legacy field name, kept so older clients keep working

      domain: String(cell_(row, c.domain) || '').trim(),
      title: title,
      type: String(cell_(row, c.type) || '').trim(),
      severity: String(cell_(row, c.severity) || '').trim(),
      duration: String(cell_(row, c.duration) || '').trim(),
      customerImpact: String(cell_(row, c.customerImpact) || '').trim(),
      revenueImpact: String(cell_(row, c.revenueImpact) || '').trim(),
      status: String(cell_(row, c.status) || '').trim(),
      notes: String(cell_(row, c.notes) || '').trim(),
      links: String(cell_(row, c.links) || '').trim(),
    });
  }
  return out;
}

function incidentValues_(body) {
  return {
    id: String(body.id || '').trim(),
    key: String(body.key || body.externalId || '').trim(),
    start: String(body.start || body.date || '').trim(),
    end: String(body.end || '').trim(),
    domain: String(body.domain || '').trim(),
    title: String(body.title || '').trim(),
    type: String(body.type || '').trim(),
    severity: String(body.severity || '').trim(),
    duration: String(body.duration || '').trim(),
    customerImpact: String(body.customerImpact || '').trim(),
    revenueImpact: String(body.revenueImpact || '').trim(),
    status: String(body.status || '').trim(),
    notes: String(body.notes || '').trim(),
    links: String(body.links || '').trim(),
  };
}

function writeIncidentRow_(row, c, v) {
  setCol_(row, c.id, v.id);
  setCol_(row, c.key, v.key);
  // Leading apostrophe keeps Sheets from reformatting the timestamp into its
  // own locale — the app parses "yyyy-MM-dd HH:mm" back out verbatim.
  setCol_(row, c.start, v.start ? "'" + v.start : '');
  setCol_(row, c.end, v.end ? "'" + v.end : '');
  setCol_(row, c.domain, v.domain);
  setCol_(row, c.title, v.title);
  setCol_(row, c.type, v.type);
  setCol_(row, c.severity, v.severity);
  setCol_(row, c.duration, v.duration);
  setCol_(row, c.customerImpact, v.customerImpact);
  setCol_(row, c.revenueImpact, v.revenueImpact);
  setCol_(row, c.status, v.status);
  setCol_(row, c.notes, v.notes);
  setCol_(row, c.links, v.links);
}

function nextIncidentId_(sheet, idCol) {
  var lastRow = sheet.getLastRow();
  var max = 0;
  if (lastRow >= 2 && idCol > 0) {
    var values = sheet.getRange(2, idCol, lastRow - 1, 1).getValues();
    for (var i = 0; i < values.length; i++) {
      var m = String(values[i][0] || '').match(/(\d+)\s*$/);
      if (m) max = Math.max(max, parseInt(m[1], 10));
    }
  }
  var next = String(max + 1);
  while (next.length < 4) next = '0' + next;
  return 'INC-' + next;
}

function validateIncidentFields_(v) {
  if (!v.start) throw new Error('Start is required.');
  if (!INCIDENT_DATE_RE.test(v.start)) {
    throw new Error('Start must be YYYY-MM-DD or YYYY-MM-DD HH:MM.');
  }
  if (v.end) {
    if (!INCIDENT_DATE_RE.test(v.end)) {
      throw new Error('End must be YYYY-MM-DD or YYYY-MM-DD HH:MM.');
    }
    // Same format both sides, so a string compare is a safe chronology check.
    if (v.end < v.start) throw new Error('End must be on or after Start.');
  }
  if (!v.domain) throw new Error('Domain is required.');
  if (!v.title) throw new Error('Title is required.');
}

var OPEN_STATUSES = ['active', 'monitoring', 'investigating', 'open'];

function isOpenStatus_(value) {
  return OPEN_STATUSES.indexOf(String(value || '').trim().toLowerCase()) >= 0;
}

/**
 * Find the row an automated poster means, without it having to remember an ID.
 * Preference order, most explicit first:
 *   1. exact ID
 *   2. Key, still-open row  (the normal "close the thing I opened" case)
 *   3. Key, any row
 *   4. Domain + Title, still-open row (last resort for posters with no key)
 * Returns -1 when nothing matches.
 */
function findIncidentRow_(sheet, c, opts) {
  var id = String(opts.id || '').trim().toLowerCase();
  var key = String(opts.key || '').trim().toLowerCase();
  var domain = String(opts.domain || '').trim().toLowerCase();
  var title = String(opts.title || '').trim().toLowerCase();

  var lastRow = sheet.getLastRow();
  if (lastRow < 2) return -1;
  var values = sheet.getRange(2, 1, lastRow - 1, sheet.getLastColumn()).getValues();

  var keyOpen = -1, keyAny = -1, pairOpen = -1;
  for (var i = 0; i < values.length; i++) {
    var row = values[i];
    var rowIndex = i + 2;
    if (id && String(cell_(row, c.id) || '').trim().toLowerCase() === id) return rowIndex;

    var open = isOpenStatus_(cell_(row, c.status));
    if (key && String(cell_(row, c.key) || '').trim().toLowerCase() === key) {
      if (open && keyOpen < 0) keyOpen = rowIndex;
      if (keyAny < 0) keyAny = rowIndex;
    }
    if (!key && domain && title && open &&
        String(cell_(row, c.domain) || '').trim().toLowerCase() === domain &&
        String(cell_(row, c.title) || '').trim().toLowerCase() === title) {
      if (pairOpen < 0) pairOpen = rowIndex;
    }
  }
  if (keyOpen >= 0) return keyOpen;
  if (keyAny >= 0) return keyAny;
  return pairOpen;
}

function rowToIncident_(sheet, c, rowIndex) {
  var row = sheet.getRange(rowIndex, 1, 1, sheet.getLastColumn()).getValues()[0];
  return {
    id: String(cell_(row, c.id) || '').trim(),
    key: String(cell_(row, c.key) || '').trim(),
    start: formatIncidentDateCell_(cell_(row, c.start)),
    end: formatIncidentDateCell_(cell_(row, c.end)),
    domain: String(cell_(row, c.domain) || '').trim(),
    title: String(cell_(row, c.title) || '').trim(),
    status: String(cell_(row, c.status) || '').trim(),
  };
}

/** "yyyy-MM-dd HH:mm" for right now, in the script's timezone. */
function nowStamp_() {
  return Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyyy-MM-dd HH:mm');
}

/**
 * Close an incident that is already logged. Accepts `id`, or `key`, or
 * domain+title — so a poster that has forgotten everything except what it is
 * monitoring can still resolve the right row. `end` defaults to now.
 */
function resolveIncident_(body) {
  var sheet = ensureIncidentSheet_();
  var c = incidentColumns_(sheet);
  var rowIndex = findIncidentRow_(sheet, c, {
    id: body.id,
    key: body.key || body.externalId,
    domain: body.domain,
    title: body.title,
  });
  if (rowIndex < 0) {
    throw new Error('No matching event to resolve. Pass id, key, or domain + title.');
  }

  var existing = rowToIncident_(sheet, c, rowIndex);
  var end = String(body.end || '').trim() || nowStamp_();
  if (!INCIDENT_DATE_RE.test(end)) {
    throw new Error('End must be YYYY-MM-DD or YYYY-MM-DD HH:MM.');
  }
  if (existing.start && end < existing.start) {
    throw new Error('End must be on or after Start (' + existing.start + ').');
  }

  var lastCol = sheet.getLastColumn();
  var row = sheet.getRange(rowIndex, 1, 1, lastCol).getValues()[0];
  setCol_(row, c.end, "'" + end);
  setCol_(row, c.status, String(body.status || 'Resolved').trim());
  // Only overwrite the optional fields the caller actually sent.
  ['severity', 'customerImpact', 'revenueImpact', 'notes', 'links'].forEach(function (field) {
    var value = body[field];
    if (value !== undefined && value !== null && String(value).trim() !== '') {
      setCol_(row, c[field], String(value).trim());
    }
  });
  // The range now defines the length, so a stale duration must not linger.
  setCol_(row, c.duration, '');
  sheet.getRange(rowIndex, 1, 1, lastCol).setValues([row]);

  return { ok: true, id: existing.id, key: existing.key, end: end, resolved: true };
}

/** Open events, so a poster can ask "what have I already logged?" */
function listOpenIncidents_() {
  var all = readIncidents_();
  var out = [];
  for (var i = 0; i < all.length; i++) {
    if (isOpenStatus_(all[i].status)) out.push(all[i]);
  }
  return { ok: true, incidents: out };
}

function addIncident_(body) {
  var sheet = ensureIncidentSheet_();
  var c = incidentColumns_(sheet);
  var v = incidentValues_(body);
  validateIncidentFields_(v);

  // A repeated alert for something already open is the same incident. Update
  // it in place so a flapping monitor cannot create ten rows for one outage.
  if (v.key) {
    var existingRow = findIncidentRow_(sheet, c, { key: v.key });
    if (existingRow >= 0) {
      var current = rowToIncident_(sheet, c, existingRow);
      var lastColU = sheet.getLastColumn();
      var updated = sheet.getRange(existingRow, 1, 1, lastColU).getValues()[0];
      v.id = current.id;
      // Keep the original start: an outage began when it began.
      v.start = current.start || v.start;
      writeIncidentRow_(updated, c, v);
      sheet.getRange(existingRow, 1, 1, lastColU).setValues([updated]);
      return { ok: true, id: v.id, key: v.key, updated: true, created: false };
    }
  }

  if (!v.id) v.id = nextIncidentId_(sheet, c.id);
  if (findRowByValue_(sheet, c.id, v.id) >= 0) {
    // Two people logging at once can pick the same id; take the next free one.
    v.id = nextIncidentId_(sheet, c.id);
  }

  var row = buildEmptyRow_(sheet);
  writeIncidentRow_(row, c, v);
  sheet.appendRow(row);
  return { ok: true, id: v.id, key: v.key, updated: false, created: true };
}

function updateIncident_(body) {
  var sheet = ensureIncidentSheet_();
  var c = incidentColumns_(sheet);
  var v = incidentValues_(body);
  if (!v.id && !v.key) throw new Error('Event ID or Key is required.');
  validateIncidentFields_(v);

  var rowIndex = findIncidentRow_(sheet, c, { id: v.id, key: v.key });
  if (rowIndex < 0) throw new Error('Event not found: ' + (v.id || v.key));
  if (!v.id) v.id = rowToIncident_(sheet, c, rowIndex).id;

  var lastCol = sheet.getLastColumn();
  var row = sheet.getRange(rowIndex, 1, 1, lastCol).getValues()[0];
  writeIncidentRow_(row, c, v);
  sheet.getRange(rowIndex, 1, 1, lastCol).setValues([row]);
  return { ok: true, id: v.id };
}

function deleteIncident_(body) {
  var sheet = ensureIncidentSheet_();
  var c = incidentColumns_(sheet);
  var id = String(body.id || '').trim();
  if (!id) throw new Error('Event ID is required.');
  var rowIndex = findRowByValue_(sheet, c.id, id);
  if (rowIndex < 0) throw new Error('Event not found: ' + id);
  sheet.deleteRow(rowIndex);
  return { ok: true };
}

/* ========================= Cookiebot Sites/Reports ======================== */

function readCookiebotSites_() {
  var sheet = getSheetByKeyword_('cookiebot site');
  if (!sheet) return [];
  var lastRow = sheet.getLastRow();
  if (lastRow < 2) return [];
  var map = headerMap_(sheet);
  var nameC = colOf_(map, ['name', 'site', 'title']);
  var domainC = colOf_(map, ['domain', 'url']);
  var values = sheet.getRange(2, 1, lastRow - 1, sheet.getLastColumn()).getValues();
  var out = [];
  for (var r = 0; r < values.length; r++) {
    var name = String(cell_(values[r], nameC) || '').trim();
    if (!name) continue;
    out.push({ name: name, domain: String(cell_(values[r], domainC) || '').trim() });
  }
  return out;
}

function readCookiebotReports_() {
  var sheet = getSheetByKeyword_('cookiebot report');
  if (!sheet) return [];
  var lastRow = sheet.getLastRow();
  if (lastRow < 2) return [];
  var map = headerMap_(sheet);
  var siteC = colOf_(map, ['site']);
  var fileC = colOf_(map, ['file name', 'filename', 'file']);
  var upC = colOf_(map, ['uploaded', 'uploaded at']);
  var sizeC = colOf_(map, ['size']);
  var dataC = colOf_(map, ['data (json)', 'data', 'json']);
  var values = sheet.getRange(2, 1, lastRow - 1, sheet.getLastColumn()).getValues();
  var out = [];
  for (var r = 0; r < values.length; r++) {
    var site = String(cell_(values[r], siteC) || '').trim();
    var file = String(cell_(values[r], fileC) || '').trim();
    if (!site && !file) continue;
    var data = null;
    var raw = String(cell_(values[r], dataC) || '').trim();
    if (raw) { try { data = JSON.parse(raw); } catch (e) { data = null; } }
    out.push({
      site: site,
      fileName: file,
      uploaded: String(cell_(values[r], upC) || '').trim(),
      size: String(cell_(values[r], sizeC) || '').trim(),
      data: data,
    });
  }
  return out;
}

function addCookiebotSite_(body) {
  var name = String(body.name || '').trim();
  var domain = String(body.domain || body.url || '').trim();
  if (!name) throw new Error('Site name is required.');
  var sheet = requireSheetByKeyword_('cookiebot site', 'Cookiebot Sites');
  var map = headerMap_(sheet);
  var nameC = colOf_(map, ['name', 'site', 'title']);
  if (findRowByValue_(sheet, nameC, name) >= 0) throw new Error('Site already exists: ' + name);
  var row = buildEmptyRow_(sheet);
  setCol_(row, nameC, name);
  setCol_(row, colOf_(map, ['domain', 'url']), domain);
  sheet.appendRow(row);
  return { ok: true };
}

function deleteCookiebotSite_(body) {
  var name = String(body.name || '').trim();
  if (!name) throw new Error('Site name is required.');
  var sheet = requireSheetByKeyword_('cookiebot site', 'Cookiebot Sites');
  var nameC = colOf_(headerMap_(sheet), ['name', 'site', 'title']);
  var rowIndex = findRowByValue_(sheet, nameC, name);
  if (rowIndex < 0) throw new Error('Site not found: ' + name);
  sheet.deleteRow(rowIndex);
  return { ok: true };
}

function addCookiebotReport_(body) {
  var site = String(body.site || '').trim();
  var fileName = String(body.fileName || body.file || '').trim();
  if (!site) throw new Error('Site is required.');
  if (!fileName) throw new Error('File name is required.');
  var data = body.data;
  var dataStr = typeof data === 'string' ? data : JSON.stringify(data || {});
  var d = (typeof data === 'object' && data) ? data : {};

  var sheet = requireSheetByKeyword_('cookiebot report', 'Cookiebot Reports');
  var map = headerMap_(sheet);
  var row = buildEmptyRow_(sheet);
  setCol_(row, colOf_(map, ['site']), site);
  setCol_(row, colOf_(map, ['file name', 'filename', 'file']), fileName);
  setCol_(row, colOf_(map, ['uploaded', 'uploaded at']), String(body.uploaded || ''));
  setCol_(row, colOf_(map, ['size']), String(body.size || ''));
  setCol_(row, colOf_(map, ['domain']), String(d.domain || ''));
  setCol_(row, colOf_(map, ['scan date']), String(d.scanDate || ''));
  setCol_(row, colOf_(map, ['total cookies']), String(d.total || ''));
  setCol_(row, colOf_(map, ['new']), String(d.newCookies || ''));
  setCol_(row, colOf_(map, ['removed']), String(d.removedCookies || ''));
  setCol_(row, colOf_(map, ['not blocked']), String(d.notBlockedCount || 0));
  setCol_(row, colOf_(map, ['server']), String(d.serverLocation || ''));
  setCol_(row, colOf_(map, ['gcm risk']), String((d.gcm && d.gcm.riskSummary) || ''));
  setCol_(row, colOf_(map, ['data (json)', 'data', 'json']), dataStr);
  sheet.appendRow(row);
  return { ok: true };
}

function deleteCookiebotReport_(body) {
  var site = String(body.site || '').trim().toLowerCase();
  var fileName = String(body.fileName || body.file || '').trim().toLowerCase();
  var uploaded = String(body.uploaded || '').trim().toLowerCase();
  var sheet = requireSheetByKeyword_('cookiebot report', 'Cookiebot Reports');
  var map = headerMap_(sheet);
  var siteC = colOf_(map, ['site']);
  var fileC = colOf_(map, ['file name', 'filename', 'file']);
  var upC = colOf_(map, ['uploaded', 'uploaded at']);
  var lastRow = sheet.getLastRow();
  if (lastRow < 2) throw new Error('No reports.');
  var values = sheet.getRange(2, 1, lastRow - 1, sheet.getLastColumn()).getValues();
  for (var r = 0; r < values.length; r++) {
    var s = String(cell_(values[r], siteC) || '').trim().toLowerCase();
    var f = String(cell_(values[r], fileC) || '').trim().toLowerCase();
    var u = String(cell_(values[r], upC) || '').trim().toLowerCase();
    if (s === site && f === fileName && (!uploaded || u === uploaded)) {
      sheet.deleteRow(r + 2);
      return { ok: true };
    }
  }
  throw new Error('Report not found.');
}

/* ================================ Plumbing ================================ */

function parsePostBody_(e) {
  if (!e || !e.postData || !e.postData.contents) {
    throw new Error('Missing request body.');
  }
  return JSON.parse(e.postData.contents);
}

function jsonResponse(obj) {
  var output = ContentService.createTextOutput(JSON.stringify(obj));
  output.setMimeType(ContentService.MimeType.JSON);
  return output;
}
