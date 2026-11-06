import assert from "node:assert/strict";
import { test } from "node:test";
import { randomUUID } from "node:crypto";
import {
  MAIN_ENDPOINT, STATUSES, readCredential, readEndpoint, validateUpdate,
  listFeedback, updateFeedback, run,
} from "../.github/skills/feedback-pipeline/scripts/feedback-api.mjs";

const row = (changes = {}) => ({
  id: `FB-${randomUUID()}`, submittedAt: "2026-11-06T12:00:00.000Z",
  updatedAt: "2026-11-06T12:00:00.000Z", name: "Test", category: "Request a change",
  page: "overview", pageUrl: "https://lkondragunta-relias.github.io/communities-toolbox/#/overview",
  message: "Synthetic unit test", status: "New", issueUrl: "", prUrl: "", ...changes,
});
const ok = (json) => ({ ok: true, json: async () => json });
const config = (fetcher) => ({ endpoint: MAIN_ENDPOINT, token: "unit-test-token", fetcher });

test("credentials use protected env or captured macOS Keychain output without logging or shell expansion", () => {
  assert.equal(readCredential({ env: { OPS_SHEETS_ADMIN_TOKEN: "test" }, platform: "linux" }), "test");
  assert.equal(readCredential({ env: { OPS_SHEETS_ADMIN_TOKEN: " test " }, platform: "linux" }), " test ");
  let captured;
  assert.equal(readCredential({
    env: { USER: "test-account" }, platform: "darwin",
    spawn: (file, args, options) => {
      captured = { file, args, options };
      return { status: 0, stdout: "keychain-unit-test\n" };
    },
  }), "keychain-unit-test");
  assert.equal(captured.file, "/usr/bin/security");
  assert.deepEqual(captured.args, ["find-generic-password", "-a", "test-account", "-s", "communities-operations-sync", "-w"]);
  assert.deepEqual(captured.options.stdio, ["ignore", "pipe", "pipe"]);
  for (const token of ["", " ", "bad\nvalue", "bad\rvalue"]) {
    assert.throws(() => readCredential({ env: { OPS_SHEETS_ADMIN_TOKEN: token } }), /KEYCHAIN_CREDENTIAL_UNAVAILABLE/);
  }
  assert.throws(() => readCredential({ env: {}, platform: "linux" }), /KEYCHAIN_CREDENTIAL_UNAVAILABLE/);
  assert.throws(() => readCredential({ env: { USER: "test" }, platform: "darwin", spawn: () => ({ status: 1, stderr: "secret" }) }), /KEYCHAIN_CREDENTIAL_UNAVAILABLE/);
});

test("endpoint is pinned to main with protected runtime configuration or override", () => {
  assert.equal(readEndpoint({ env: { FEEDBACK_API_URL: MAIN_ENDPOINT } }), MAIN_ENDPOINT);
  assert.equal(readEndpoint({
    env: {}, home: "/test-home",
    read: (file) => {
      assert.equal(file, "/test-home/.local/state/communities-operations-sync/main-daily/runtime.json");
      return JSON.stringify({ version: 1, endpoint: MAIN_ENDPOINT });
    },
  }), MAIN_ENDPOINT);
  for (const endpoint of ["", "http://evil.test", `${MAIN_ENDPOINT}?token=secret`, "https://script.google.com/macros/s/other/exec"]) {
    assert.throws(() => readEndpoint({ env: { FEEDBACK_API_URL: endpoint } }), /FEEDBACK_ENDPOINT_MISMATCH/);
  }
  assert.throws(() => readEndpoint({ env: {}, read: () => '{"version":2}' }), /FEEDBACK_ENDPOINT_UNAVAILABLE/);
  assert.throws(() => readEndpoint({ env: {}, read: () => { throw new Error("missing"); } }), /FEEDBACK_ENDPOINT_UNAVAILABLE/);
});

