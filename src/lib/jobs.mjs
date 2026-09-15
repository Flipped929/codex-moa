import { existsSync } from "node:fs";
import { chmod, mkdir, open, readFile, readdir, rename, stat, unlink, writeFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { requestCancellation } from "./control-store.mjs";
import { pluginRoot } from "./config.mjs";

const TERMINAL = new Set(["completed", "partial", "failed", "cancelled", "paused"]);
const WORKER_ENV_KEYS = new Set(["PATH", "HOME", "USER", "LOGNAME", "SHELL", "TMPDIR", "TMP", "TEMP", "LANG", "LC_ALL", "TERM", "NO_COLOR", "FORCE_COLOR", "CODEX_HOME", "CC_SWITCH_HOME"]);
const SECRET_ENV_RE = /(API[_-]?KEY|TOKEN|SECRET|PASSWORD|CREDENTIAL|AUTH|COOKIE)/i;

export function buildJobWorkerEnv(source = process.env, overrides = {}) {
  const env = {};
  for (const [key, value] of Object.entries(source)) {
    const allowed = WORKER_ENV_KEYS.has(key) || key.startsWith("LC_") || key.startsWith("XDG_") || key.startsWith("CODEX_MOA_");
    if (allowed && !SECRET_ENV_RE.test(key) && typeof value === "string") env[key] = value;
  }
  return { ...env, ...overrides };
}

function expandHome(value) {
  if (typeof value !== "string") return value;
  if (value === "~") return homedir();
  if (value.startsWith("~/")) return resolve(homedir(), value.slice(2));
  return resolve(value);
}

export function jobsRoot() {
  return expandHome(process.env.CODEX_MOA_JOB_HOME || "~/.codex-moa/jobs");
}

function jobDir(jobId) {
  if (!/^job-[A-Za-z0-9._-]{1,100}$/.test(String(jobId))) throw new Error(`Invalid jobId: ${jobId}`);
  return join(jobsRoot(), jobId);
}

export function jobPath(jobId) {
  return join(jobDir(jobId), "job.json");
}

export function jobInputPath(jobId) {
  return join(jobDir(jobId), "input.json");
}

export function jobLogPath(jobId) {
  return join(jobDir(jobId), "worker.log");
}

function publicInput(input) {
  if (!input) return null;
  const copy = JSON.parse(JSON.stringify(input));
  for (const collection of [copy.seats, copy.assignments]) {
    if (!Array.isArray(collection)) continue;
    for (const seat of collection) {
      if (!seat?.env) continue;
      seat.envKeys = Object.keys(seat.env);
      delete seat.env;
    }
  }
  return copy;
}

export function assertJobInputSupported(input) {
  for (const collection of [input?.seats, input?.assignments]) {
    if (!Array.isArray(collection)) continue;
    for (const seat of collection) {
      if (seat?.env && Object.keys(seat.env).length > 0) {
        throw new Error("Async jobs do not persist per-seat env values. Use synchronous moa_run or provider configuration for credentials.");
      }
    }
  }
  return input;
}

export function createJobRecord({ jobId = `job-${Date.now().toString(36)}-${randomUUID().slice(0, 8)}`, taskId, input }) {
  const now = new Date().toISOString();
  return {
    version: 1,
    jobId,
    taskId,
    status: "queued",
    cancelRequested: false,
    pauseRequested: false,
    createdAt: now,
    updatedAt: now,
    startedAt: null,
    finishedAt: null,
    pid: null,
    progress: { phase: "queued", completed: 0, total: 0, activeSeat: null },
    control: { revision: 0, messages: [] },
    input: publicInput(input),
    resultSummary: null,
    error: null
  };
}

async function atomicWrite(path, value) {
  await mkdir(dirname(path), { recursive: true });
  const temporary = `${path}.${randomUUID()}.tmp`;
  await writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 });
  await rename(temporary, path);
  await chmod(path, 0o600).catch(() => {});
}

async function withLock(jobId, fn, timeoutMs = 10000) {
  const lockPath = join(jobDir(jobId), "job.lock");
  await mkdir(dirname(lockPath), { recursive: true });
  const started = Date.now();
  let handle;
  while (!handle) {
    try {
      handle = await open(lockPath, "wx", 0o600);
    } catch (error) {
      if (error?.code !== "EEXIST") throw error;
      if (Date.now() - started > timeoutMs) throw new Error(`Timed out waiting for job lock: ${jobId}`);
      await new Promise((resolveDelay) => setTimeout(resolveDelay, 20));
    }
  }
  try {
    await handle.writeFile(`${process.pid}\n`);
    return await fn();
  } finally {
    await handle.close().catch(() => {});
    await unlink(lockPath).catch(() => {});
  }
}

export async function writeJob(job) {
  await atomicWrite(jobPath(job.jobId), job);
  return job;
}

