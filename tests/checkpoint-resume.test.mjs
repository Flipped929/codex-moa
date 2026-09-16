import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { runMoA } from "../src/orchestrator.mjs";

const models = {
  models: {
    "kimi-2.8": { id: "kimi-2.8", harness: "kimi", providerModel: "kimi-code/kimi-for-coding", tier: "fast", family: "moonshot" },
    "GLM-5.3-flash": { id: "GLM-5.3-flash", harness: "zcode", providerModel: "GLM-5.3-Flash", tier: "fast", family: "zhipu" },
    "DeepSeek-flash": { id: "DeepSeek-flash", harness: "dsh", providerModel: "deepseek-flash", tier: "fast", family: "deepseek" }
  },
  aliases: {},
  tiers: { fast: { kimi: "kimi-2.8", zcode: "GLM-5.3-flash", dsh: "DeepSeek-flash" }, deep: {} },
  seats: {
    architect: { harness: "kimi", modelTier: "fast", mode: "plan", role: "architect" },
    executor: { harness: "zcode", modelTier: "fast", mode: "edit", role: "executor" },
    auditor: { harness: "dsh", modelTier: "fast", mode: "plan", role: "auditor" }
  }
};

const policy = {
  audit: { avoidCaptainFamily: false, strict: false, preferredByCaptainFamily: {} },
  routing: { preferFastForMediumReview: false, experiment: { enabled: false } },
  timeouts: { fastMs: 1000, deepMs: 1000 }
};

test("task DAG persists failed layers and resumes completed nodes", async () => {
  const root = await mkdtemp(join(tmpdir(), "codex-moa-resume-"));
  const previous = { ...process.env };
  process.env.CODEX_MOA_SEAT_REGISTRY = join(root, "seats.json");
  process.env.CODEX_MOA_COST_LEDGER = join(root, "cost.jsonl");
  process.env.CODEX_MOA_FAILURE_MEMORY = join(root, "failures.jsonl");
  process.env.CODEX_MOA_ROUTING_EXPERIMENT_PATH = join(root, "routing.json");
  process.env.CODEX_MOA_EVOLUTION_HOME = join(root, "evolution");
  process.env.CODEX_MOA_CONTINUITY_PATH = join(root, "continuity.json");
  process.env.CODEX_MOA_MEMORY_HOME = join(root, "memory");
  const attempts = { executor: 0 };
  const calls = [];
  const adapterFor = () => async ({ seat }) => {
    calls.push(seat.seat);
    if (seat.seat === "executor" && attempts.executor++ === 0) throw new Error("executor failed once");
    return {
      seat: seat.seat,
      harness: seat.harness,
      requestedModel: seat.model,
      selectedModel: seat.model,
      role: seat.role,
      mode: seat.mode,
      status: "done",
      durationMs: 10,
      summary: `${seat.seat} ok`,
      usage: { inputTokens: 10, outputTokens: 5, totalTokens: 15 }
    };
  };
  const config = { blackboardDir: join(root, "blackboard"), defaultCwd: root, maxOutputChars: 1000, quota: { refreshOnRun: false }, safety: { stripSecretEnv: true } };
  const input = {
    taskId: "resume-task",
    task: "Build and audit a feature",
    cwd: root,
    captainModel: "DeepSeek-flash",
    worktree: false,
    respectQuota: false,
    seats: [{ seat: "architect" }, { seat: "executor" }, { seat: "auditor" }]
  };

  try {
    const first = await runMoA(input, { config, models, schedule: {}, policy, adapterFor });
    assert.deepEqual(first.results.map((result) => result.status), ["done", "error", "blocked"]);
    assert.equal(first.checkpoint.status, "partial");
    assert.deepEqual(calls, ["architect", "executor"]);

    calls.length = 0;
    const resumed = await runMoA({ ...input, resume: true }, { config, models, schedule: {}, policy, adapterFor });
    assert.equal(resumed.resumed, true);
    assert.deepEqual(resumed.results.map((result) => result.status), ["done", "done", "done"]);
    assert.deepEqual(calls, ["executor", "auditor"]);

    const checkpoint = JSON.parse(await readFile(join(config.blackboardDir, "resume-task", "checkpoint.json"), "utf8"));
    assert.equal(checkpoint.status, "completed");
    assert.equal(checkpoint.nodes.architect.status, "done");
    assert.equal(checkpoint.nodes.executor.attempts, 2);
  } finally {
    for (const key of Object.keys(process.env)) if (!(key in previous)) delete process.env[key];
    Object.assign(process.env, previous);
  }
});
