import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { acknowledgeJobNotification, assertJobInputSupported, buildJobWorkerEnv, consumeJobSteering, createJobRecord, jobInputPath, listJobs, notifyJobCompletion, pauseJob, readJob, requestJobCancellation, resolveOriginThreadBinding, runJobWorker, steerJob, supervisorView, writeJob } from "../src/lib/jobs.mjs";

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

test("preflights persistent Harness requests before creating a background job", () => {
  assert.doesNotThrow(() => assertJobInputSupported({ assignments: [{ harness: "pi", runtime: "persistent" }] }));
  assert.throws(() => assertJobInputSupported({ assignments: [{ harness: "unknown", runtime: "persistent" }] }), /No persistent runtime configured/);
});

test("background workers inherit only an explicit environment allowlist", () => {
  const env = buildJobWorkerEnv({ PATH: "/bin", LANG: "en_US.UTF-8", RANDOM_VALUE: "no", OPENAI_API_KEY: "secret", CODEX_MOA_BLACKBOARD: "/tmp/moa" });
  assert.equal(env.PATH, "/bin");
  assert.equal(env.CODEX_MOA_BLACKBOARD, "/tmp/moa");
  assert.equal(env.RANDOM_VALUE, undefined);
  assert.equal(env.OPENAI_API_KEY, undefined);
});

test("binds a background job to explicit, MCP metadata, or environment thread context", () => {
  assert.deepEqual(resolveOriginThreadBinding({ explicit: "thread-explicit", extra: { _meta: { threadId: "thread-meta" } }, env: { CODEX_THREAD_ID: "thread-env" } }), { threadId: "thread-explicit", source: "explicit" });
  assert.deepEqual(resolveOriginThreadBinding({ extra: { _meta: { "codex/threadId": "thread-meta" } }, env: { CODEX_THREAD_ID: "thread-env" } }), { threadId: "thread-meta", source: "mcp-request-meta" });
  assert.deepEqual(resolveOriginThreadBinding({ extra: {}, env: { CODEX_THREAD_ID: "thread-env" } }), { threadId: "thread-env", source: "environment" });
  assert.deepEqual(resolveOriginThreadBinding({ extra: {}, env: {} }), { threadId: null, source: null });
});

test("supervisor reports heartbeat loss and progress-based ETA", () => {
  const createdAt = "2026-09-17T00:00:00.000Z";
  const job = createJobRecord({ jobId: "job-test-supervisor", taskId: "task-supervisor", input: { task: "observe" } });
  job.status = "running";
  job.createdAt = createdAt;
  job.startedAt = createdAt;
  job.progress = { phase: "seat_started", completed: 1, total: 3, activeSeat: "glm-executor" };
  job.supervisor = { ...job.supervisor, heartbeatAt: createdAt, lastProgressAt: createdAt, activeSeat: "glm-executor" };
  const view = supervisorView(job, Date.parse(createdAt) + 40_000);
  assert.equal(view.state, "lost");
  assert.equal(view.attention, "worker-heartbeat-lost");
  assert.equal(view.activeSeat, "glm-executor");
  assert.equal(view.estimatedRemainingMs, 80_000);
  assert.equal(view.etaConfidence, "low");
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

test("binds completion to the origin thread, persists queue acceptance, and requires captain acknowledgement", async () => {
  const previousJobHome = process.env.CODEX_MOA_JOB_HOME;
  const root = await mkdtemp(join(tmpdir(), "codex-moa-jobs-notify-"));
  process.env.CODEX_MOA_JOB_HOME = root;
  const jobId = "job-test-notify";
  const record = createJobRecord({
    jobId,
    taskId: "task-notify",
    input: { task: "notify", cwd: process.cwd() },
    originThreadId: "01-test-thread"
  });
  await writeJob({ ...record, status: "completed", finishedAt: new Date().toISOString() });
  await writeFile(jobInputPath(jobId), `${JSON.stringify(record.input)}\n`, "utf8");
  const deliveries = [];
  try {
    const notified = await notifyJobCompletion(jobId, {
      deliver: async (payload) => deliveries.push(payload)
    });
    assert.equal(deliveries.length, 1);
    assert.equal(deliveries[0].threadId, "01-test-thread");
    assert.match(deliveries[0].message, /moa_job_ack/);
    assert.equal(notified.notification.state, "delivered");
    assert.equal(notified.notification.attempts, 1);

    const acknowledged = await acknowledgeJobNotification(jobId);
    assert.equal(acknowledged.notification.state, "delivered");
    assert.equal(acknowledged.notification.handlingState, "acknowledged");
    assert.ok(acknowledged.notification.acknowledgedAt);
  } finally {
    if (previousJobHome === undefined) delete process.env.CODEX_MOA_JOB_HOME;
    else process.env.CODEX_MOA_JOB_HOME = previousJobHome;
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

test("persists steering and supports a distinct pause state", async () => {
  const previousJobHome = process.env.CODEX_MOA_JOB_HOME;
  const previousControl = process.env.CODEX_MOA_CONTROL_PATH;
  const root = await mkdtemp(join(tmpdir(), "codex-moa-jobs-control-"));
  process.env.CODEX_MOA_JOB_HOME = root;
  process.env.CODEX_MOA_CONTROL_PATH = join(root, "control.json");
  const { jobId } = await fixture("control", { task: "test", cwd: process.cwd() }, root);
  try {
    const steered = await steerJob(jobId, "Check the new constraint");
    assert.equal(steered.accepted, true);
    assert.equal(steered.job.control.pendingMessages, 1);
    const messages = await consumeJobSteering(jobId);
    assert.equal(messages[0].message, "Check the new constraint");
    assert.equal((await readJob(jobId)).control.messages[0].status, "delivered");
    const paused = await pauseJob(jobId, "test pause");
    assert.equal(paused.pauseRequested, true);
    assert.equal(paused.cancelRequested, false);
  } finally {
    if (previousJobHome === undefined) delete process.env.CODEX_MOA_JOB_HOME;
    else process.env.CODEX_MOA_JOB_HOME = previousJobHome;
    if (previousControl === undefined) delete process.env.CODEX_MOA_CONTROL_PATH;
    else process.env.CODEX_MOA_CONTROL_PATH = previousControl;
  }
});
