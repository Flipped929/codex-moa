import { existsSync } from "node:fs";
import { chmod, mkdir, open, readFile, readdir, rename, stat, unlink, writeFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { requestCancellation } from "./control-store.mjs";
import { loadConfig, pluginRoot } from "./config.mjs";
import { resolveSeatRuntime } from "./runtime-contract.mjs";

const TERMINAL = new Set(["completed", "partial", "failed", "cancelled", "paused"]);
const THREAD_ID_RE = /^[A-Za-z0-9._:-]{1,160}$/;
const DEFAULT_HEARTBEAT_MS = 5_000;
const DEFAULT_SILENCE_WARNING_MS = 180_000;
const DEFAULT_HEARTBEAT_LOST_MS = 30_000;
const WORKER_ENV_KEYS = new Set(["PATH", "HOME", "USER", "LOGNAME", "SHELL", "TMPDIR", "TMP", "TEMP", "LANG", "LC_ALL", "TERM", "NO_COLOR", "FORCE_COLOR", "CODEX_HOME", "CC_SWITCH_HOME"]);
const SECRET_ENV_RE = /(API[_-]?KEY|TOKEN|SECRET|PASSWORD|CREDENTIAL|AUTH|COOKIE)/i;
const execFileAsync = promisify(execFile);

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
  const config = loadConfig();
  for (const collection of [input?.seats, input?.assignments]) {
    if (!Array.isArray(collection)) continue;
    for (const seat of collection) {
      if (!["acp", "persistent"].includes(seat?.runtime)) continue;
      if (!seat.harness) continue;
      resolveSeatRuntime(seat);
      if (!config.commands?.[seat.harness]) {
        throw new Error(`Persistent runtime preflight failed: command is not configured for harness ${seat.harness}`);
      }
    }
  }
  return input;
}

export function normalizeThreadId(value) {
  const threadId = String(value ?? "").trim();
  return THREAD_ID_RE.test(threadId) ? threadId : null;
}

function metadataThreadId(extra = {}) {
  const meta = extra?._meta ?? {};
  const headers = extra?.requestInfo?.headers;
  const candidates = [
    meta["codex/threadId"],
    meta["codex/thread_id"],
    meta["openai/threadId"],
    meta.codexThreadId,
    meta.codex?.threadId,
    meta.threadId,
    meta.thread_id,
    meta.conversationId,
    meta.conversation_id,
    headers?.get?.("x-codex-thread-id"),
    headers?.["x-codex-thread-id"],
    headers?.["X-Codex-Thread-Id"]
  ];
  return candidates.map(normalizeThreadId).find(Boolean) ?? null;
}

export function resolveOriginThreadBinding({ explicit, extra, env = process.env } = {}) {
  const explicitId = normalizeThreadId(explicit);
  if (explicitId) return { threadId: explicitId, source: "explicit" };
  const metadataId = metadataThreadId(extra);
  if (metadataId) return { threadId: metadataId, source: "mcp-request-meta" };
  const environmentId = normalizeThreadId(env?.CODEX_THREAD_ID);
  if (environmentId) return { threadId: environmentId, source: "environment" };
  return { threadId: null, source: null };
}

function initialNotification(originThreadId, policy = "best-effort", bindingSource = null) {
  const disabled = policy === "off";
  return {
    state: disabled ? "disabled" : originThreadId ? "pending" : "unavailable",
    handlingState: "pending",
    policy,
    originThreadId,
    bindingSource,
    attempts: 0,
    lastAttemptAt: null,
    acceptedAt: null,
    acknowledgedAt: null,
    lastError: disabled || originThreadId ? null : "No valid originating Codex thread ID was available at dispatch time."
  };
}

function initialSupervisor(now) {
  return {
    state: "queued",
    heartbeatAt: now,
    lastProgressAt: now,
    lastEvent: "queued",
    currentAction: "Waiting for worker start",
    activeSeat: null,
    activeSince: null,
    elapsedMs: 0,
    silenceMs: 0,
    estimatedRemainingMs: null,
    etaConfidence: "none",
    attention: null
  };
}

