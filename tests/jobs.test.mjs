import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { assertJobInputSupported, createJobRecord, jobInputPath, listJobs, readJob, requestJobCancellation, runJobWorker, writeJob } from "../src/lib/jobs.mjs";

async function fixture(name, input, root) {
  const jobId = `job-test-${name}`;
  const job = createJobRecord({ jobId, taskId: `task-${name}`, input });
  await writeJob(job);
  await writeFile(jobInputPath(jobId), `${JSON.stringify(input)}\n`, "utf8");
  return { root, jobId };
}

test("rejects async jobs that try to persist per-seat env secrets", () => {
  assert.throws(() => assertJobInputSupported({ seats: [{ env: { SECRET: "value" } }] }), /do not persist per-seat env/i);
});

test("runs and persists an async job worker result", async () => {
  const previousJobHome = process.env.CODEX_MOA_JOB_HOME;
  const previousControl = process.env.CODEX_MOA_CONTROL_PATH;
  const root = await mkdtemp(join(tmpdir(), "codex-moa-jobs-complete-"));
  process.env.CODEX_MOA_JOB_HOME = root;
  process.env.CODEX_MOA_CONTROL_PATH = join(root, "control.json");
  const { jobId } = await fixture("complete", { task: "test", cwd: process.cwd(), seats: [{ env: { SECRET: "not-persisted" } }] }, root);
  try {
    const result = await runJobWorker(jobId, {
      runMoA: async (_input, deps) => {
        await deps.onProgress({ type: "seat_started", activeSeat: "executor", completed: 0, total: 1, layer: 0 });
        await deps.onProgress({ type: "seat_finished", seat: "executor", completed: 1, total: 1, layer: 0 });
        return { taskId: "task-complete", level: "L1", results: [{ seat: "executor", status: "done" }], navigator: { verdict: "pass" }, checkpoint: { status: "completed" }, artifacts: { root } };
      }
    });
    assert.equal(result.status, "completed");
    assert.equal(result.progress.completed, 1);
    const stored = await readJob(jobId);
    assert.equal(stored.input.seats[0].env, undefined);
    assert.deepEqual(stored.input.seats[0].envKeys, ["SECRET"]);
    assert.equal((await listJobs())[0].jobId, jobId);
  } finally {
    if (previousJobHome === undefined) delete process.env.CODEX_MOA_JOB_HOME;
    else process.env.CODEX_MOA_JOB_HOME = previousJobHome;
    if (previousControl === undefined) delete process.env.CODEX_MOA_CONTROL_PATH;
    else process.env.CODEX_MOA_CONTROL_PATH = previousControl;
  }
});

test("cancels a running async job through the persisted control request", async () => {
  const previousJobHome = process.env.CODEX_MOA_JOB_HOME;
  const previousControl = process.env.CODEX_MOA_CONTROL_PATH;
  const root = await mkdtemp(join(tmpdir(), "codex-moa-jobs-cancel-"));
  process.env.CODEX_MOA_JOB_HOME = root;
  process.env.CODEX_MOA_CONTROL_PATH = join(root, "control.json");
  const { jobId } = await fixture("cancel", { task: "test", cwd: process.cwd() }, root);
  try {
    const result = await runJobWorker(jobId, {
      runMoA: async (_input, deps) => {
        await requestJobCancellation(jobId, "test cancel");
        const cancelled = await deps.isCancelled();
        return { taskId: "task-cancel", level: "L1", results: [{ seat: "executor", status: cancelled ? "cancelled" : "done" }], navigator: { verdict: "warn" }, checkpoint: { status: "cancelled" }, artifacts: { root } };
      }
    });
    assert.equal(result.status, "cancelled");
    assert.equal(result.cancelRequested, true);
  } finally {
    if (previousJobHome === undefined) delete process.env.CODEX_MOA_JOB_HOME;
    else process.env.CODEX_MOA_JOB_HOME = previousJobHome;
    if (previousControl === undefined) delete process.env.CODEX_MOA_CONTROL_PATH;
    else process.env.CODEX_MOA_CONTROL_PATH = previousControl;
  }
});