export async function readJob(jobId) {
  const path = jobPath(jobId);
  if (!existsSync(path)) return null;
  try {
    return JSON.parse(await readFile(path, "utf8"));
  } catch {
    return null;
  }
}

export async function updateJob(jobId, patch) {
  return withLock(jobId, async () => {
    const current = await readJob(jobId);
    if (!current) throw new Error(`Job not found: ${jobId}`);
    const next = typeof patch === "function" ? patch(current) : { ...current, ...patch };
    next.updatedAt = new Date().toISOString();
    await writeJob(next);
    return next;
  });
}

export async function listJobs(limit = 50) {
  const root = jobsRoot();
  if (!existsSync(root)) return [];
  const entries = await readdir(root, { withFileTypes: true });
  const jobs = [];
  for (const entry of entries) {
    if (!entry.isDirectory() || !entry.name.startsWith("job-")) continue;
    const job = await readJob(entry.name);
    if (job) jobs.push(publicJob(job));
  }
  return jobs.sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt))).slice(0, limit);
}

export function publicJob(job) {
  if (!job) return null;
  return {
    version: job.version,
    jobId: job.jobId,
    taskId: job.taskId,
    status: job.status,
    cancelRequested: job.cancelRequested === true,
    pauseRequested: job.pauseRequested === true,
    createdAt: job.createdAt,
    updatedAt: job.updatedAt,
    startedAt: job.startedAt,
    finishedAt: job.finishedAt,
    pid: job.pid,
    progress: job.progress,
    resultSummary: job.resultSummary,
    error: job.error,
    logPath: jobLogPath(job.jobId),
    inputPath: jobInputPath(job.jobId),
    input: job.input,
    control: {
      revision: Number(job.control?.revision ?? 0),
      pendingMessages: (job.control?.messages ?? []).filter((item) => item.status === "pending").length,
      deliveredMessages: (job.control?.messages ?? []).filter((item) => item.status === "delivered").length,
      lastMessageId: job.control?.messages?.at(-1)?.id ?? null
    }
  };
}

async function spawnJobWorker(record) {
  const workerPath = join(pluginRoot, "scripts", "moa-job-worker.mjs");
  const logHandle = await open(jobLogPath(record.jobId), "a", 0o600);
  const { spawn } = await import("node:child_process");
  const child = spawn(process.execPath, [workerPath, record.jobId], {
    cwd: process.cwd(),
    detached: true,
    stdio: ["ignore", logHandle.fd, logHandle.fd],
    env: buildJobWorkerEnv(process.env, { CODEX_MOA_JOB_HOME: jobsRoot() })
  });
  child.unref();
  await logHandle.close().catch(() => {});
  return updateJob(record.jobId, { pid: child.pid, status: "queued" });
}

export async function startJob({ input, jobId, taskId }) {
  assertJobInputSupported(input);
  const record = createJobRecord({ jobId, taskId, input });
  await writeJob(record);
  await atomicWrite(jobInputPath(record.jobId), publicInput(input));
  return spawnJobWorker(record);
}

export async function steerJob(jobId, message) {
  if (!String(message ?? "").trim()) throw new Error("Steering message is required");
  const job = await readJob(jobId);
  if (!job) throw new Error(`Job not found: ${jobId}`);
  if (TERMINAL.has(job.status)) throw new Error(`Job ${jobId} is ${job.status}; resume a paused job or start a new job.`);
  const entry = { id: `msg-${randomUUID().slice(0, 12)}`, message: String(message).trim(), status: "pending", createdAt: new Date().toISOString(), deliveredAt: null };
  const updated = await updateJob(jobId, (current) => ({
    ...current,
    control: { revision: Number(current.control?.revision ?? 0) + 1, messages: [...(current.control?.messages ?? []), entry] }
  }));
  return { accepted: true, delivery: "next-safe-boundary", messageId: entry.id, job: publicJob(updated) };
}

export async function consumeJobSteering(jobId) {
  let delivered = [];
  await updateJob(jobId, (current) => {
    const now = new Date().toISOString();
    delivered = (current.control?.messages ?? []).filter((item) => item.status === "pending");
    return {
      ...current,
      control: {
        revision: Number(current.control?.revision ?? 0),
        messages: (current.control?.messages ?? []).map((item) => item.status === "pending" ? { ...item, status: "delivered", deliveredAt: now } : item)
      }
    };
  });
  return delivered.map((item) => ({ id: item.id, message: item.message, createdAt: item.createdAt }));
}

