import { existsSync } from "node:fs";
import { appendFile, chmod, mkdir, readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, resolve } from "node:path";

function expandHome(value) {
  if (typeof value !== "string") return value;
  if (value === "~") return homedir();
  if (value.startsWith("~/")) return resolve(homedir(), value.slice(2));
  return resolve(value);
}

export function patchMetricsPath() {
  return expandHome(process.env.CODEX_MOA_PATCH_METRICS || "~/.codex-moa/patch-metrics.jsonl");
}

export async function recordPatchEvent(event, path = patchMetricsPath()) {
  const entry = {
    time: new Date().toISOString(),
    action: event.action,
    ok: event.ok === true,
    taskId: event.taskId ?? null,
    seat: event.seat ?? null,
    model: event.model ?? null,
    path: event.path ?? null,
    durationMs: Number.isFinite(Number(event.durationMs)) ? Number(event.durationMs) : null,
    error: event.error ? String(event.error).slice(0, 2000) : null
  };
  await mkdir(dirname(path), { recursive: true });
  await appendFile(path, `${JSON.stringify(entry)}\n`, { encoding: "utf8", mode: 0o600 });
  await chmod(path, 0o600).catch(() => {});
  return entry;
}

export async function readPatchMetrics(path = patchMetricsPath(), limit = 10000) {
  if (!existsSync(path)) return [];
  try {
    return (await readFile(path, "utf8")).split(/\r?\n/).filter(Boolean).slice(-limit).map((line) => JSON.parse(line));
  } catch {
    return [];
  }
}

function rate(numerator, denominator) {
  return denominator > 0 ? numerator / denominator : null;
}

export function summarizePatchMetrics(entries = []) {
  const actions = {};
  const bySeat = {};
  const byModel = {};
  let conflicts = 0;
  for (const entry of entries) {
    const action = entry.action ?? "unknown";
    actions[action] ??= { attempts: 0, successes: 0, failures: 0 };
    actions[action].attempts += 1;
    if (entry.ok) actions[action].successes += 1;
    else actions[action].failures += 1;
    const isConflict = /conflict|3way|patch does not apply|rejected/i.test(entry.error ?? "");
    if (isConflict) conflicts += 1;
    if (entry.seat) {
      bySeat[entry.seat] ??= { attempts: 0, successes: 0, failures: 0 };
      bySeat[entry.seat].attempts += 1;
      bySeat[entry.seat][entry.ok ? "successes" : "failures"] += 1;
    }
    if (entry.model) {
      byModel[entry.model] ??= { attempts: 0, successes: 0, failures: 0 };
      byModel[entry.model].attempts += 1;
      byModel[entry.model][entry.ok ? "successes" : "failures"] += 1;
    }
  }
  const applies = actions.apply ?? { attempts: 0, successes: 0, failures: 0 };
  const reverts = actions.revert ?? { attempts: 0, successes: 0, failures: 0 };
  return {
    entries: entries.length,
    actions,
    conflicts,
    conflictRate: rate(conflicts, entries.length),
    applyAttempts: applies.attempts,
    applySuccesses: applies.successes,
    applyFailures: applies.failures,
    acceptanceRate: rate(applies.successes, applies.attempts),
    applyFailureRate: rate(applies.failures, applies.attempts),
    revertAttempts: reverts.attempts,
    revertSuccesses: reverts.successes,
    revertRate: rate(reverts.successes, applies.successes),
    bySeat,
    byModel
  };
}
