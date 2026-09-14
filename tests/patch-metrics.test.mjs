import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { readPatchMetrics, recordPatchEvent, summarizePatchMetrics } from "../src/lib/patch-metrics.mjs";

test("records and summarizes patch acceptance metrics", async () => {
  const root = await mkdtemp(join(tmpdir(), "codex-moa-patch-metrics-"));
  const path = join(root, "patch.jsonl");
  await recordPatchEvent({ action: "check", ok: true, taskId: "t", seat: "executor", model: "GLM-5.3" }, path);
  await recordPatchEvent({ action: "apply", ok: true, taskId: "t", seat: "executor", model: "GLM-5.3" }, path);
  await recordPatchEvent({ action: "apply", ok: false, error: "patch does not apply", taskId: "t", seat: "executor", model: "GLM-5.3" }, path);
  await recordPatchEvent({ action: "revert", ok: true, taskId: "t", seat: "executor", model: "GLM-5.3" }, path);
  const entries = await readPatchMetrics(path);
  const summary = summarizePatchMetrics(entries);
  assert.equal(summary.applyAttempts, 2);
  assert.equal(summary.applySuccesses, 1);
  assert.equal(summary.acceptanceRate, 0.5);
  assert.equal(summary.conflicts, 1);
});