export async function pauseJob(jobId, reason = "operator request") {
  const job = await readJob(jobId);
  if (!job) throw new Error(`Job not found: ${jobId}`);
  if (TERMINAL.has(job.status)) return publicJob(job);
  const updated = await updateJob(jobId, {
    pauseRequested: true,
    progress: { ...(job.progress ?? {}), phase: "pausing" }
  });
  await requestCancellation({ taskId: updated.taskId, reason: `pause job ${jobId}: ${reason}` });
  return publicJob(updated);
}

export async function resumeJob(jobId) {
  const job = await readJob(jobId);
  if (!job) throw new Error(`Job not found: ${jobId}`);
  if (job.status !== "paused") throw new Error(`Job ${jobId} is ${job.status}; only paused jobs can resume.`);
  const input = JSON.parse(await readFile(jobInputPath(jobId), "utf8"));
  await atomicWrite(jobInputPath(jobId), { ...input, resume: true });
  const updated = await updateJob(jobId, {
    status: "queued", cancelRequested: false, pauseRequested: false, finishedAt: null, error: null,
    progress: { ...(job.progress ?? {}), phase: "queued", activeSeat: null }
  });
  return spawnJobWorker(updated);
}

export async function requestJobCancellation(jobId, reason = "operator request") {
  const job = await readJob(jobId);
  if (!job) throw new Error(`Job not found: ${jobId}`);
  if (TERMINAL.has(job.status)) return publicJob(job);
  const updated = await updateJob(jobId, {
    cancelRequested: true,
    progress: { ...(job.progress ?? {}), phase: "cancelling" }
  });
  await requestCancellation({ taskId: updated.taskId, reason: `job ${jobId}: ${reason}` });
  return publicJob(updated);
}

export async function waitForJob(jobId, timeoutMs = 10000, pollMs = 250) {
  const started = Date.now();
  while (true) {
    const job = await readJob(jobId);
    if (!job) throw new Error(`Job not found: ${jobId}`);
    if (TERMINAL.has(job.status)) return { timedOut: false, job: publicJob(job) };
    if (Date.now() - started >= timeoutMs) return { timedOut: true, job: publicJob(job) };
    await new Promise((resolveDelay) => setTimeout(resolveDelay, pollMs));
  }
}

export async function runJobWorker(jobId, deps = {}) {
  const runMoA = deps.runMoA ?? (await import("../orchestrator.mjs")).runMoA;
  const job = await readJob(jobId);
  if (!job) throw new Error(`Job not found: ${jobId}`);
  const input = JSON.parse(await readFile(jobInputPath(jobId), "utf8"));
  await updateJob(jobId, { status: "running", startedAt: new Date().toISOString(), progress: { phase: "running", completed: 0, total: 0, activeSeat: null } });

  try {
    const result = await runMoA(input, {
      ...deps.deps,
      isCancelled: async () => {
        const current = await readJob(jobId);
        return current?.cancelRequested === true || current?.pauseRequested === true;
      },
      consumeSteering: async () => consumeJobSteering(jobId),
      onProgress: async (event) => {
        const current = await readJob(jobId);
        if (!current) return;
        const progress = {
          phase: event.type,
          completed: event.completed ?? current.progress?.completed ?? 0,
          total: event.total ?? current.progress?.total ?? 0,
          activeSeat: event.activeSeat ?? null,
          layer: event.layer ?? current.progress?.layer ?? null
        };
        await updateJob(jobId, { progress });
      }
    });
    const afterRun = await readJob(jobId);
    const cancelled = afterRun?.cancelRequested === true;
    const paused = afterRun?.pauseRequested === true;
    const allDone = result.results.length > 0 && result.results.every((item) => item.status === "done");
    const status = paused ? "paused" : allDone || result.results.length === 0 ? "completed" : cancelled ? "cancelled" : "partial";
    const latest = await readJob(jobId);
    const final = await updateJob(jobId, {
      status,
      finishedAt: new Date().toISOString(),
      progress: { ...(latest?.progress ?? job.progress ?? {}), phase: status, activeSeat: null },
      resultSummary: {
        taskId: result.taskId,
        level: result.level,
        seats: result.results.map((item) => ({ seat: item.seat, status: item.status })),
        navigator: result.navigator?.verdict ?? null,
        checkpoint: result.checkpoint,
        artifacts: result.artifacts
      }
    });
    return publicJob(final);
  } catch (error) {
    const interrupted = await readJob(jobId);
    const interruptedStatus = interrupted?.pauseRequested ? "paused" : interrupted?.cancelRequested ? "cancelled" : "failed";
    const final = await updateJob(jobId, {
      status: interruptedStatus,
      finishedAt: new Date().toISOString(),
      progress: { phase: interruptedStatus, activeSeat: null },
      error: interruptedStatus === "failed" ? (error?.stack ?? String(error)) : null
    });
    return publicJob(final);
  }
}

export async function jobIsTerminal(jobId) {
  const job = await readJob(jobId);
  return Boolean(job && TERMINAL.has(job.status));
}
