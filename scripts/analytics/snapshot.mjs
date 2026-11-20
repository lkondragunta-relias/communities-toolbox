import { metrics, reportingDate, reportingWindows, withCurrentAnalyticsStatus } from "../../src/utils/analytics.js";

const keys = metrics.map(([key]) => key);
const trafficKeys = ["sessions", "totalUsers", "newUsers"];
export const academy = {
  propertyId: "284885806", host: "reliasacademy.com",
  timeZone: "America/New_York", currency: "USD",
  url: "https://analytics.google.com/analytics/web/#/a7033805p284885806/reports/intelligenthome",
};
const traffic = (propertyId, streamId, ...hosts) => ({
  propertyId, scope: { streamId, hosts }, host: hosts.join(", "),
  timeZone: "America/New_York", currency: "USD",
});
export const verifiedMappings = new Map([
  ["relias-academy", academy],
  ["nurse-enablement", traffic("359852607", "12850525022", "recruit.nurse.com")],
  ["clinician", {
    ...traffic("286492365", "2795304286", "www.clinician.com"),
    url: "https://analytics.google.com/analytics/web/#/a43448685p286492365/reports/intelligenthome",
    includePurchases: true,
  }],
  ["freecme", traffic("286503363", "2796722651", "www.freecme.com", "info.freecme.com")],
  ["wound-care", traffic("286565352", "2797075565", "www.wcei.net")],
  ["woundcare-blog", traffic("286565352", "2797075565", "blog.wcei.net")],
  ["relias-com", traffic("286559990", "2797078670", "www.relias.com")],
]);

export function parseDomains(values) {
  const [header = [], ...rows] = values ?? [];
  const columns = header.map(value => String(value).trim().toLowerCase());
  const column = aliases => aliases.map(alias => columns.indexOf(alias)).find(index => index >= 0);
  const idColumn = column(["title", "id"]);
  const nameColumn = column(["name", "label"]);
  if (idColumn === undefined) throw new Error("Toolbox Domains tab is missing its Title or ID column");
  const domains = new Map();
  for (const row of rows) {
    const rawId = String(row[idColumn] ?? "").trim();
    if (!rawId) continue;
    const id = rawId.toLowerCase();
    if (domains.has(id)) throw new Error("Toolbox Domains tab contains duplicate domain IDs");
    domains.set(id, { id, name: String(row[nameColumn] ?? "").trim() || rawId });
  }
  if (!domains.size) throw new Error("Toolbox Domains tab contains no domain IDs");
  return [...domains.values()];
}
function assertSnapshot(state) {
  if (state?.version !== 1 || !Array.isArray(state.domains)) throw new Error("Invalid analytics snapshot");
  return state;
}

function decodeReport(report, ranges, property, reportKeys) {
  const { metadata = {}, dimensionHeaders = [], metricHeaders = [], rows = [] } = report;
  if (metadata.timeZone !== property.timeZone || metadata.currencyCode !== property.currency ||
      metadata.subjectToThresholding || metadata.dataLossFromOtherRow || metadata.samplingMetadatas?.length ||
      metadata.schemaRestrictionResponse?.activeMetricRestrictions?.length || metadata.dataTruncationReasons?.length ||
      dimensionHeaders[0]?.name !== "dateRange" || reportKeys.some((key, index) => metricHeaders[index]?.name !== key)) {
    throw new Error("GA4 report did not match the requested scope or quality requirements");
  }
  const result = {};
  for (const row of rows) {
    const name = row.dimensionValues?.[0]?.value;
    if (!Object.hasOwn(ranges, name) || Object.hasOwn(result, name)) throw new Error("Unexpected GA4 date range");
    const values = reportKeys.map((key, index) => {
      const value = row.metricValues?.[index]?.value;
      const number = Number(value);
      if (typeof value !== "string" || value.trim() === "" || !Number.isFinite(number) ||
          (["sessions", "totalUsers", "newUsers", "ecommercePurchases"].includes(key) && (!Number.isSafeInteger(number) || number < 0)) ||
          (key === "sessionKeyEventRate" && (number < 0 || number > 1))) {
        throw new Error("Invalid GA4 metric");
      }
      return number;
    });
    const valuesByKey = Object.fromEntries(reportKeys.map((key, index) => [key, values[index]]));
    result[name] = { ...ranges[name], metrics: Object.fromEntries(keys.map(key => [
      key, key === "averagePurchaseRevenue" && !(valuesByKey.ecommercePurchases > 0) ? null : valuesByKey[key] ?? null,
    ])) };
  }
  return result;
}

