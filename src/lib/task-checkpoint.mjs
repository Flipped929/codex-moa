import { existsSync } from "node:fs";
import { chmod, mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { join } from "node:path";

export const CHECKPOINT_VERSION = 1;
export const TERMINAL_NODE_STATUSES = new Set(["done", "failed", "error", "cancelled", "blocked"]);

export function checkpointPath(root) {
  return join(root, "checkpoint.json");
}

export function createCheckpoint({ taskId, input, plan }) {
  const now = new Date().toISOString();
  return {
    version: CHECKPOINT_VERSION,
    taskId,
    goal: input.task,
    cwd: input.cwd,
    createdAt: now,
    updatedAt: now,
    status: "running",
    resumedCount: 0,
    input: {
      mode: input.mode ?? "implement",
      stakes: input.stakes ?? "medium",
      continuityKey: input.continuityKey ?? null,
      memoryKey: input.memoryKey ?? null,
      allowWrite: input.allowWrite === true
    },
    plan: {
      level: plan.level,
      seats: plan.seats.map((seat) => ({
        seat: seat.seat,
        role: seat.role,
        harness: seat.harness,
        model: seat.model,
        runtime: seat.runtime ?? "cli",
        mode: seat.mode,
        reasoningEffort: seat.reasoningEffort,
        contextBudget: seat.contextBudget,
        outputBudget: seat.outputBudget
      })),
      graph: plan.graph,
      budget: plan.budget,
      rationale: plan.rationale,
      routingExperiment: plan.routingExperiment ?? null
    },
    nodes: {}
  };
}

export function nodeForSeat(checkpoint, seatId) {
  return checkpoint?.nodes?.[seatId] ?? null;
}

export function updateCheckpointNode(checkpoint, seatId, patch) {
  checkpoint.nodes ??= {};
  checkpoint.nodes[seatId] = {
    ...(checkpoint.nodes[seatId] ?? { seat: seatId, attempts: 0 }),
    ...patch,
    attempts: patch.attempts ?? ((checkpoint.nodes[seatId]?.attempts ?? 0) + (patch.status === "running" ? 1 : 0)),
    updatedAt: new Date().toISOString()
  };
  checkpoint.updatedAt = new Date().toISOString();
  return checkpoint.nodes[seatId];
}

export function completedSeatIds(checkpoint) {
  return new Set(Object.entries(checkpoint?.nodes ?? {})
    .filter(([, node]) => node.status === "done")
    .map(([seatId]) => seatId));
}

export function checkpointResultMap(checkpoint) {
  const results = new Map();
  for (const [seatId, node] of Object.entries(checkpoint?.nodes ?? {})) {
    if (node.result) results.set(seatId, node.result);
  }
  return results;
}

export function mergeCheckpointIntoSeats(seats, checkpoint) {
  if (!checkpoint) return seats;
  return seats.map((seat) => {
    const node = checkpoint.nodes?.[seat.seat];
    if (!node) return seat;
    return {
      ...seat,
      worktree: seat.worktree ?? (node.worktreePath ? { path: node.worktreePath } : null),
      originalCwd: node.originalCwd ?? seat.originalCwd ?? null,
      cwd: node.worktreePath ?? seat.cwd,
      checkpointAttempts: node.attempts ?? 0,
      checkpointStatus: node.status ?? null
    };
  });
}

export async function readCheckpoint(root) {
  const path = checkpointPath(root);
  if (!existsSync(path)) return null;
  try {
    const checkpoint = JSON.parse(await readFile(path, "utf8"));
    if (checkpoint?.version !== CHECKPOINT_VERSION || !checkpoint.nodes) return null;
    return checkpoint;
  } catch {
    return null;
  }
}

export async function writeCheckpoint(root, checkpoint) {
  checkpoint.updatedAt = new Date().toISOString();
  const path = checkpointPath(root);
  const temporary = `${path}.${randomUUID()}.tmp`;
  await mkdir(root, { recursive: true });
  await writeFile(temporary, `${JSON.stringify(checkpoint, null, 2)}\n`, { mode: 0o600 });
  await rename(temporary, path);
  await chmod(path, 0o600);
  return path;
}

export function summarizeCheckpoint(checkpoint) {
  if (!checkpoint) return null;
  const counts = {};
  for (const node of Object.values(checkpoint.nodes ?? {})) {
    counts[node.status ?? "pending"] = (counts[node.status ?? "pending"] ?? 0) + 1;
  }
  return {
    taskId: checkpoint.taskId,
    status: checkpoint.status,
    updatedAt: checkpoint.updatedAt,
    counts,
    resumedCount: checkpoint.resumedCount ?? 0
  };
}