function estimatedRemaining(progress, elapsedMs) {
  const completed = Number(progress?.completed ?? 0);
  const total = Number(progress?.total ?? 0);
  if (completed <= 0 || total <= completed) return { value: total > 0 && completed >= total ? 0 : null, confidence: total > 0 && completed >= total ? "high" : "none" };
  return { value: Math.max(0, Math.round((elapsedMs / completed) * (total - completed))), confidence: completed >= 2 ? "medium" : "low" };
}

function actionForProgress(progress = {}) {
  const seat = progress.activeSeat ? ` (${progress.activeSeat})` : "";
  const actions = {
    running: "Preparing task graph",
    seat_started: `Running external model seat${seat}`,
    seat_activity: `Receiving live activity from external model${seat}`,
    seat_finished: "Reviewing completed seat output",
    layer_started: "Starting task-graph layer",
    layer_finished: "Persisting stage evidence",
    steering_applied: "Applying operator steering",
    pausing: "Stopping active seat at a safe boundary",
    cancelling: "Cancelling active seat",
    completed: "Completed",
    partial: "Completed with partial results",
    failed: "Failed",
    cancelled: "Cancelled",
    paused: "Paused"
  };
  return actions[progress.phase] ?? String(progress.phase ?? "running").replaceAll("_", " ");
}

export function supervisorView(job, nowMs = Date.now()) {
  const supervisor = job?.supervisor ?? initialSupervisor(job?.createdAt ?? new Date(nowMs).toISOString());
  const heartbeatMs = Date.parse(supervisor.heartbeatAt ?? job?.updatedAt ?? job?.createdAt ?? 0);
  const lastProgressMs = Date.parse(supervisor.lastProgressAt ?? job?.updatedAt ?? job?.createdAt ?? 0);
  const startedMs = Date.parse(job?.startedAt ?? job?.createdAt ?? 0);
  const elapsedMs = Math.max(0, nowMs - startedMs);
  const silenceMs = Math.max(0, nowMs - lastProgressMs);
  const heartbeatAgeMs = Math.max(0, nowMs - heartbeatMs);
  const active = ["queued", "running", "cancelling"].includes(job?.status);
  const heartbeatLost = active && heartbeatAgeMs > DEFAULT_HEARTBEAT_LOST_MS;
  const attention = heartbeatLost ? "worker-heartbeat-lost"
    : active && silenceMs > DEFAULT_SILENCE_WARNING_MS ? "seat-silent"
      : supervisor.attention ?? null;
  const eta = estimatedRemaining(job?.progress, elapsedMs);
  return {
    ...supervisor,
    state: heartbeatLost ? "lost" : attention === "seat-silent" ? "silent" : (TERMINAL.has(job?.status) ? job.status : supervisor.state),
    currentAction: actionForProgress(job?.progress),
    activeSeat: job?.progress?.activeSeat ?? supervisor.activeSeat ?? null,
    elapsedMs,
    silenceMs,
    heartbeatAgeMs,
    estimatedRemainingMs: eta.value,
    etaConfidence: eta.confidence,
    attention,
    nextHeartbeatExpectedAt: active ? new Date(heartbeatMs + DEFAULT_HEARTBEAT_MS * 2).toISOString() : null
  };
}

export function createJobRecord({ jobId = `job-${Date.now().toString(36)}-${randomUUID().slice(0, 8)}`, taskId, input, originThreadId = null, notificationPolicy = "best-effort", bindingSource = null }) {
  const now = new Date().toISOString();
  const normalizedThreadId = normalizeThreadId(originThreadId);
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
    supervisor: initialSupervisor(now),
    control: { revision: 0, messages: [] },
    notification: initialNotification(normalizedThreadId, notificationPolicy, bindingSource),
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
    supervisor: supervisorView(job),
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
    },
    notification: job.notification ?? initialNotification(null)
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

export async function startJob({ input, jobId, taskId, originThreadId, originThreadSource, notificationPolicy = input?.notificationPolicy ?? "required", requestExtra }) {
  assertJobInputSupported(input);
  const binding = resolveOriginThreadBinding({ explicit: originThreadId ?? input?.originThreadId, extra: requestExtra });
  const resolvedThreadId = binding.threadId;
  const resolvedSource = originThreadSource ?? binding.source;
  if (notificationPolicy === "required" && !resolvedThreadId) {
    throw new Error("Background job refused: no originating Codex thread ID is available. Pass originThreadId from the current CODEX_THREAD_ID, or explicitly set notificationPolicy=best-effort/off.");
  }
  const record = createJobRecord({ jobId, taskId, input, originThreadId: resolvedThreadId, notificationPolicy, bindingSource: resolvedSource });
  await writeJob(record);
  await atomicWrite(jobInputPath(record.jobId), publicInput(input));
  return spawnJobWorker(record);
}

