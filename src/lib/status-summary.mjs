import { existsSync } from "node:fs";
import { readFile, readdir, stat } from "node:fs/promises";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { loadConfig } from "./config.mjs";
import { readSeatRegistry, listSeats } from "./seat-registry.mjs";
import { listMemories } from "./memory.mjs";
import { readCostLedger, summarizeCostLedger } from "./cost-ledger.mjs";
import { summarizeProviderHealth } from "./provider-health.mjs";
import { readProviderState } from "./provider-state.mjs";
import { readQuotaSnapshot } from "./quota.mjs";
import { summarizeCheckpoint } from "./task-checkpoint.mjs";
import { listJobs } from "./jobs.mjs";
import { readPatchMetrics, summarizePatchMetrics } from "./patch-metrics.mjs";
import { captainAllocation, readCaptainUsage } from "./captain-usage.mjs";
import { resolveCaptain } from "./captain.mjs";
import { readAuditMetrics, summarizeAuditMetrics } from "./audit-metrics.mjs";
import { readFailureMemory, summarizeFailureMemory } from "./failure-memory.mjs";

function expandHome(value) {
  if (typeof value !== "string") return value;
  if (value === "~") return homedir();
  if (value.startsWith("~/")) return resolve(homedir(), value.slice(2));
  return resolve(value);
}

function blackboardRoot(config = loadConfig()) {
  return expandHome(config.blackboardDir ?? "~/.codex-moa/blackboard");
}

async function readJson(path) {
  try {
    return JSON.parse(await readFile(path, "utf8"));
  } catch {
    return null;
  }
}

export async function latestBlackboardState(config = loadConfig()) {
  const root = blackboardRoot(config);
  if (!existsSync(root)) return { root, navigator: null, checkpoints: [] };
  let entries = [];
  try {
    entries = await readdir(root, { withFileTypes: true });
  } catch {
    return { root, navigator: null, checkpoints: [] };
  }
  const tasks = [];
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const path = join(root, entry.name);
    try {
      const info = await stat(path);
      tasks.push({ path, taskId: entry.name, mtimeMs: info.mtimeMs });
    } catch {}
  }
  tasks.sort((a, b) => b.mtimeMs - a.mtimeMs);
  const checkpoints = [];
  let navigator = null;
  for (const task of tasks.slice(0, 30)) {
    const checkpoint = await readJson(join(task.path, "checkpoint.json"));
    if (checkpoint) checkpoints.push({ ...summarizeCheckpoint(checkpoint), path: join(task.path, "checkpoint.json") });
    if (!navigator) {
      const review = await readJson(join(task.path, "navigator.json"));
      if (review) navigator = { taskId: task.taskId, ...review };
    }
  }
  return { root, navigator, checkpoints };
}

function navigatorLevel(verdict) {
  if (verdict === "block") return "critical";
  if (verdict === "warn" || verdict === "unreviewed") return "warning";
  return "healthy";
}

export async function buildStatusSummary({ config = loadConfig(), recentHours = 24 } = {}) {
  const registry = readSeatRegistry();
  const seats = listSeats(registry);
  const memories = await listMemories();
  const ledger = await readCostLedger();
  const cost = summarizeCostLedger(ledger, { since: new Date(Date.now() - recentHours * 3600000).toISOString() });
  const quota = await readQuotaSnapshot(config);
  const circuitState = await readProviderState();
  const health = summarizeProviderHealth({ snapshot: quota, ledger, lowThreshold: config.routingLowThreshold ?? 10, circuitState, config });
  const blackboard = await latestBlackboardState(config);
  const jobs = await listJobs(50);
  const patchMetrics = summarizePatchMetrics(await readPatchMetrics());
  const captain = await resolveCaptain();
  const captainUsage = await readCaptainUsage();
  const auditMetrics = summarizeAuditMetrics(await readAuditMetrics());
  const failureMemory = summarizeFailureMemory(await readFailureMemory(), { config });
  const activeFailureGuards = Object.values(failureMemory.routes).filter((route) => route.activeGuard).length;
  const activeJobs = jobs.filter((job) => ["queued", "running", "cancelling"].includes(job.status));
  const activeSeats = seats.filter((seat) => seat.status === "running");
  const completedSeats = seats.filter((seat) => seat.status === "done");
  const failedSeats = seats.filter((seat) => !["running", "done"].includes(seat.status));
  const worktrees = [...new Set(seats.map((seat) => seat.worktree).filter(Boolean))];
  const navigator = blackboard.navigator;
  const statusLevel = (() => {
    if (health.overall === "critical" || navigator?.verdict === "block") return "critical";
    if (health.overall === "warning" || navigator?.verdict === "warn" || navigator?.verdict === "unreviewed" || activeFailureGuards > 0) return "warning";
    return "healthy";
  })();
  const providerCounts = Object.values(health.providers).reduce((counts, provider) => {
    counts[provider.status] = (counts[provider.status] ?? 0) + 1;
    return counts;
  }, {});
  return {
    updatedAt: new Date().toISOString(),
    status: statusLevel,
    jobs: {
      total: jobs.length,
      active: activeJobs.length,
      recent: jobs.slice(0, 10)
    },
    seats: {
      total: seats.length,
      active: activeSeats.length,
      completed: completedSeats.length,
      failed: failedSeats.length,
      activeEntries: activeSeats
    },
    worktrees: {
      count: worktrees.length,
      paths: worktrees
    },
    memory: {
      count: memories.length,
      recent: memories.slice(0, 5)
    },
    navigator: navigator ? {
      taskId: navigator.taskId,
      verdict: navigator.verdict,
      level: navigator.level,
      findings: navigator.findings?.length ?? 0,
      checks: navigator.checks
    } : null,
    checkpoints: blackboard.checkpoints,
    patchMetrics,
    captainUsage,
    captainAllocation: captainAllocation(captain, captainUsage),
    auditMetrics,
    failureMemory: { ...failureMemory, activeGuards: activeFailureGuards },
    providerHealth: health,
    providerCounts,
    cost,
    artifacts: { blackboardRoot: blackboard.root }
  };
}

