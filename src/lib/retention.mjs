import { existsSync } from "node:fs";
import { chmod, mkdir, readdir, readFile, rename, rm, stat, writeFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { homedir } from "node:os";
import { basename, dirname, join, resolve, sep } from "node:path";
import { readSeatRegistry, listSeats } from "./seat-registry.mjs";
import { listJobs, jobsRoot } from "./jobs.mjs";
import { costLedgerPath } from "./cost-ledger.mjs";
import { routingExperimentStatePath } from "./routing-experiment.mjs";
import { auditMetricsPath } from "./audit-metrics.mjs";
import { failureMemoryPath } from "./failure-memory.mjs";
import { inspectWorktree, removeWorktree } from "./worktree.mjs";

function expandHome(value) {
  if (typeof value !== "string") return value;
  if (value === "~") return homedir();
  if (value.startsWith("~/")) return resolve(homedir(), value.slice(2));
  return resolve(value);
}

function within(parent, child) {
  const base = `${resolve(parent)}${sep}`;
  return resolve(child).startsWith(base);
}

async function readJson(path) {
  try { return JSON.parse(await readFile(path, "utf8")); } catch { return null; }
}

async function listDirectories(root) {
  if (!existsSync(root)) return [];
  const entries = await readdir(root, { withFileTypes: true });
  const result = [];
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const path = join(root, entry.name);
    const info = await stat(path).catch(() => null);
    if (info) result.push({ name: entry.name, path, mtimeMs: info.mtimeMs });
  }
  return result.sort((a, b) => b.mtimeMs - a.mtimeMs);
}

async function readJsonl(path) {
  if (!existsSync(path)) return [];
  try {
    return (await readFile(path, "utf8")).split(/\r?\n/).filter(Boolean).map((line) => JSON.parse(line));
  } catch {
    return [];
  }
}

async function writeJsonlAtomic(path, entries) {
  await mkdir(dirname(path), { recursive: true });
  const temporary = `${path}.${randomUUID()}.tmp`;
  await writeFile(temporary, entries.map((entry) => JSON.stringify(entry)).join("\n") + (entries.length ? "\n" : ""), { mode: 0o600 });
  await rename(temporary, path);
  await chmod(path, 0o600).catch(() => {});
}

export function retentionPolicy(config = {}) {
  const source = config.retention ?? {};
  const day = 24 * 60 * 60 * 1000;
  return {
    enabled: source.enabled ?? true,
    blackboard: {
      maxAgeMs: Number(source.blackboard?.maxAgeDays ?? 14) * day,
      maxTasks: Number(source.blackboard?.maxTasks ?? 500)
    },
    jobs: {
      maxAgeMs: Number(source.jobs?.maxAgeDays ?? 7) * day,
      maxJobs: Number(source.jobs?.maxJobs ?? 200)
    },
    worktrees: {
      maxAgeMs: Number(source.worktrees?.maxAgeDays ?? 7) * day,
      onlyClean: source.worktrees?.onlyClean !== false
    },
    costLedger: {
      maxAgeMs: Number(source.costLedger?.maxAgeDays ?? 180) * day,
      maxEntries: Number(source.costLedger?.maxEntries ?? 50000)
    },
    auditMetrics: {
      maxAgeMs: Number(source.auditMetrics?.maxAgeDays ?? 365) * day,
      maxEntries: Number(source.auditMetrics?.maxEntries ?? 100000)
    },
    failureMemory: {
      maxAgeMs: Number(source.failureMemory?.maxAgeDays ?? 365) * day,
      maxEntries: Number(source.failureMemory?.maxEntries ?? 100000)
    },
    routingHistory: {
      maxEntriesPerExperiment: Number(source.routingHistory?.maxEntriesPerExperiment ?? 200)
    }
  };
}

