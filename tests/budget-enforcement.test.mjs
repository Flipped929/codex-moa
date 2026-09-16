import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { runMoA } from "../src/orchestrator.mjs";

const models = {
  models: {
    "kimi-2.8": { id: "kimi-2.8", harness: "kimi", providerModel: "kimi-code/kimi-for-coding", tier: "fast", family: "moonshot" },
    "GLM-5.3-flash": { id: "GLM-5.3-flash", harness: "zcode", providerModel: "GLM-5.3-Flash", tier: "fast", family: "zhipu" }
  },
  aliases: {},
  tiers: { fast: { kimi: "kimi-2.8", zcode: "GLM-5.3-flash" }, deep: {} },
  seats: {}
};
const policy = { audit: { avoidCaptainFamily: false }, routing: { experiment: { enabled: false } }, timeouts: { fastMs: 1000, deepMs: 1000 } };

test("blocks downstream DAG nodes when a task budget is exceeded", async () => {
  const root = await mkdtemp(join(tmpdir(), "codex-moa-budget-"));
  const previous = { ...process.env };
  process.env.CODEX_MOA_SEAT_REGISTRY = join(root, "seats.json");
  process.env.CODEX_MOA_COST_LEDGER = join(root, "cost.jsonl");
  process.env.CODEX_MOA_FAILURE_MEMORY = join(root, "failures.jsonl");
  process.env.CODEX_MOA_ROUTING_EXPERIMENT_PATH = join(root, "routing.json");
  process.env.CODEX_MOA_EVOLUTION_HOME = join(root, "evolution");
  process.env.CODEX_MOA_CONTINUITY_PATH = join(root, "continuity.json");
  const calls = [];
  const adapterFor = () => async ({ seat }) => {
    calls.push(seat.seat);
    return {
      seat: seat.seat,
      harness: seat.harness,
      requestedModel: seat.model,
      role: seat.role,
      mode: seat.mode,
      status: "done",
      durationMs: 10,
      summary: JSON.stringify({ status: "done", summary: "ok", claims: [], tests: [], blockers: [], uncertainty: [] }),
      usage: { inputTokens: 8, outputTokens: 2, totalTokens: 10 }
    };
  };
  const config = { blackboardDir: join(root, "blackboard"), defaultCwd: root, maxOutputChars: 1000, quota: { refreshOnRun: false }, safety: { stripSecretEnv: true } };
  try {
    const result = await runMoA({
      taskId: "budget-task",
      task: "Design and implement a change",
      cwd: root,
      captainModel: "DeepSeek-flash",
      assignments: [
        { seat: "architect", model: "kimi-2.8", role: "architect", mode: "plan" },
        { seat: "executor", model: "GLM-5.3-flash", role: "executor", mode: "plan" }
      ],
      budget: { enforce: true, maxTokens: 5 },
      worktree: false,
      respectQuota: false,
      contextPack: false
    }, { config, models, schedule: {}, policy, adapterFor });
    assert.deepEqual(calls, ["architect"]);
    assert.equal(result.results.find((item) => item.seat === "executor").status, "blocked");
    assert.ok(result.budget.exceeded.some((item) => item.type === "tokens"));
    assert.equal(result.checkpoint.status, "partial");
    const checkpoint = JSON.parse(await readFile(join(config.blackboardDir, "budget-task", "checkpoint.json"), "utf8"));
    assert.equal(checkpoint.nodes.executor.status, "blocked");
  } finally {
    for (const key of Object.keys(process.env)) if (!(key in previous)) delete process.env[key];
    Object.assign(process.env, previous);
  }
});

test("refuses external core execution for L3 unless ownership is explicitly overridden", async () => {
  const root = await mkdtemp(join(tmpdir(), "codex-moa-captain-primary-"));
  const previous = { ...process.env };
  process.env.CODEX_MOA_COST_LEDGER = join(root, "cost.jsonl");
  process.env.CODEX_MOA_FAILURE_MEMORY = join(root, "failures.jsonl");
  process.env.CODEX_MOA_ROUTING_EXPERIMENT_PATH = join(root, "routing.json");
  process.env.CODEX_MOA_EVOLUTION_HOME = join(root, "evolution");
  process.env.CODEX_MOA_CONTINUITY_PATH = join(root, "continuity.json");
  const calls = [];
  const config = { blackboardDir: join(root, "blackboard"), defaultCwd: root, maxOutputChars: 1000, quota: { refreshOnRun: false }, safety: { stripSecretEnv: true } };
  try {
    await assert.rejects(() => runMoA({
      taskId: "captain-primary-task",
      task: "Implement a production multi-model real-time safety cascade",
      cwd: root,
      stakes: "high",
      assignments: [{ seat: "executor", model: "GLM-5.3-flash", role: "executor", mode: "build" }],
      worktree: false,
      respectQuota: false,
      respectHealth: false,
      routingExperiment: false,
      contextPack: false
    }, {
      config,
      models,
      schedule: {},
      policy,
      adapterFor: () => async ({ seat }) => { calls.push(seat.seat); }
    }), /CAPTAIN_PRIMARY_REQUIRED/);
    assert.deepEqual(calls, []);
  } finally {
    for (const key of Object.keys(process.env)) if (!(key in previous)) delete process.env[key];
    Object.assign(process.env, previous);
  }
});
