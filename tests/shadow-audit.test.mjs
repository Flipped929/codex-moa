import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { runMoA } from "../src/orchestrator.mjs";
import { readAuditMetrics, summarizeAuditMetrics } from "../src/lib/audit-metrics.mjs";

const models = {
  models: {
    "kimi-k3": { id: "kimi-k3", harness: "pi", supportedHarnesses: ["pi"], providerModel: "k3", pi: { provider: "kimi", model: "k3" }, tier: "deep", family: "moonshot", reasoning: { supported: ["high", "max"], default: "high" } },
    "GLM-5.3": { id: "GLM-5.3", harness: "pi", supportedHarnesses: ["pi"], providerModel: "glm", pi: { provider: "zai", model: "glm" }, tier: "deep", family: "zhipu", reasoning: { supported: ["high", "max"], default: "high" } },
    "DeepSeek-flash": { id: "DeepSeek-flash", harness: "dsh", supportedHarnesses: ["dsh"], providerModel: "deepseek", dsh: { provider: "deepseek", model: "deepseek" }, tier: "fast", family: "deepseek", reasoning: { supported: ["high", "max"], default: "high" } }
  },
  aliases: {},
  tiers: { deep: { pi: "kimi-k3", dsh: "DeepSeek-flash" }, fast: { pi: "kimi-k3", dsh: "DeepSeek-flash" } },
  seats: {
    "pi-glm-executor-deep": { harness: "pi", model: "GLM-5.3", modelTier: "deep", mode: "build", role: "executor" },
    "kimi-architect": { harness: "pi", model: "kimi-k3", modelTier: "deep", mode: "plan", role: "architect" },
    "dsh-auditor-deep": { harness: "dsh", model: "DeepSeek-flash", modelTier: "deep", mode: "plan", role: "auditor" }
  }
};

test("a failed DeepSeek shadow remains observable without failing the gated task", async () => {
  const root = await mkdtemp(join(tmpdir(), "codex-moa-shadow-"));
  const previous = { ...process.env };
  const auditPath = join(root, "audit.jsonl");
  Object.assign(process.env, {
    CODEX_MOA_AUDIT_METRICS: auditPath,
    CODEX_MOA_SEAT_REGISTRY: join(root, "seats.json"),
    CODEX_MOA_COST_LEDGER: join(root, "cost.jsonl"),
    CODEX_MOA_FAILURE_MEMORY: join(root, "failures.jsonl"),
    CODEX_MOA_EVOLUTION_HOME: join(root, "evolution"),
    CODEX_MOA_CONTINUITY_PATH: join(root, "continuity.json"),
    CODEX_MOA_MEMORY_HOME: join(root, "memory")
  });
  const adapterFor = (seat) => async () => {
    if (seat.auditMode === "shadow") return { seat: seat.seat, harness: seat.harness, requestedModel: seat.model, role: seat.role, mode: seat.mode, status: "failed", timedOut: true, durationMs: 20, summary: "", usage: null };
    if (seat.role === "auditor") return { seat: seat.seat, harness: seat.harness, requestedModel: seat.model, role: seat.role, mode: seat.mode, status: "done", timedOut: false, durationMs: 10, summary: JSON.stringify({ verdict: "pass", findings: [], missing_evidence: [], verified_commands: ["test"] }), usage: { outputTokens: 10 } };
    return { seat: seat.seat, harness: seat.harness, requestedModel: seat.model, role: seat.role, mode: seat.mode, status: "done", timedOut: false, durationMs: 10, summary: JSON.stringify({ status: "done", summary: "ok", claims: [], tests: [], blockers: [], uncertainty: [] }), usage: { outputTokens: 10 } };
  };
  try {
    const result = await runMoA({ taskId: "shadow-task", task: "Review an authentication migration", cwd: root, stakes: "high", mode: "review", worktree: false, respectQuota: false, respectHealth: false, routingExperiment: false, contextPack: false }, {
      config: { blackboardDir: join(root, "blackboard"), defaultCwd: root, maxOutputChars: 4000, quota: { refreshOnRun: false }, safety: { stripSecretEnv: true } },
      models,
      schedule: {},
      policy: { audit: { avoidCaptainFamily: false, deepSeekShadow: { l3Rate: 1 } }, routing: { experiment: { enabled: false } }, reasoning: { mode: "task-aware", defaultByLevel: { L3: "max" }, architectByLevel: { L3: "max" }, auditByStakes: { high: "max" } }, timeouts: { fastMs: 1000, deepMs: 1000 } },
      adapterFor
    });
    assert.equal(result.checkpoint.status, "completed");
    assert.equal(result.navigator.checks.seatFailures, 0);
    assert.equal(result.navigator.checks.shadowFailures, 1);
    assert.deepEqual(result.checkpoint.stageReviews.map((stage) => stage.phase), ["planning", "execution", "verification"]);
    assert.equal(result.checkpoint.stageReviews[1].blockingPassed, true);
    assert.equal(result.checkpoint.stageReviews[2].blockingPassed, true);
    const summary = summarizeAuditMetrics(await readAuditMetrics(auditPath));
    assert.equal(summary.auditRuns, 2);
    assert.equal(summary.routes["DeepSeek-flash@dsh@shadow"].completionRate, 0);
  } finally {
    for (const key of Object.keys(process.env)) if (!(key in previous)) delete process.env[key];
    Object.assign(process.env, previous);
  }
});
