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
