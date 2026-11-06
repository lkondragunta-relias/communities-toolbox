import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

export const MAIN_ENDPOINT = "https://script.google.com/macros/s/AKfycbxersT92Dz8OVW2D8hyl2MhDUS0QB-xZE0kfqfPsqHFvo3dXzmbwzOyciuQm7exhEFQug/exec";
export const STATUSES = ["New", "Issue created", "In progress", "In review", "Done", "Declined", "Needs info", "Needs approval"];
const ID = /^FB-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function fail(code) {
  throw new Error(code);
}

export function readCredential({ env = process.env, platform = process.platform, spawn = spawnSync } = {}) {
  let token = env.OPS_SHEETS_ADMIN_TOKEN;
  if (token === undefined) {
    if (platform !== "darwin" || !env.USER) fail("KEYCHAIN_CREDENTIAL_UNAVAILABLE");
    const result = spawn("/usr/bin/security", [
      "find-generic-password", "-a", env.USER, "-s", "communities-operations-sync", "-w",
    ], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], timeout: 10000 });
    if (result.error || result.status !== 0) fail("KEYCHAIN_CREDENTIAL_UNAVAILABLE");
    // security adds one output newline; embedded newlines remain invalid.
    token = result.stdout?.replace(/\r?\n$/, "");
  }
  if (typeof token !== "string" || !token.trim() || /[\r\n]/.test(token)) fail("KEYCHAIN_CREDENTIAL_UNAVAILABLE");
  return token;
}

export function readEndpoint({ env = process.env, read = readFileSync, home = homedir() } = {}) {
  let endpoint = env.FEEDBACK_API_URL;
  if (endpoint === undefined) {
    let config;
    try {
      config = JSON.parse(read(join(home, ".local/state/communities-operations-sync/main-daily/runtime.json"), "utf8"));
    } catch {
      fail("FEEDBACK_ENDPOINT_UNAVAILABLE");
    }
    if (config?.version !== 1) fail("FEEDBACK_ENDPOINT_UNAVAILABLE");
    endpoint = config.endpoint;
  }
  if (endpoint !== MAIN_ENDPOINT) fail("FEEDBACK_ENDPOINT_MISMATCH");
  return endpoint;
}

export function validateUpdate(input) {
  if (!input || typeof input !== "object" || Array.isArray(input) ||
      Object.keys(input).some((key) => !["id", "status", "issueUrl", "prUrl", "expectedUpdatedAt"].includes(key)) ||
      typeof input.id !== "string" || !ID.test(input.id)) fail("INVALID_FEEDBACK_UPDATE");
  if (!["status", "issueUrl", "prUrl"].some((key) => input[key] !== undefined)) fail("INVALID_FEEDBACK_UPDATE");
  if (input.status !== undefined && !STATUSES.includes(input.status)) fail("INVALID_FEEDBACK_UPDATE");
  for (const [field, path] of [["issueUrl", "issues"], ["prUrl", "pull"]]) {
    if (input[field] === undefined) continue;
    const pattern = new RegExp(`^https://github\\.com/lkondragunta-relias/communities-toolbox/${path}/[1-9]\\d*$`);
    if (typeof input[field] !== "string" || input[field].length > 200 ||
        (input[field] !== "" && !pattern.test(input[field]))) fail("INVALID_FEEDBACK_UPDATE");
  }
  if (input.expectedUpdatedAt !== undefined && (typeof input.expectedUpdatedAt !== "string" ||
      input.expectedUpdatedAt.length > 40)) fail("INVALID_FEEDBACK_UPDATE");
  return input;
}

function validateRow(row) {
  if (!row || typeof row.id !== "string" || !ID.test(row.id) ||
      !STATUSES.includes(row.status) || typeof row.updatedAt !== "string" ||
      !Number.isFinite(Date.parse(row.updatedAt)) ||
      !["name", "message", "category", "page", "pageUrl", "submittedAt", "issueUrl", "prUrl"].every((key) => typeof row[key] === "string")) {
    fail("FEEDBACK_RESPONSE_INVALID");
  }
  return row;
}

