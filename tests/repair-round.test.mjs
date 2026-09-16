import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { runMoA } from "../src/orchestrator.mjs";

const models = {
  models: {
    "GLM-5.3": { id: "GLM-5.3", harness: "pi", providerModel: "GLM-5.3", pi: { provider: "cc-switch-zhipu-glm", model: "glm-5.3" }, tier: "deep", family: "zhipu" },
    "GLM-5.3-flash": { id: "GLM-5.3-flash", harness: "pi", providerModel: "GLM-5.3-Flash", pi: { provider: "cc-switch-zhipu-glm", model: "glm-5.3-flash" }, tier: "fast", family: "zhipu" },
    "DeepSeek-flash": { id: "DeepSeek-flash", harness: "dsh", providerModel: "deepseek-flash", tier: "fast", family: "deepseek" }
  },
  aliases: {},
  tiers: { fast: { pi: "GLM-5.3-flash", dsh: "DeepSeek-flash" }, deep: { pi: "GLM-5.3", dsh: "DeepSeek-flash" } },
  seats: {
    "pi-glm-executor-deep": { harness: "pi", model: "GLM-5.3", modelTier: "deep", mode: "build", role: "executor" },
    "dsh-auditor-fast": { harness: "dsh", modelTier: "fast", mode: "plan", role: "auditor" }
  }
};
const policy = {
  audit: { avoidCaptainFamily: false, strict: false, preferredByCaptainFamily: {} },
  routing: { preferFastForMediumReview: false, experiment: { enabled: false } },
  timeouts: { fastMs: 1000, deepMs: 1000 }
};

test("auditor block triggers a bounded repair round", async () => {
  const root = await mkdtemp(join(tmpdir(), "codex-moa-repair-"));
  const previous = { ...process.env };
  process.env.CODEX_MOA_SEAT_REGISTRY = join(root, "seats.json");
  process.env.CODEX_MOA_COST_LEDGER = join(root, "cost.jsonl");
  process.env.CODEX_MOA_FAILURE_MEMORY = join(root, "failures.jsonl");
  process.env.CODEX_MOA_ROUTING_EXPERIMENT_PATH = join(root, "routing.json");
  process.env.CODEX_MOA_EVOLUTION_HOME = join(root, "evolution");
  process.env.CODEX_MOA_CONTINUITY_PATH = join(root, "continuity.json");
  process.env.CODEX_MOA_MEMORY_HOME = join(root, "memory");
  const calls = [];
  const adapterFor = () => async ({ seat }) => {
    calls.push(seat.seat);
    if (seat.role === "executor") {
      return { seat: seat.seat, harness: seat.harness, requestedModel: seat.model, role: seat.role, mode: seat.mode, status: "done", durationMs: 10, summary: JSON.stringify({ status: "done", summary: "implemented", claims: [], tests: [], blockers: [], uncertainty: [] }) };
    }
    const repairCall = calls.filter((name) => name === seat.seat).length > 1;
    return {
      seat: seat.seat,
      harness: seat.harness,
      requestedModel: seat.model,
      role: seat.role,
      mode: seat.mode,
      status: "done",
      durationMs: 10,
      summary: JSON.stringify(repairCall
        ? { verdict: "pass", findings: [], missing_evidence: [], verified_commands: ["test repaired"] }
        : { verdict: "block", findings: [{ severity: "P1", file: "src/a.js", line: 1, claim: "missing fix", evidence: "fail", recommendation: "fix it" }], missing_evidence: [], verified_commands: [] })
    };
  };
  const config = { blackboardDir: join(root, "blackboard"), defaultCwd: root, maxOutputChars: 4000, quota: { refreshOnRun: false }, safety: { stripSecretEnv: true } };
  try {
    const result = await runMoA({
      taskId: "repair-task",
      task: "Review a risky parser fix",
      cwd: root,
      captainModel: "DeepSeek-flash",
      mode: "review",
      stakes: "medium",
      worktree: false,
      respectQuota: false,
      respectHealth: false,
      routingExperiment: false,
      contextPack: false
    }, { config, models, schedule: {}, policy, adapterFor });
    assert.deepEqual(calls, ["pi-glm-executor-deep", "cross-family-auditor-gate", "pi-glm-executor-deep", "cross-family-auditor-gate"]);
    assert.equal(result.results.find((item) => item.role === "auditor").structured.verdict, "pass");
    const checkpoint = JSON.parse(await readFile(join(config.blackboardDir, "repair-task", "checkpoint.json"), "utf8"));
    assert.equal(checkpoint.repairRounds, 1);
    assert.equal(checkpoint.nodes["cross-family-auditor-gate"].rounds.length, 2);
  } finally {
    for (const key of Object.keys(process.env)) if (!(key in previous)) delete process.env[key];
    Object.assign(process.env, previous);
  }
});
