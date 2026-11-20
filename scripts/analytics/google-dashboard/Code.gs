function doGet() {
  requireDashboardViewer_();
  return HtmlService.createHtmlOutputFromFile('Dashboard').setTitle('Toolbox Analytics')
    .addMetaTag('viewport', 'width=device-width, initial-scale=1');
}

function readDashboardSnapshot() {
  requireDashboardViewer_();
  var id = PropertiesService.getScriptProperties().getProperty('TOOLBOX_SPREADSHEET_ID');
  if (!id || !/^[A-Za-z0-9_-]+$/.test(id)) throw new Error('Analytics dashboard is not configured.');
  var result;
  try {
    result = Sheets.Spreadsheets.Values.get(id, "'Analytics'", { valueRenderOption: 'FORMULA' });
  } catch (error) {
    if ([403, 404].indexOf(Number(error.code)) >= 0 ||
        /permission|forbidden|not found|access denied/i.test(String(error.message))) {
      return { denied: true };
    }
    throw new Error('Could not read the Analytics snapshot.');
  }
  var snapshot = analyticsSnapshotFromTable_(result.values || []);
  return { snapshot: { version: snapshot.version, domains: snapshot.domains.map(function (row) {
    var view = {};
    ['id', 'name', 'host', 'url', 'currency', 'timeZone', 'fetchedAt', 'status', 'reason', 'windows']
      .forEach(function (key) { if (row[key] !== undefined) view[key] = row[key]; });
    return view;
  }) } };
}

function requireDashboardViewer_() {
  var active = Session.getActiveUser().getEmail().toLowerCase();
  var effective = Session.getEffectiveUser().getEmail().toLowerCase();
  if (!/^[^@\s]+@relias\.com$/.test(active) || active !== effective) {
    throw new Error('Use your Relias Google account to open Toolbox Analytics.');
  }
}
