import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";
import { MAIN_ENDPOINT, readEndpoint } from "../../.github/skills/feedback-pipeline/scripts/feedback-api.mjs";
import { reportRequests, refreshSnapshot, verifiedMappings } from "./snapshot.mjs";

const revision = text => createHash("sha256").update(text).digest("base64");
const empty = { version: 1, domains: [] };

export function readWriterToken({ env = process.env, platform = process.platform, spawn = spawnSync } = {}) {
  let token = env.TOOLBOX_ANALYTICS_WRITE_TOKEN;
  if (token === undefined && platform === "darwin" && env.USER) {
    const result = spawn("/usr/bin/security", ["find-generic-password",
      "-a", env.USER, "-s", "communities-toolbox-analytics-writer", "-w"],
    { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], timeout: 10000 });
    if (!result.error && result.status === 0) token = result.stdout?.replace(/\r?\n$/, "");
  }
  if (typeof token !== "string" || !/^[\x21-\x7E]{32,}$/.test(token)) {
    throw new Error("ANALYTICS_WRITE_TOKEN_UNAVAILABLE");
  }
  return token;
}

export function createSnapshotStore({ endpoint, token, fetcher = fetch }) {
  if (endpoint !== MAIN_ENDPOINT || typeof token !== "string" || !/^[\x21-\x7E]{32,}$/.test(token)) {
    throw new Error("ANALYTICS_ENDPOINT_OR_TOKEN_UNAVAILABLE");
  }
  const call = async (action, data = {}) => {
    const signal = AbortSignal.timeout(45000);
    let response = await fetcher(endpoint, {
      method: "POST", redirect: "manual", cache: "no-store",
      headers: { "Content-Type": "text/plain;charset=utf-8" },
      body: JSON.stringify({ action, ...data, analyticsToken: token }),
      signal,
    });
    if ([302, 303].includes(response.status)) {
      const location = new URL(response.headers.get("location") ?? "/", endpoint);
      if (location.origin !== "https://script.googleusercontent.com" || location.pathname !== "/macros/echo") {
        throw new Error("ANALYTICS_REDIRECT_REJECTED");
      }
      response = await fetcher(location, { redirect: "error", cache: "no-store", signal });
    }
    if (!response.ok) throw new Error("ANALYTICS_HTTP_FAILED");
    const result = await response.json();
    if (result?.ok !== true) {
      const code = ["AUTH", "CONFLICT", "ROSTER_CHANGED", "ANALYTICS_TAB_MISSING", "ANALYTICS_CELL_FORMULA",
        "ANALYTICS_CELL_INVALID"].includes(result?.code) ? result.code : "REQUEST_REJECTED";
      throw new Error(`ANALYTICS_${code}`);
    }
    return result;
  };
  let readRevision;
  const read = async () => {
    const result = await call("readAnalyticsSnapshot");
    if (typeof result.snapshot !== "string" || result.revision !== revision(result.snapshot)) {
      throw new Error("ANALYTICS_READ_INVALID");
    }
    readRevision = result.revision;
    return result.snapshot === "" ? structuredClone(empty) : JSON.parse(result.snapshot);
  };
  return {
    read,
    async write(snapshot) {
      if (!readRevision) throw new Error("ANALYTICS_READ_REQUIRED");
      const text = JSON.stringify(snapshot);
      if (text.length > 49000) throw new Error("ANALYTICS_CELL_LIMIT");
      const expectedRevision = readRevision;
      try {
        const receipt = await call("replaceAnalyticsSnapshot", { expectedRevision, snapshot: text });
        if (receipt.revision !== revision(text)) throw new Error("ANALYTICS_WRITE_RECEIPT_INVALID");
      } catch (error) {
        if (error.message === "ANALYTICS_CONFLICT" || error.message === "ANALYTICS_ROSTER_CHANGED") throw error;
        // A lost response does not imply the write failed. Verify instead of retrying.
      }
      await read();
      if (readRevision !== revision(text)) throw new Error("ANALYTICS_WRITE_NOT_VERIFIED");
    },
  };
}

function toolArgs(property, request) {
  const args = {
    property_id: property.propertyId, currency_code: request.currencyCode,
    date_ranges: request.dateRanges.map(({ name, startDate, endDate }) => ({ name, start_date: startDate, end_date: endDate })),
    dimensions: [], metrics: request.metrics.map(({ name }) => name),
  };
  if (property.scope) {
    args.dimension_filter = { and_group: { expressions: [
      { filter: { field_name: "streamId", string_filter: { match_type: 1, value: property.scope.streamId } } },
      { filter: { field_name: "hostName", in_list_filter: { values: property.scope.hosts, case_sensitive: true } } },
    ] } };
  }
  return args;
}

