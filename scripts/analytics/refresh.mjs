import { googleAnalyticsAdapters, refreshSnapshot } from "./snapshot.mjs";

const { TOOLBOX_ANALYTICS_SHEET_ID, TOOLBOX_ANALYTICS_DOMAINS_SHEET_ID,
  TOOLBOX_ANALYTICS_GOOGLE_ACCESS_TOKEN, TOOLBOX_ANALYTICS_ALLOW_SHARED_WORKBOOK } = process.env;
if (!TOOLBOX_ANALYTICS_SHEET_ID || !TOOLBOX_ANALYTICS_DOMAINS_SHEET_ID || !TOOLBOX_ANALYTICS_GOOGLE_ACCESS_TOKEN) {
  throw new Error("Private snapshot spreadsheet ID, existing Toolbox spreadsheet ID, and a short-lived Google access token are required");
}

const snapshot = await refreshSnapshot(googleAnalyticsAdapters({
  spreadsheetId: TOOLBOX_ANALYTICS_SHEET_ID,
  domainsSpreadsheetId: TOOLBOX_ANALYTICS_DOMAINS_SHEET_ID,
  allowSharedWorkbook: TOOLBOX_ANALYTICS_ALLOW_SHARED_WORKBOOK === "true",
  getAccessToken: () => TOOLBOX_ANALYTICS_GOOGLE_ACCESS_TOKEN,
}));

const unmapped = snapshot.domains.filter(row => !row.propertyId).length;
const failures = snapshot.domains.filter(row => row.propertyId &&
  (["Stale", "Unavailable"].includes(row.status) || Object.keys(row.windows ?? {}).length < 6)).length;
console.info(`Analytics refresh recorded ${snapshot.domains.length} domains (${unmapped} unmapped, ${failures} incomplete).`);
if (failures) process.exitCode = 1;
