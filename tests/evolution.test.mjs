import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { analyzeEvolution, applyProposal, createProposal, getProposal, recordOutcome, rollbackProposal, updateProposalStatus, validateReasoningPolicyPatch } from "../src/lib/evolution.mjs";

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), "codex-moa-evolution-"));
  const policy = join(root, "evolution.json");
  await writeFile(policy, JSON.stringify({ version: 1, audit: { avoidCaptainFamily: false }, timeouts: { deepMs: 1000 } }), "utf8");
  const paths = {
    root: join(root, "store"),
    events: join(root, "store", "events.jsonl"),
    outcomes: join(root, "store", "outcomes.jsonl"),
    proposals: join(root, "store", "proposals"),
    backups: join(root, "store", "backups")
  };
  for (const dir of [paths.root, paths.proposals, paths.backups]) await mkdir(dir, { recursive: true });
  return { root, policy, paths };
}

test("evolution proposal requires approval and confirmation", async () => {
  const { policy, paths } = await fixture();
  const proposal = await createProposal({
    title: "Enable strict audit",
    problem: "Same-family warnings observed",
    evidence: ["auditWarnings=2"],
    policyPatch: { audit: { avoidCaptainFamily: true } }
  }, paths);

  await assert.rejects(
    () => applyProposal(proposal.id, `APPLY ${proposal.id}`, paths, policy),
    /must be approved/
  );

  await updateProposalStatus(proposal.id, "approved", `APPROVE ${proposal.id}`, `APPROVE ${proposal.id}`, paths);
  await assert.rejects(
    () => applyProposal(proposal.id, "APPLY wrong", paths, policy),
    /Confirmation mismatch/
  );

  const applied = await applyProposal(proposal.id, `APPLY ${proposal.id}`, paths, policy);
  assert.equal(applied.status, "applied");
  const updated = JSON.parse(await readFile(policy, "utf8"));
  assert.equal(updated.audit.avoidCaptainFamily, true);

  const rolledBack = await rollbackProposal(proposal.id, `ROLLBACK ${proposal.id}`, paths, policy);
  assert.equal(rolledBack.status, "rolled_back");
  const restored = JSON.parse(await readFile(policy, "utf8"));
  assert.equal(restored.audit.avoidCaptainFamily, false);
});

test("rejects unsafe evolution policy keys", async () => {
  const { paths } = await fixture();
  await assert.rejects(
    () => createProposal({
      title: "Unsafe",
      problem: "Prototype pollution attempt",
      policyPatch: JSON.parse('{"__proto__":{"polluted":true}}')
    }, paths),
    /Unsafe policy key/
  );
});

test("allows reasoning policy proposals", async () => {
  const { paths } = await fixture();
  const proposal = await createProposal({
    title: "Tune audit effort",
    problem: "Repeated audit misses",
    policyPatch: { reasoning: { auditByStakes: { high: "max" } } }
  }, paths);
  assert.equal(proposal.policyPatch.reasoning.auditByStakes.high, "max");
});

test("rejects proposal path traversal", async () => {
  const { paths } = await fixture();
  await assert.rejects(() => getProposal("../../outside", paths), /Invalid proposal ID/);
});

test("deduplicates active proposals with the same policy patch", async () => {
  const { paths } = await fixture();
  const first = await createProposal({
    title: "First wording",
    problem: "Repeated warning",
    policyPatch: { audit: { avoidCaptainFamily: true } }
  }, paths);
  const second = await createProposal({
    title: "Second wording",
    problem: "Same policy change",
    policyPatch: { audit: { avoidCaptainFamily: true } }
  }, paths);
  assert.equal(second.id, first.id);
  assert.equal(second.deduplicated, true);
  assert.ok(Date.parse(first.expiresAt) > Date.parse(first.createdAt));
});