export function completionNotificationMessage(job) {
  const navigator = job?.resultSummary?.navigator ? ` Navigator verdict: ${job.resultSummary.navigator}.` : "";
  return [
    `Codex MOA background job ${job.jobId} is now ${job.status}.${navigator}`,
    `Call moa_job_status for ${job.jobId}, inspect its artifacts and stage evidence, then continue captain-side verification, conflict resolution, and integration without rerunning completed seats.`,
    `After the completion has been handled, call moa_job_ack for ${job.jobId}.`
  ].join(" ");
}

async function codexQueueNotification({ threadId, message }) {
  const codexBin = process.env.CODEX_MOA_CODEX_BIN || "codex";
  const { stdout = "", stderr = "" } = await execFileAsync(codexBin, ["queue", "--thread", threadId, "--message", message], {
    timeout: 20_000,
    maxBuffer: 256 * 1024,
    env: buildJobWorkerEnv(process.env)
  });
  return { stdout: stdout.trim(), stderr: stderr.trim() };
}

export async function notifyJobCompletion(jobId, { deliver = codexQueueNotification, force = false, retries = 3 } = {}) {
  let job = await readJob(jobId);
  if (!job) throw new Error(`Job not found: ${jobId}`);
  if (!TERMINAL.has(job.status)) throw new Error(`Job ${jobId} is ${job.status}; completion notification is only valid for terminal jobs.`);
  const notification = job.notification ?? initialNotification(null);
  if (notification.state === "disabled") return publicJob(job);
  if (!notification.originThreadId) return publicJob(job);
  if (!force && (notification.state === "delivered" || notification.handlingState === "acknowledged" || notification.state === "acknowledged")) return publicJob(job);

  const attempts = Math.max(1, Math.min(3, Number(retries) || 1));
  let lastError = null;
  for (let index = 0; index < attempts; index += 1) {
    const attemptAt = new Date().toISOString();
    job = await updateJob(jobId, (current) => ({
      ...current,
      notification: {
        ...(current.notification ?? initialNotification(notification.originThreadId)),
        state: "sending",
        attempts: Number(current.notification?.attempts ?? 0) + 1,
        lastAttemptAt: attemptAt,
        lastError: null
      }
    }));
    try {
      await deliver({
        threadId: notification.originThreadId,
        message: completionNotificationMessage(job),
        job: publicJob(job)
      });
      const delivered = await updateJob(jobId, (current) => ({
        ...current,
        notification: {
          ...current.notification,
          state: "delivered",
          acceptedAt: new Date().toISOString(),
          lastError: null
        }
      }));
      return publicJob(delivered);
    } catch (error) {
      lastError = String(error?.message ?? error).slice(0, 1000);
      await updateJob(jobId, (current) => ({
        ...current,
        notification: { ...current.notification, state: "failed", lastError }
      }));
      if (index + 1 < attempts) await new Promise((resolveDelay) => setTimeout(resolveDelay, 250 * (index + 1)));
    }
  }
  return publicJob(await readJob(jobId));
}

