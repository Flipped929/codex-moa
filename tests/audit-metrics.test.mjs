import test from "node:test";
import assert from "node:assert/strict";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { mkdtemp } from "node:fs/promises";
import { readAuditMetrics, recordAuditAdjudication, recordAuditRun, summarizeAuditMetrics } from "../src/lib/audit-metrics.mjs";

test("records executor-auditor pairing, throughput, cost, and adjudication", async () => {
  const root = await mkdtemp(join(tmpdir(), "codex-moa-audit-metrics-"));
  const path = join(root, "audit.jsonl");
  await recordAuditRun({
    taskId: "task-1",
    executorModel: "GLM-5.3",
    executorHarness: "pi",
    auditorSeat: "shadow",
    auditorModel: "DeepSeek-flash",
    auditorHarness: "codex",
    auditMode: "shadow",
    status: "done",
    verdict: "warn",
    durationMs: 2000,
    outputTokens: 100,
    estimatedUsd: 0.02
  }, path);
  await recordAuditAdjudication({ taskId: "task-1", auditorSeat: "shadow", acceptedFindings: 1, falsePositives: 0, taskAccepted: true, testsPassed: true }, path);
  const summary = summarizeAuditMetrics(await readAuditMetrics(path));
  const route = summary.routes["DeepSeek-flash@codex@shadow"];
  assert.equal(route.completionRate, 1);
  assert.equal(route.outputTps, 50);
  assert.equal(route.usefulFindingRate, 1);
  assert.equal(route.costPerAcceptedFinding, 0.02);
});