export function reportRequests(property, now) {
  const ranges = Object.entries(reportingWindows(reportingDate(now, property.timeZone)));
  const reportKeys = property.scope
    ? property.includePurchases ? [...trafficKeys, "purchaseRevenue", "ecommercePurchases"] : trafficKeys
    : keys;
  const dimensionFilter = property.scope && {
    andGroup: { expressions: [
      { filter: { fieldName: "streamId", stringFilter: { matchType: "EXACT", value: property.scope.streamId } } },
      { filter: { fieldName: "hostName", inListFilter: { values: property.scope.hosts, caseSensitive: true } } },
    ] },
  };
  return [ranges.slice(0, 4), ranges.slice(4)].map(entries => ({
    currencyCode: property.currency,
    dateRanges: entries.map(([name, range]) => ({ name, ...range })),
    metrics: reportKeys.map(name => ({ name })),
    ...(dimensionFilter ? { dimensionFilter } : {}),
  }));
}

export async function refreshSnapshot({ roster, mappings = verifiedMappings, gaReport, store, now = new Date(), warn = console.warn }) {
  const toolboxDomains = await roster();
  for (const id of mappings.keys()) {
    if (!toolboxDomains.some(domain => domain.id === id)) throw new Error("A GA4 mapping references an unknown Toolbox domain ID");
  }
  const previous = assertSnapshot(await store.read());
  const domains = [];
  for (const domain of toolboxDomains) {
    const mapping = mappings.get(domain.id);
    if (!mapping) {
      domains.push({ ...domain, status: "Unavailable", reason: "No verified GA4 mapping" });
      continue;
    }
    const property = { ...mapping, ...domain };
    const old = previous.domains.find(row => row.id === domain.id && row.propertyId === property.propertyId &&
      row.timeZone === property.timeZone && row.currency === property.currency &&
      JSON.stringify(row.scope) === JSON.stringify(property.scope));
    const ranges = Object.entries(reportingWindows(reportingDate(now, property.timeZone)));
    const request = async payload => {
      const report = await gaReport(property, payload);
      return decodeReport(report, Object.fromEntries(payload.dateRanges.map(({ name, ...range }) => [name, range])),
        property, payload.metrics.map(({ name }) => name));
    };
    const [current, yearly] = reportRequests(property, now);
    try {
      const windows = await request(current);
      if (!windows.day || !windows.week) throw new Error("Current GA4 windows are unavailable");
      try {
        Object.assign(windows, await request(yearly));
      } catch {
        warn(`Analytics year-over-year comparison unavailable for ${property.id}`);
      }
      const sameDates = old?.windows?.day?.endDate === windows.day.endDate;
      if (sameDates) {
        for (const [name, range] of ranges) {
          const cached = old.windows[name];
          if (!windows[name] && cached?.startDate === range.startDate && cached.endDate === range.endDate) windows[name] = cached;
        }
      }
      domains.push({
        ...property, windows, status: !property.scope && Object.keys(windows).length === 6 ? "Reported" : "Partial",
        ...(property.scope ? { reason: property.includePurchases
          ? "Traffic and purchases verified; conversion and average order value not reported"
          : "Traffic only; commerce and conversion scope not verified" } : {}),
        fetchedAt: now.toISOString(),
      });
    } catch {
      warn(`Current analytics refresh unavailable for ${property.id}`);
      domains.push(old?.windows?.day && old?.windows?.week ? {
        ...property,
        windows: Object.fromEntries(ranges.filter(([name]) => Object.hasOwn(old.windows, name))
          .map(([name]) => [name, old.windows[name]])),
        status: "Stale", fetchedAt: old.fetchedAt, reason: old.reason,
      } : { ...property, status: "Unavailable" });
    }
  }
  const snapshot = { version: 1, attemptedAt: now.toISOString(), domains };
  await store.write(snapshot);
  return snapshot;
}

export function analyticsReader({ authorize, store, clock = () => new Date() }) {
  if (typeof authorize !== "function") throw new Error("Analytics requires a server authorization check");
  const headers = { "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff" };
  return async request => {
    if (request.method !== "GET") return new Response(null, { status: 405, headers: { ...headers, Allow: "GET" } });
    try {
      if (await authorize(request) !== true) return new Response(null, { status: 403, headers });
      const { version, domains } = withCurrentAnalyticsStatus(assertSnapshot(await store.read()), clock());
      const rows = domains.map(({ id, name, host, url, currency, timeZone, fetchedAt, status, reason, windows }) =>
        ({ id, name, host, url, currency, timeZone, fetchedAt, status, reason, windows }));
      return Response.json({ version, domains: rows }, { headers });
    } catch {
      return new Response(null, { status: 503, headers });
    }
  };
}