test("list validates rows, status filters and unique IDs; sends auth only in the POST body", async () => {
  const entry = row();
  const result = await listFeedback("New", config(async (url, options) => {
    assert.equal(url, MAIN_ENDPOINT);
    assert.equal(options.method, "POST");
    assert.equal(options.headers["Content-Type"], "text/plain;charset=utf-8");
    assert.deepEqual(JSON.parse(options.body), { action: "listFeedback", status: "New", adminToken: "unit-test-token" });
    return ok({ ok: true, feedback: [entry] });
  }));
  assert.deepEqual(result.feedback, [entry]);
  await assert.rejects(listFeedback("Invalid", config(() => assert.fail())), /INVALID_FEEDBACK_STATUS/);
  for (const feedback of [undefined, [entry, entry], [row({ status: "wrong" })], [row({ updatedAt: "" })]]) {
    await assert.rejects(listFeedback(undefined, config(async () => ok({ ok: true, feedback }))), /FEEDBACK_RESPONSE_INVALID/);
  }
});

test("update validates tracking-only fields and confirms saved result through fresh list readback", async () => {
  const original = row();
  const saved = { ...original, status: "In review", updatedAt: "2026-11-06T12:01:00.000Z",
    prUrl: "https://github.com/lkondragunta-relias/communities-toolbox/pull/43" };
  const payload = { id: original.id, status: saved.status, prUrl: saved.prUrl, expectedUpdatedAt: original.updatedAt };
  const actions = [];
  const result = await updateFeedback(payload, config(async (_, options) => {
    const body = JSON.parse(options.body);
    actions.push(body.action);
    return ok(body.action === "updateFeedback" ? { ok: true, feedback: saved } : { ok: true, feedback: [saved] });
  }));
  assert.deepEqual(actions, ["updateFeedback", "listFeedback"]);
  assert.deepEqual(result.feedback, saved);
  await assert.rejects(updateFeedback(payload, config(async (_, options) =>
    ok(JSON.parse(options.body).action === "updateFeedback" ? { ok: true, feedback: saved } : { ok: true, feedback: [original] }))), /FEEDBACK_UPDATE_UNCONFIRMED/);
  for (const bad of [
    { ...payload, name: "=change" }, { id: "wrong", status: "Done" },
    { ...payload, prUrl: "https://evil.test/pull/1" }, { ...payload, issueUrl: "=HYPERLINK()" },
    { ...payload, status: "Resolved" }, { id: original.id }, { ...payload, adminToken: "leak" },
  ]) assert.throws(() => validateUpdate(bad), /INVALID_FEEDBACK_UPDATE/);
  for (const status of STATUSES) assert.doesNotThrow(() => validateUpdate({ id: original.id, status }));
});

test("HTTP200 errors, invalid JSON, transport failure and wrong receipts never leak tokens or count as success", async () => {
  for (const [fetcher, code] of [
    [async () => ok({ ok: false, error: "echo unit-test-token" }), "FEEDBACK_REQUEST_REJECTED"],
    [async () => ({ ok: false }), "FEEDBACK_HTTP_FAILED"],
    [async () => ({ ok: true, json: async () => { throw new Error("unit-test-token"); } }), "FEEDBACK_RESPONSE_INVALID"],
    [async () => { throw new Error("unit-test-token"); }, "FEEDBACK_TRANSPORT_FAILED"],
    [async () => ok({}), "FEEDBACK_REQUEST_REJECTED"],
  ]) {
    await assert.rejects(listFeedback(undefined, config(fetcher)), (error) => {
      assert.equal(error.message, code);
      assert.equal(error.message.includes("unit-test-token"), false);
      return true;
    });
  }
  const entry = row();
  await assert.rejects(updateFeedback({ id: entry.id, status: "Done" },
    config(async () => ok({ ok: true, feedback: entry }))), /FEEDBACK_UPDATE_UNCONFIRMED/);
});

test("CLI rejects invalid commands/input before retrieving credentials", async () => {
  for (const args of [[], ["other"], ["update", "secret"], ["list", "Done", "extra"]]) {
    await assert.rejects(run(args, { env: {} }), /USAGE_LIST_OR_UPDATE/);
  }
  await assert.rejects(run(["update"], { env: {}, readInput: () => "not json" }), /INVALID_FEEDBACK_UPDATE/);
  await assert.rejects(run(["update"], { env: {}, readInput: () => "x".repeat(4097) }), /INVALID_FEEDBACK_UPDATE/);
  const result = await run(["list"], {
    env: { OPS_SHEETS_ADMIN_TOKEN: "test", FEEDBACK_API_URL: MAIN_ENDPOINT },
    fetcher: async () => ok({ ok: true, feedback: [] }),
  });
  assert.deepEqual(result, { ok: true, feedback: [] });
});