export async function acknowledgeJobNotification(jobId) {
  const job = await readJob(jobId);
  if (!job) throw new Error(`Job not found: ${jobId}`);
  const updated = await updateJob(jobId, (current) => ({
    ...current,
    notification: {
      ...(current.notification ?? initialNotification(null)),
      handlingState: "acknowledged",
      acknowledgedAt: new Date().toISOString()
    }
  }));
  return publicJob(updated);
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
  const startedAt = new Date().toISOString();
  await updateJob(jobId, {
    status: "running",
    startedAt,
    progress: { phase: "running", completed: 0, total: 0, activeSeat: null },
    supervisor: { ...initialSupervisor(startedAt), state: "running", lastEvent: "worker_started", currentAction: "Preparing task graph" }
  });

  const heartbeatMs = Math.max(1_000, Number(deps.heartbeatMs ?? DEFAULT_HEARTBEAT_MS));
  let heartbeatBusy = false;
  const heartbeat = setInterval(async () => {
    if (heartbeatBusy) return;
    heartbeatBusy = true;
    try {
      await updateJob(jobId, (current) => ({
        ...current,
        supervisor: {
          ...(current.supervisor ?? initialSupervisor(startedAt)),
          heartbeatAt: new Date().toISOString(),
          state: ["cancelling", "pausing"].includes(current.progress?.phase) ? current.progress.phase : "running"
        }
      }));
    } catch {
      // A read-only heartbeat must never terminate the model run.
    } finally {
      heartbeatBusy = false;
    }
  }, heartbeatMs);
  heartbeat.unref?.();

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
          layer: event.layer ?? current.progress?.layer ?? null,
          activityStream: event.activityStream ?? current.progress?.activityStream ?? null,
          activityEvent: event.activityEvent ?? current.progress?.activityEvent ?? null,
          observedOutputBytes: event.observedOutputBytes ?? current.progress?.observedOutputBytes ?? 0
        };
        const now = new Date().toISOString();
        await updateJob(jobId, (latest) => ({
          ...latest,
          progress,
          supervisor: {
            ...(latest.supervisor ?? initialSupervisor(startedAt)),
            state: "running",
            heartbeatAt: now,
            lastProgressAt: now,
            lastEvent: event.type,
            currentAction: actionForProgress(progress),
            activeSeat: progress.activeSeat,
            activeSince: progress.activeSeat && progress.activeSeat !== latest.supervisor?.activeSeat ? now : latest.supervisor?.activeSince ?? null,
            attention: null
          }
        }));
      }
    });
    const afterRun = await readJob(jobId);
    const cancelled = afterRun?.cancelRequested === true;
    const paused = afterRun?.pauseRequested === true;
    const allDone = result.results.length > 0 && result.results.every((item) => item.status === "done");
    const status = paused ? "paused" : allDone || result.results.length === 0 ? "completed" : cancelled ? "cancelled" : "partial";
    const latest = await readJob(jobId);
    await updateJob(jobId, {
      status,
      finishedAt: new Date().toISOString(),
      progress: { ...(latest?.progress ?? job.progress ?? {}), phase: status, activeSeat: null },
      supervisor: {
        ...(latest?.supervisor ?? initialSupervisor(startedAt)),
        state: status,
        heartbeatAt: new Date().toISOString(),
        lastProgressAt: new Date().toISOString(),
        lastEvent: status,
        currentAction: actionForProgress({ phase: status }),
        activeSeat: null,
        attention: null
      },
      resultSummary: {
        taskId: result.taskId,
        level: result.level,
        seats: result.results.map((item) => ({ seat: item.seat, status: item.status })),
        navigator: result.navigator?.verdict ?? null,
        checkpoint: result.checkpoint,
        artifacts: result.artifacts
      }
    });
    return notifyJobCompletion(jobId, { deliver: deps.notifyCompletion });
  } catch (error) {
    const interrupted = await readJob(jobId);
    const interruptedStatus = interrupted?.pauseRequested ? "paused" : interrupted?.cancelRequested ? "cancelled" : "failed";
    await updateJob(jobId, {
      status: interruptedStatus,
      finishedAt: new Date().toISOString(),
      progress: { phase: interruptedStatus, activeSeat: null },
      supervisor: {
        ...(interrupted?.supervisor ?? initialSupervisor(startedAt)),
        state: interruptedStatus,
        heartbeatAt: new Date().toISOString(),
        lastProgressAt: new Date().toISOString(),
        lastEvent: interruptedStatus,
        currentAction: actionForProgress({ phase: interruptedStatus }),
        activeSeat: null,
        attention: interruptedStatus === "failed" ? "worker-failed" : null
      },
      error: interruptedStatus === "failed" ? (error?.stack ?? String(error)) : null
    });
    return notifyJobCompletion(jobId, { deliver: deps.notifyCompletion });
  } finally {
    clearInterval(heartbeat);
  }
}

export async function jobIsTerminal(jobId) {
  const job = await readJob(jobId);
  return Boolean(job && TERMINAL.has(job.status));
}