export async function planRetention({ config = {}, now = Date.now() } = {}) {
  const policy = retentionPolicy(config);
  if (!policy.enabled) return { enabled: false, blackboard: [], jobs: [], worktrees: [], costLedger: null, auditMetrics: null, failureMemory: null, routingHistory: [] };
  const activeTaskIds = new Set(listSeats(readSeatRegistry()).filter((seat) => seat.status === "running").map((seat) => seat.taskId));
  for (const job of await listJobs(1000)) {
    if (["queued", "running", "cancelling"].includes(job.status)) activeTaskIds.add(job.taskId);
  }

  const blackboardRoot = expandHome(config.blackboardDir ?? "~/.codex-moa/blackboard");
  const blackboardDirs = await listDirectories(blackboardRoot);
  const blackboard = [];
  for (let index = 0; index < blackboardDirs.length; index += 1) {
    const task = blackboardDirs[index];
    if (activeTaskIds.has(task.name)) continue;
    const checkpoint = await readJson(join(task.path, "checkpoint.json"));
    const terminal = !checkpoint || ["completed", "partial", "cancelled"].includes(checkpoint.status);
    const tooOld = now - task.mtimeMs > policy.blackboard.maxAgeMs;
    const overLimit = index >= policy.blackboard.maxTasks;
    if (terminal && (tooOld || overLimit)) {
      blackboard.push({ taskId: task.name, path: task.path, ageMs: now - task.mtimeMs, reason: tooOld ? "age" : "limit" });
    }
  }

  const jobs = [];
  const jobDirs = await listDirectories(jobsRoot());
  for (let index = 0; index < jobDirs.length; index += 1) {
    const jobDir = jobDirs[index];
    const job = await readJson(join(jobDir.path, "job.json"));
    if (!job || ["queued", "running", "cancelling"].includes(job.status)) continue;
    const tooOld = now - jobDir.mtimeMs > policy.jobs.maxAgeMs;
    const overLimit = index >= policy.jobs.maxJobs;
    if (tooOld || overLimit) jobs.push({ jobId: job.jobId, taskId: job.taskId, path: jobDir.path, ageMs: now - jobDir.mtimeMs, reason: tooOld ? "age" : "limit" });
  }

  const managedWorktreeRoot = expandHome("~/.codex-moa/worktrees");
  const worktrees = [];
  for (const seat of listSeats(readSeatRegistry())) {
    const path = seat.worktree;
    if (!path || !within(managedWorktreeRoot, path) || existsSync(path) === false) continue;
    const info = await stat(path).catch(() => null);
    if (!info || now - info.mtimeMs <= policy.worktrees.maxAgeMs) continue;
    const state = await inspectWorktree(path, { resultStatus: seat.status });
    if (policy.worktrees.onlyClean && !state.clean) continue;
    worktrees.push({ path, taskId: seat.taskId, seat: seat.seat, clean: state.clean, ageMs: now - info.mtimeMs });
  }

  const ledger = await readJsonl(costLedgerPath());
  const cutoff = now - policy.costLedger.maxAgeMs;
  const keepLedger = ledger.filter((entry, index) => Date.parse(entry.time) >= cutoff || index >= Math.max(0, ledger.length - policy.costLedger.maxEntries));
  const costLedger = keepLedger.length === ledger.length ? null : { path: costLedgerPath(), entries: ledger.length, keep: keepLedger.length, remove: ledger.length - keepLedger.length };

  const audits = await readJsonl(auditMetricsPath());
  const auditCutoff = now - policy.auditMetrics.maxAgeMs;
  const keepAudits = audits.filter((entry, index) => Date.parse(entry.time) >= auditCutoff || index >= Math.max(0, audits.length - policy.auditMetrics.maxEntries));
  const auditMetrics = keepAudits.length === audits.length ? null : { path: auditMetricsPath(), entries: audits.length, keep: keepAudits.length, remove: audits.length - keepAudits.length };

  const failures = await readJsonl(failureMemoryPath());
  const failureCutoff = now - policy.failureMemory.maxAgeMs;
  const keepFailures = failures.filter((entry, index) => Date.parse(entry.time) >= failureCutoff || index >= Math.max(0, failures.length - policy.failureMemory.maxEntries));
  const failureMemory = keepFailures.length === failures.length ? null : { path: failureMemoryPath(), entries: failures.length, keep: keepFailures.length, remove: failures.length - keepFailures.length };

  const routingPath = routingExperimentStatePath();
  const routingState = await readJson(routingPath);
  const routingHistory = [];
  for (const [id, experiment] of Object.entries(routingState?.experiments ?? {})) {
    const history = experiment.history ?? [];
    if (history.length > policy.routingHistory.maxEntriesPerExperiment) {
      routingHistory.push({ id, before: history.length, after: policy.routingHistory.maxEntriesPerExperiment, path: routingPath });
    }
  }

  return { enabled: true, policy, blackboard, jobs, worktrees, costLedger, auditMetrics, failureMemory, routingHistory };
}