export function toClaudeBarMetrics(summary) {
  const providerHealthy = summary.providerCounts.healthy ?? 0;
  const providerTotal = Object.keys(summary.providerHealth.providers).length;
  const successRate = summary.seats.total ? summary.seats.completed / summary.seats.total : null;
  return {
    metrics: [
      {
        label: "Active Seats",
        value: String(summary.seats.active),
        unit: `${summary.seats.total} tracked`,
        icon: "person.3.fill",
        color: summary.seats.active > 0 ? "#22C55E" : "#9CA3AF",
        progress: summary.seats.total ? summary.seats.active / summary.seats.total : 0
      },
      {
        label: "Success Rate",
        value: successRate === null ? "n/a" : `${(successRate * 100).toFixed(0)}%`,
        unit: `${summary.seats.completed} done`,
        icon: "checkmark.circle.fill",
        color: successRate !== null && successRate >= 0.8 ? "#22C55E" : "#F59E0B",
        progress: successRate ?? 0
      },
      {
        label: "Patch Accept",
        value: summary.patchMetrics?.acceptanceRate === null ? "n/a" : `${((summary.patchMetrics?.acceptanceRate ?? 0) * 100).toFixed(0)}%`,
        unit: `${summary.patchMetrics?.applyAttempts ?? 0} applies`,
        icon: "checkmark.seal.fill",
        color: (summary.patchMetrics?.acceptanceRate ?? 0) >= 0.8 ? "#22C55E" : "#F59E0B",
        progress: summary.patchMetrics?.acceptanceRate ?? 0
      },
      {
        label: "Active Jobs",
        value: String(summary.jobs?.active ?? 0),
        unit: `${summary.jobs?.total ?? 0} tracked`,
        icon: "clock.arrow.circlepath",
        color: summary.jobs?.active ? "#0EA5E9" : "#9CA3AF"
      },
      {
        label: "Worktrees",
        value: String(summary.worktrees.count),
        unit: "isolated",
        icon: "arrow.triangle.branch",
        color: "#0EA5E9"
      },
      {
        label: "Memory Capsules",
        value: String(summary.memory.count),
        unit: "durable",
        icon: "brain.head.profile",
        color: "#8B5CF6"
      },
      {
        label: "Providers",
        value: `${providerHealthy}/${providerTotal}`,
        unit: "healthy",
        icon: "network",
        color: providerHealthy === providerTotal ? "#22C55E" : "#F59E0B",
        progress: providerTotal ? providerHealthy / providerTotal : 0
      }
    ]
  };
}

export function toClaudeBarStatus(summary) {
  const navigatorText = summary.navigator ? `Navigator ${summary.navigator.verdict}` : "Navigator idle";
  const providerText = Object.entries(summary.providerHealth.providers)
    .map(([name, provider]) => `${name}:${provider.status}`)
    .join(" · ");
  return {
    status: {
      text: `${navigatorText} · ${providerText}`,
      level: summary.status
    }
  };
}

export function toClaudeBarCost(summary) {
  const configuredBudget = Number(process.env.CLAUDEBAR_COST_BUDGET || 100);
  return {
    costUsage: {
      totalCost: summary.cost.estimatedUsd ?? 0,
      budget: Number.isFinite(configuredBudget) && configuredBudget > 0 ? configuredBudget : 100,
      apiDuration: Math.round((summary.cost.totalDurationMs ?? 0) / 1000),
      wallDuration: 0,
      linesAdded: 0,
      linesRemoved: 0
    }
  };
}