export function createReportPlan(now, mappings = verifiedMappings) {
  return { runAt: now.toISOString(), requests: [...mappings].flatMap(([id, property]) =>
    reportRequests(property, now).map((request, index) => ({
      id: `${id}:${index}`, args: toolArgs(property, request),
    }))) };
}

function normalizeReport(report) {
  const metadata = report.metadata ?? {};
  return {
    metadata: {
      timeZone: metadata.time_zone, currencyCode: metadata.currency_code,
      subjectToThresholding: metadata.subject_to_thresholding, dataLossFromOtherRow: metadata.data_loss_from_other_row,
      samplingMetadatas: metadata.sampling_metadatas, dataTruncationReasons: metadata.data_truncation_reasons,
      schemaRestrictionResponse: { activeMetricRestrictions: metadata.schema_restriction_response?.active_metric_restrictions },
    },
    dimensionHeaders: report.dimension_headers, metricHeaders: report.metric_headers,
    rows: report.rows?.map(row => ({ dimensionValues: row.dimension_values, metricValues: row.metric_values })),
  };
}

export async function applyReports({ runAt, reports }, { store, roster, clock = () => new Date(), mappings = verifiedMappings }) {
  const now = new Date(runAt);
  const age = clock().getTime() - now.getTime();
  if (!Number.isFinite(age) || age < 0 || age > 3600_000 ||
      !reports || typeof reports !== "object" || Array.isArray(reports)) throw new Error("ANALYTICS_RUN_INPUT_INVALID");
  const plan = createReportPlan(now, mappings);
  const currentPlan = createReportPlan(clock(), mappings);
  const requestIds = new Set(plan.requests.map(request => request.id));
  if (JSON.stringify(plan.requests) !== JSON.stringify(currentPlan.requests) ||
      Object.keys(reports).some(id => !requestIds.has(id))) throw new Error("ANALYTICS_RUN_INPUT_INVALID");
  const snapshot = await refreshSnapshot({
    now, mappings, roster,
    gaReport(property, payload) {
      const id = `${property.id}:${payload.dateRanges[0].name === "day" ? 0 : 1}`;
      const report = reports[id];
      if (!report) throw new Error("ANALYTICS_REPORT_UNAVAILABLE");
      return normalizeReport(report);
    },
    store: {
      read: store.read,
      write(next) {
        if (!next.domains.some(row => row.fetchedAt === runAt && ["Reported", "Partial"].includes(row.status))) {
          throw new Error("ANALYTICS_NO_CURRENT_REPORTS");
        }
        return store.write(next);
      },
    },
  });
  return {
    domains: snapshot.domains.length,
    incomplete: snapshot.domains.filter(row => row.propertyId &&
      (row.fetchedAt !== runAt || Object.keys(row.windows ?? {}).length < 6)).length,
  };
}

async function main() {
  const command = process.argv[2];
  if (command === "plan") {
    console.log(JSON.stringify(createReportPlan(new Date())));
    return;
  }
  if (!["check", "apply"].includes(command)) throw new Error("Usage: node scripts/analytics/refresh.mjs plan|check|apply");
  const endpoint = readEndpoint();
  const store = createSnapshotStore({ endpoint, token: readWriterToken() });
  if (command === "check") {
    const snapshot = await store.read();
    if (snapshot?.version !== 1 || !Array.isArray(snapshot.domains)) throw new Error("ANALYTICS_READ_INVALID");
    console.log("Protected Analytics snapshot read verified.");
    return;
  }
  const result = await applyReports(JSON.parse(readFileSync(0, "utf8")), {
    store,
    async roster() {
      const response = await fetch(endpoint, { cache: "no-store", signal: AbortSignal.timeout(45000) });
      if (!response.ok) throw new Error("ANALYTICS_ROSTER_UNAVAILABLE");
      const { domains } = await response.json();
      if (!Array.isArray(domains) || !domains.length || domains.some(row => !row?.id || !row?.name) ||
          new Set(domains.map(row => row.id)).size !== domains.length) throw new Error("ANALYTICS_ROSTER_INVALID");
      return domains.map(({ id, name }) => ({ id, name }));
    },
  });
  console.log(`Analytics snapshot verified: ${result.domains} domains, ${result.incomplete} mapped domains incomplete.`);
  if (result.incomplete) process.exitCode = 1;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try { await main(); }
  catch (error) {
    console.error(/^(?:ANALYTICS|FEEDBACK)_[A-Z_]+$/.test(error.message) ? error.message : "ANALYTICS_REFRESH_FAILED");
    process.exitCode = 1;
  }
}
