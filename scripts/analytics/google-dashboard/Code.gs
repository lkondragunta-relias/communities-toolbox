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
    result = Sheets.Spreadsheets.Values.get(id, 'Analytics!A1', { valueRenderOption: 'FORMULA' });
  } catch (error) {
    if ([403, 404].indexOf(Number(error.code)) >= 0 ||
        /permission|forbidden|not found|access denied/i.test(String(error.message))) {
      return { denied: true };
    }
    throw new Error('Could not read the Analytics snapshot.');
  }
  var value = result.values && result.values[0] && result.values[0][0];
  if (value === undefined || value === '') return { snapshot: { version: 1, domains: [] } };
  if (typeof value !== 'string' || value.length > 49000 || value.charAt(0) !== '{') {
    throw new Error('Invalid Analytics snapshot.');
  }
  var snapshot = JSON.parse(value);
  if (snapshot.version !== 1 || !Array.isArray(snapshot.domains)) throw new Error('Invalid Analytics snapshot.');
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