export async function applyRetention({ config = {}, dryRun = true, now = Date.now() } = {}) {
  const plan = await planRetention({ config, now });
  if (dryRun || plan.enabled === false) return { dryRun, plan, applied: { blackboard: 0, jobs: 0, worktrees: 0, costLedger: 0, auditMetrics: 0, failureMemory: 0, routingHistory: 0 }, errors: [] };
  const applied = { blackboard: 0, jobs: 0, worktrees: 0, costLedger: 0, auditMetrics: 0, failureMemory: 0, routingHistory: 0 };
  const errors = [];
  for (const item of plan.blackboard) {
    try { await rm(item.path, { recursive: true, force: true }); applied.blackboard += 1; }
    catch (error) { errors.push({ path: item.path, error: error.message }); }
  }
  for (const item of plan.jobs) {
    try { await rm(item.path, { recursive: true, force: true }); applied.jobs += 1; }
    catch (error) { errors.push({ path: item.path, error: error.message }); }
  }
  for (const item of plan.worktrees) {
    try {
      const result = await removeWorktree(item.path, { force: !item.clean });
      if (result.removed) applied.worktrees += 1;
      else errors.push({ path: item.path, error: result.error });
    } catch (error) { errors.push({ path: item.path, error: error.message }); }
  }
  if (plan.costLedger) {
    try {
      const ledger = await readJsonl(plan.costLedger.path);
      const policy = retentionPolicy(config);
      const cutoff = now - policy.costLedger.maxAgeMs;
      const keep = ledger.filter((entry, index) => Date.parse(entry.time) >= cutoff || index >= Math.max(0, ledger.length - policy.costLedger.maxEntries));
      await writeJsonlAtomic(plan.costLedger.path, keep);
      applied.costLedger = ledger.length - keep.length;
    } catch (error) { errors.push({ path: plan.costLedger.path, error: error.message }); }
  }
  if (plan.auditMetrics) {
    try {
      const entries = await readJsonl(plan.auditMetrics.path);
      const policy = retentionPolicy(config);
      const cutoff = now - policy.auditMetrics.maxAgeMs;
      const keep = entries.filter((entry, index) => Date.parse(entry.time) >= cutoff || index >= Math.max(0, entries.length - policy.auditMetrics.maxEntries));
      await writeJsonlAtomic(plan.auditMetrics.path, keep);
      applied.auditMetrics = entries.length - keep.length;
    } catch (error) { errors.push({ path: plan.auditMetrics.path, error: error.message }); }
  }
  if (plan.failureMemory) {
    try {
      const entries = await readJsonl(plan.failureMemory.path);
      const policy = retentionPolicy(config);
      const cutoff = now - policy.failureMemory.maxAgeMs;
      const keep = entries.filter((entry, index) => Date.parse(entry.time) >= cutoff || index >= Math.max(0, entries.length - policy.failureMemory.maxEntries));
      await writeJsonlAtomic(plan.failureMemory.path, keep);
      applied.failureMemory = entries.length - keep.length;
    } catch (error) { errors.push({ path: plan.failureMemory.path, error: error.message }); }
  }
  if (plan.routingHistory.length > 0) {
    try {
      const path = plan.routingHistory[0].path;
      const state = await readJson(path);
      if (state?.experiments) {
        for (const [id, experiment] of Object.entries(state.experiments)) {
          const max = retentionPolicy(config).routingHistory.maxEntriesPerExperiment;
          if (Array.isArray(experiment.history) && experiment.history.length > max) experiment.history = experiment.history.slice(-max);
        }
        await mkdir(dirname(path), { recursive: true });
        const temporary = `${path}.${randomUUID()}.tmp`;
        await writeFile(temporary, `${JSON.stringify(state, null, 2)}\n`, { mode: 0o600 });
        await rename(temporary, path);
        await chmod(path, 0o600).catch(() => {});
        applied.routingHistory = plan.routingHistory.reduce((sum, item) => sum + (item.before - item.after), 0);
      }
    } catch (error) { errors.push({ path: plan.routingHistory[0].path, error: error.message }); }
  }
  return { dryRun: false, plan, applied, errors };
}