export async function callApi(payload, { endpoint, token, fetcher = fetch }) {
  let response;
  try {
    response = await fetcher(endpoint, {
      method: "POST", headers: { "Content-Type": "text/plain;charset=utf-8" },
      body: JSON.stringify({ ...payload, adminToken: token }),
      signal: AbortSignal.timeout(45000),
    });
  } catch {
    fail("FEEDBACK_TRANSPORT_FAILED");
  }
  if (!response.ok) fail("FEEDBACK_HTTP_FAILED");
  let result;
  try { result = await response.json(); }
  catch { fail("FEEDBACK_RESPONSE_INVALID"); }
  // Do not echo backend errors: they can include user content or credentials.
  if (result?.ok !== true || result.error) fail("FEEDBACK_REQUEST_REJECTED");
  return result;
}

export async function listFeedback(status, config) {
  if (status !== undefined && !STATUSES.includes(status)) fail("INVALID_FEEDBACK_STATUS");
  const result = await callApi({ action: "listFeedback", ...(status === undefined ? {} : { status }) }, config);
  if (!Array.isArray(result.feedback)) fail("FEEDBACK_RESPONSE_INVALID");
  const ids = new Set();
  for (const row of result.feedback) {
    validateRow(row);
    if (ids.has(row.id.toLowerCase()) || (status !== undefined && row.status !== status)) fail("FEEDBACK_RESPONSE_INVALID");
    ids.add(row.id.toLowerCase());
  }
  return { ok: true, feedback: result.feedback };
}

export async function updateFeedback(input, config) {
  validateUpdate(input);
  const result = await callApi({ action: "updateFeedback", ...input }, config);
  const saved = validateRow(result.feedback);
  if (saved.id.toLowerCase() !== input.id.toLowerCase() ||
      ["status", "issueUrl", "prUrl"].some((key) => input[key] !== undefined && saved[key] !== input[key])) {
    fail("FEEDBACK_UPDATE_UNCONFIRMED");
  }
  const readback = (await listFeedback(undefined, config)).feedback.find((row) => row.id.toLowerCase() === saved.id.toLowerCase());
  if (!readback || ["status", "issueUrl", "prUrl", "updatedAt"].some((key) => readback[key] !== saved[key])) {
    fail("FEEDBACK_UPDATE_UNCONFIRMED");
  }
  return { ok: true, feedback: readback };
}

export async function run(args, { env = process.env, readInput = () => readFileSync(0, "utf8"), ...dependencies } = {}) {
  if (!["list", "update"].includes(args[0]) || (args[0] === "list" ? args.length > 2 : args.length !== 1)) {
    fail("USAGE_LIST_OR_UPDATE");
  }
  let input;
  if (args[0] === "list" && args[1] !== undefined && !STATUSES.includes(args[1])) fail("INVALID_FEEDBACK_STATUS");
  if (args[0] === "update") {
    const text = readInput();
    if (text.length > 4096) fail("INVALID_FEEDBACK_UPDATE");
    try { input = JSON.parse(text); }
    catch { fail("INVALID_FEEDBACK_UPDATE"); }
    validateUpdate(input);
  }
  const config = {
    endpoint: readEndpoint({ env, ...dependencies }),
    token: readCredential({ env, ...dependencies }),
    fetcher: dependencies.fetcher,
  };
  return args[0] === "list" ? listFeedback(args[1], config) : updateFeedback(input, config);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  run(process.argv.slice(2)).then((result) => {
    process.stdout.write(`${JSON.stringify(result)}\n`);
  }).catch((err) => {
    const code = /^[A-Z_]+$/.test(err.message) ? err.message : "FEEDBACK_HELPER_FAILED";
    process.stderr.write(`${JSON.stringify({ ok: false, code })}\n`);
    process.exitCode = 1;
  });
}
