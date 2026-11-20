var ANALYTICS_FIELDS = [
  ['id', 'Domain ID'], ['name', 'Domain'], ['status', 'Status'], ['reason', 'Status detail'],
  ['attemptedAt', 'Refresh attempted (UTC)'], ['fetchedAt', 'Data fetched (UTC)'],
  ['timeZone', 'Reporting time zone'], ['currency', 'Currency'], ['propertyId', 'GA4 property ID'],
  ['host', 'Host'], ['url', 'GA4 reports URL'], ['streamId', 'GA4 stream ID'],
  ['scopeHosts', 'GA4 host filter'], ['includePurchases', 'Scoped purchases enabled'],
];
var ANALYTICS_WINDOWS = [
  ['day', 'Yesterday'], ['prior_day', 'Yesterday - previous week'],
  ['yoy_day', 'Yesterday - same period last year'], ['week', 'Last 7 days'],
  ['prior_week', 'Previous 7 days'], ['yoy_week', 'Last 7 days - same period last year'],
];
var ANALYTICS_METRICS = [
  ['sessions', 'Sessions'], ['totalUsers', 'Total users'], ['newUsers', 'New users'],
  ['purchaseRevenue', 'Purchase revenue'], ['ecommercePurchases', 'Purchases'],
  ['sessionKeyEventRate', 'Conversion rate'], ['averagePurchaseRevenue', 'Average order value'],
];

function analyticsColumns_(format) {
  return ANALYTICS_FIELDS.map(function (field) { return format ? '@' : field[1]; })
    .concat(ANALYTICS_WINDOWS.flatMap(function (window) {
      return ['Start date', 'End date'].concat(ANALYTICS_METRICS.map(function (metric) { return metric[1]; }))
        .map(function (label, index) { return format ? (index < 2 ? '@' : 'General') : window[1] + ' / ' + label; });
    }));
}

function analyticsTable_(snapshot) {
  if (!snapshot || snapshot.version !== 1 || !Array.isArray(snapshot.domains) || !snapshot.domains.length) {
    throw new Error('Invalid Analytics snapshot.');
  }
  return [analyticsColumns_(false)].concat(snapshot.domains.map(function (domain) {
    var fields = Object.assign({}, domain, {
      attemptedAt: snapshot.attemptedAt,
      streamId: domain.scope && domain.scope.streamId,
      scopeHosts: domain.scope && domain.scope.hosts.join(', '),
      includePurchases: domain.includePurchases === true ? 'Yes' : '',
    });
    return ANALYTICS_FIELDS.map(function (field) { return fields[field[0]] ?? ''; })
      .concat(ANALYTICS_WINDOWS.flatMap(function (window) {
        var data = domain.windows && domain.windows[window[0]];
        if (!data) return Array(2 + ANALYTICS_METRICS.length).fill('');
        return [data.startDate, data.endDate].concat(ANALYTICS_METRICS.map(function (metric) {
          return data.metrics[metric[0]] ?? '';
        }));
      }));
  }));
}

function analyticsSnapshotFromTable_(values) {
  var snapshot = { version: 1, domains: [] };
  if (!values.length) return snapshot;
  var headers = analyticsColumns_(false);
  if (values[0].length !== headers.length || headers.some(function (header, i) { return values[0][i] !== header; })) {
    throw new Error('Invalid Analytics headers.');
  }
  var ids = new Set();
  values.slice(1).forEach(function (row) {
    if (row.every(function (value) { return value === ''; })) return;
    if (row.length > headers.length) throw new Error('Unexpected Analytics columns.');
    var domain = {};
    ANALYTICS_FIELDS.forEach(function (field, index) {
      var value = row[index] ?? '';
      if (value === '') return;
      if (typeof value !== 'string' || value.length > 2000 || /^[=\u0000-\u001f]/.test(value.trim())) {
        throw new Error('Invalid Analytics metadata.');
      }
      domain[field[0]] = value;
    });
    var attemptedAt = domain.attemptedAt;
    if (!domain.id || !domain.name || ids.has(domain.id) ||
        ['Reported', 'Partial', 'Stale', 'Unavailable'].indexOf(domain.status) < 0 ||
        !analyticsTimestamp_(attemptedAt) || (snapshot.attemptedAt && snapshot.attemptedAt !== attemptedAt) ||
        (domain.fetchedAt && !analyticsTimestamp_(domain.fetchedAt))) throw new Error('Invalid Analytics row.');
    snapshot.attemptedAt = attemptedAt;
    ids.add(domain.id);
    if (domain.includePurchases && domain.includePurchases !== 'Yes') throw new Error('Invalid Analytics purchase setting.');
    if (domain.includePurchases) domain.includePurchases = true;
    if (domain.streamId || domain.scopeHosts) {
      if (!/^\d+$/.test(domain.streamId || '') || !domain.scopeHosts) throw new Error('Invalid Analytics scope.');
      domain.scope = { streamId: domain.streamId, hosts: domain.scopeHosts.split(', ') };
    }
    delete domain.attemptedAt;
    delete domain.streamId;
    delete domain.scopeHosts;
    ANALYTICS_WINDOWS.forEach(function (window, index) {
      var offset = ANALYTICS_FIELDS.length + index * (2 + ANALYTICS_METRICS.length);
      var start = row[offset] ?? '', end = row[offset + 1] ?? '';
      var metrics = {};
      ANALYTICS_METRICS.forEach(function (definition, metricIndex) {
        var value = row[offset + metricIndex + 2] ?? '';
        if (value !== '' && !Number.isFinite(value)) throw new Error('Invalid Analytics metric.');
        metrics[definition[0]] = value === '' ? null : value;
      });
      if (!start && !end && Object.values(metrics).every(function (value) { return value === null; })) return;
      if (!analyticsDate_(start) || !analyticsDate_(end) || start > end ||
          !domain.fetchedAt || !domain.timeZone) throw new Error('Invalid Analytics window.');
      if (!domain.windows) domain.windows = {};
      domain.windows[window[0]] = { startDate: start, endDate: end, metrics: metrics };
    });
    if (domain.windows && (!domain.windows.day || !domain.windows.week)) throw new Error('Missing current Analytics windows.');
    snapshot.domains.push(domain);
  });
  return snapshot;
}

function analyticsTimestamp_(value) {
  return typeof value === 'string' && Number.isFinite(Date.parse(value)) &&
    new Date(value).toISOString() === value;
}

function analyticsDate_(value) {
  return typeof value === 'string' && analyticsTimestamp_(value + 'T00:00:00.000Z');
}
