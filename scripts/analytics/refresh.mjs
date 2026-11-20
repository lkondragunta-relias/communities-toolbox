import { googleAnalyticsAdapters, refreshSnapshot } from "./snapshot.mjs";

const { TOOLBOX_ANALYTICS_SHEET_ID, TOOLBOX_ANALYTICS_GOOGLE_ACCESS_TOKEN } = process.env;
if (!TOOLBOX_ANALYTICS_SHEET_ID || !TOOLBOX_ANALYTICS_GOOGLE_ACCESS_TOKEN) {
  throw new Error("Private Sheet ID and a short-lived Google access token are required");
}

const snapshot = await refreshSnapshot(googleAnalyticsAdapters({
  spreadsheetId: TOOLBOX_ANALYTICS_SHEET_ID,
  getAccessToken: () => TOOLBOX_ANALYTICS_GOOGLE_ACCESS_TOKEN,
}));

const failures = snapshot.domains.filter(row => row.status !== "Reported").length;
console.info(`Analytics refresh recorded ${snapshot.domains.length} domains (${failures} incomplete).`);
if (failures) process.exitCode = 1;