test("evolution analysis marks low-sample rates as descriptive", async () => {
  const { paths } = await fixture();
  await import("node:fs/promises").then(({ writeFile }) => writeFile(paths.events, `${JSON.stringify({
    type: "task_completed",
    results: [{ seat: "executor", requestedModel: "GLM-5.3-flash", status: "done", timedOut: false }]
  })}\n`, "utf8"));
  const analysis = await analyzeEvolution(paths);
  assert.equal(analysis.seats.executor.successRate, 1);
  assert.equal(analysis.seats.executor.sampleSufficient, false);
  assert.equal(analysis.evidencePolicy.minimumSamples, 3);
});

test("reasoning evolution rejects efforts outside the effective model capability", () => {
  const modelTable = {
    models: {
      "GLM-5.3": { id: "GLM-5.3", reasoning: { supported: ["high", "max"], default: "max" } }
    },
    aliases: {}
  };
  assert.throws(
    () => validateReasoningPolicyPatch({ reasoning: { byModel: { "GLM-5.3": { byLevel: { L1: "low" } } } } }, modelTable),
    /maps it to high/
  );
  const valid = validateReasoningPolicyPatch({ reasoning: { mode: "task-aware", byModel: { "GLM-5.3": { byLevel: { L3: "max" } } } } }, modelTable);
  assert.equal(valid.ok, true);
  assert.equal(valid.checks[0].effective, "max");
});

test("evolution analysis groups outcomes by model and effective reasoning effort", async () => {
  const { paths } = await fixture();
  await writeFile(paths.events, `${JSON.stringify({
    type: "task_completed",
    results: [{ requestedModel: "kimi-k3", harness: "pi", reasoningEffort: "high", reasoningSource: "vendor-profile", status: "done", timedOut: false, durationMs: 20, usage: { totalTokens: 30, outputTokens: 10 } }]
  })}\n`, "utf8");
  const analysis = await analyzeEvolution(paths);
  assert.equal(analysis.reasoningRoutes["kimi-k3@pi@high"].runs, 1);
  assert.equal(analysis.reasoningRoutes["kimi-k3@pi@high"].totalTokens, 30);
  assert.equal(analysis.reasoningRoutes["kimi-k3@pi@high"].outputTps, 500);
  assert.equal(analysis.reasoningRoutes["kimi-k3@pi@high"].sampleSufficient, false);
});

test("evolution analysis compares execution routes by level with quality before cost and speed", async () => {
  const { paths } = await fixture();
  const events = [1, 2, 3].map((index) => JSON.stringify({
    type: "task_completed",
    taskId: `route-${index}`,
    level: "L1",
    stageReviews: [{ phase: "execution", blockingPassed: true }],
    results: [{ role: "executor", requestedModel: "GLM-5.3-flash", harness: "pi", status: "done", timedOut: false, durationMs: 1000, usage: { outputTokens: 100 }, estimatedUsd: 0.02 }]
  })).join("\n");
  await writeFile(paths.events, `${events}\n`, "utf8");
  await recordOutcome({ taskId: "route-1", stage: "execution", accepted: true, testsPassed: true, quality: 8 }, paths);
  for (const index of [1, 2, 3]) await recordOutcome({ taskId: `route-${index}`, stage: "final", accepted: true, testsPassed: true, quality: 9 }, paths);
  const analysis = await analyzeEvolution(paths);
  const route = analysis.executionRoutes["L1:GLM-5.3-flash@pi"];
  assert.equal(route.sampleSufficient, true);
  assert.equal(route.qualityGatePassed, true);
  assert.equal(route.acceptanceRate, 1);
  assert.equal(route.averageQuality, 9);
  assert.equal(route.outputTps, 100);
  assert.ok(Math.abs(route.costPerAcceptedTask - 0.02) < 1e-9);
  assert.equal(analysis.stageReviews.automatic, 3);
  assert.equal(analysis.stageReviews.captainRecorded, 1);
  assert.equal(analysis.acceptanceRate, 1);
  assert.equal(analysis.bestQualifiedRouteByLevel.L1.route, "L1:GLM-5.3-flash@pi");
});
