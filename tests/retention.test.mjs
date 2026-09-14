import test from "node:test";
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, readFile, utimes, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { applyRetention, planRetention } from "../src/lib/retention.mjs";

test("plans and applies retention for blackboard, jobs, cost ledger, and routing history", async () => {
  const root = await mkdtemp(join(tmpdir(), "codex-moa-retention-"));
  const previous = { ...process.env };
  const blackboard = join(root, "blackboard");
  const jobs = join(root, "jobs");
  const ledger = join(root, "cost.jsonl");
  const routing = join(root, "routing.json");
  process.env.CODEX_MOA_SEAT_REGISTRY = join(root, "seats.json");
  process.env.CODEX_MOA_JOB_HOME = jobs;
  process.env.CODEX_MOA_COST_LEDGER = ledger;
  process.env.CODEX_MOA_ROUTING_EXPERIMENT_PATH = routing;
  const old = new Date("2020-01-01T00:00:00Z").toISOString();
  const recent = new Date().toISOString();
  try {
    await mkdir(join(blackboard, "old-task"), { recursive: true });
    await mkdir(join(blackboard, "new-task"), { recursive: true });
    await writeFile(join(blackboard, "old-task", "checkpoint.json"), JSON.stringify({ version: 1, status: "completed", nodes: {} }), "utf8");
    await writeFile(join(blackboard, "new-task", "checkpoint.json"), JSON.stringify({ version: 1, status: "completed", nodes: {} }), "utf8");
    await utimes(join(blackboard, "old-task"), new Date("2020-01-01T00:00:00Z"), new Date("2020-01-01T00:00:00Z"));
    await mkdir(join(jobs, "job-old"), { recursive: true });
    await mkdir(join(jobs, "job-new"), { recursive: true });
    await writeFile(join(jobs, "job-old", "job.json"), JSON.stringify({ jobId: "job-old", taskId: "old-task", status: "completed", createdAt: old }), "utf8");
    await writeFile(join(jobs, "job-new", "job.json"), JSON.stringify({ jobId: "job-new", taskId: "new-task", status: "completed", createdAt: recent }), "utf8");
    await utimes(join(jobs, "job-old"), new Date("2020-01-01T00:00:00Z"), new Date("2020-01-01T00:00:00Z"));
    await writeFile(ledger, `${JSON.stringify({ time: old, model: "GLM-5.3" })}\n${JSON.stringify({ time: recent, model: "GLM-5.3" })}\n`, "utf8");
    await writeFile(routing, JSON.stringify({ version: 2, experiments: { exp: { id: "exp", status: "running", history: Array.from({ length: 5 }, (_, index) => ({ index })) } } }), "utf8");

    const config = {
      blackboardDir: blackboard,
      retention: {
        blackboard: { maxAgeDays: 1, maxTasks: 10 },
        jobs: { maxAgeDays: 1, maxJobs: 10 },
        worktrees: { maxAgeDays: 1, onlyClean: true },
        costLedger: { maxAgeDays: 1, maxEntries: 1 },
        routingHistory: { maxEntriesPerExperiment: 2 }
      }
    };
    const plan = await planRetention({ config });
    assert.equal(plan.blackboard.some((item) => item.taskId === "old-task"), true);
    assert.equal(plan.jobs.some((item) => item.jobId === "job-old"), true);
    assert.equal(plan.costLedger.remove, 1);
    assert.equal(plan.routingHistory[0].before, 5);

    const applied = await applyRetention({ config, dryRun: false });
    assert.equal(applied.errors.length, 0);
    assert.equal(existsSync(join(blackboard, "old-task")), false);
    assert.equal(existsSync(join(jobs, "job-old")), false);
    const keptLedger = (await readFile(ledger, "utf8")).trim().split(/\r?\n/);
    assert.equal(keptLedger.length, 1);
    const routingState = JSON.parse(await readFile(routing, "utf8"));
    assert.equal(routingState.experiments.exp.history.length, 2);
  } finally {
    for (const key of Object.keys(process.env)) if (!(key in previous)) delete process.env[key];
    Object.assign(process.env, previous);
  }
});
