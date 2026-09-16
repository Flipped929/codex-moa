import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { applyFailureAvoidance, readFailureMemory, recordSeatFailure, recordSeatRecovery, summarizeFailureMemory } from "../src/lib/failure-memory.mjs";

const models = {
  models: {
    "kimi-2.8": { id: "kimi-2.8", harness: "pi", supportedHarnesses: ["pi"], providerModel: "kimi", tier: "fast", family: "moonshot", capabilities: ["text"] },
    "GLM-5.3-flash": { id: "GLM-5.3-flash", harness: "pi", supportedHarnesses: ["pi"], providerModel: "glm", tier: "fast", family: "zhipu", capabilities: ["text"] },
    "DeepSeek-flash": { id: "DeepSeek-flash", harness: "dsh", supportedHarnesses: ["dsh", "pi"], providerModel: "deepseek", tier: "fast", family: "deepseek", capabilities: ["text"] }
  },
  aliases: {}, tiers: {}, seats: {}
};

test("records a redacted deterministic failure and activates a route guard", async () => {
  const root = await mkdtemp(join(tmpdir(), "codex-moa-failures-"));
  const path = join(root, "failures.jsonl");
  await recordSeatFailure({
    taskId: "task-auth",
    level: "L1",
    seat: { seat: "executor", role: "executor", model: "GLM-5.3-flash", harness: "pi" },
    result: { status: "failed", error: "Unauthorized api_key=top-secret-value" }
  }, path);
  const entries = await readFailureMemory(path);
  assert.equal(entries.length, 1);
  assert.equal(entries[0].kind, "auth");
  assert.doesNotMatch(entries[0].message, /top-secret-value/);
  const summary = summarizeFailureMemory(entries);
  assert.equal(summary.routes["GLM-5.3-flash@pi"].activeGuard.kind, "auth");
});

test("repeated transient failures guard the route and automatic routing changes family", () => {
  const now = Date.now();
  const entries = [1, 2].map((index) => ({
    time: new Date(now - index * 1000).toISOString(),
    model: "GLM-5.3-flash",
    harness: "pi",
    kind: "timeout",
    signature: "same-timeout"
  }));
  const summary = summarizeFailureMemory(entries, { now });
  const seats = [{ seat: "executor", role: "executor", model: "GLM-5.3-flash", harness: "pi", modelTier: "fast", family: "zhipu" }];
  const routed = applyFailureAvoidance(seats, { summary, modelsConfig: models });
  assert.equal(routed.blocked.length, 0);
  assert.equal(routed.adjustments[0].action, "rerouted_failure_guard");
  assert.equal(seats[0].model, "kimi-2.8");
  assert.equal(seats[0].harness, "pi");
});

test("model-first failure routing changes Harness before changing model", () => {
  const now = Date.now();
  const summary = summarizeFailureMemory([1, 2].map((index) => ({
    time: new Date(now - index * 1000).toISOString(),
    model: "DeepSeek-flash",
    harness: "dsh",
    kind: "timeout",
    signature: "same-timeout"
  })), { now });
  const seats = [{ seat: "auditor", role: "auditor", auditMode: "gate", model: "DeepSeek-flash", harness: "dsh", modelTier: "fast", family: "deepseek" }];
  const routed = applyFailureAvoidance(seats, { summary, modelsConfig: models });
  assert.equal(routed.blocked.length, 0);
  assert.equal(routed.adjustments[0].action, "changed_harness_same_model");
  assert.equal(seats[0].model, "DeepSeek-flash");
  assert.equal(seats[0].harness, "pi");
});

test("one transient failure is recorded but does not prematurely guard the route", () => {
  const now = Date.now();
  const summary = summarizeFailureMemory([{ time: new Date(now - 1000).toISOString(), model: "kimi-2.8", harness: "pi", kind: "timeout", signature: "once" }], { now });
  assert.equal(summary.routes["kimi-2.8@pi"].activeGuard, null);
});

test("a later successful probe clears an active route guard without deleting failure history", async () => {
  const root = await mkdtemp(join(tmpdir(), "codex-moa-recovery-"));
  const path = join(root, "failures.jsonl");
  const seat = { seat: "executor", role: "executor", model: "GLM-5.3-flash", harness: "pi" };
  await recordSeatFailure({ taskId: "failed", level: "L1", seat, result: { status: "failed", error: "Unauthorized" } }, path);
  await recordSeatRecovery({ taskId: "probe", level: "L1", seat, result: { status: "done", durationMs: 10 } }, path);
  const summary = summarizeFailureMemory(await readFailureMemory(path));
  assert.equal(summary.routes["GLM-5.3-flash@pi"].failures, 1);
  assert.equal(summary.routes["GLM-5.3-flash@pi"].recoveries, 1);
  assert.equal(summary.routes["GLM-5.3-flash@pi"].activeGuard, null);
});
