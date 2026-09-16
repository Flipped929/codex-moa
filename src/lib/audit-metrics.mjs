import { existsSync } from "node:fs";
import { appendFile, chmod, mkdir, readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, resolve } from "node:path";

function expandHome(value) {
  if (value === "~") return homedir();
  if (typeof value === "string" && value.startsWith("~/")) return resolve(homedir(), value.slice(2));
  return resolve(value);
}

export function auditMetricsPath() {
  return expandHome(process.env.CODEX_MOA_AUDIT_METRICS || "~/.codex-moa/audit-metrics.jsonl");
}

async function append(entry, path = auditMetricsPath()) {
  await mkdir(dirname(path), { recursive: true });
  await appendFile(path, `${JSON.stringify({ time: new Date().toISOString(), ...entry })}\n`, { encoding: "utf8", mode: 0o600 });
  await chmod(path, 0o600).catch(() => {});
  return entry;
}

export function outputTps(result) {
  const durationMs = Number(result?.durationMs);
  const outputTokens = Number(result?.usage?.outputTokens);
  return durationMs > 0 && Number.isFinite(outputTokens) ? outputTokens / (durationMs / 1000) : null;
}

export async function recordAuditRun(event, path = auditMetricsPath()) {
  return append({ type: "audit_run", ...event }, path);
}

export async function recordAuditAdjudication(event, path = auditMetricsPath()) {
  return append({
    type: "audit_adjudication",
    taskId: event.taskId,
    auditorSeat: event.auditorSeat,
    acceptedFindings: Number(event.acceptedFindings ?? 0),
    falsePositives: Number(event.falsePositives ?? 0),
    taskAccepted: event.taskAccepted ?? null,
    testsPassed: event.testsPassed ?? null,
    notes: event.notes ?? null
  }, path);
}

export async function readAuditMetrics(path = auditMetricsPath(), limit = 10000) {
  if (!existsSync(path)) return [];
  try { return (await readFile(path, "utf8")).split(/\r?\n/).filter(Boolean).slice(-limit).map(JSON.parse); } catch { return []; }
}

function rate(value, total) {
  return total > 0 ? value / total : null;
}

export function summarizeAuditMetrics(entries = []) {
  const adjudications = new Map(entries.filter((entry) => entry.type === "audit_adjudication")
    .map((entry) => [`${entry.taskId}:${entry.auditorSeat}`, entry]));
  const routes = {};
  const pairs = {};
  for (const entry of entries.filter((item) => item.type === "audit_run")) {
    const routeKey = `${entry.auditorModel}@${entry.auditorHarness}@${entry.auditMode}`;
    const pairKey = `${entry.executorModel}@${entry.executorHarness}->${routeKey}`;
    for (const [key, target] of [[routeKey, routes], [pairKey, pairs]]) {
      target[key] ??= { runs: 0, completed: 0, failed: 0, timedOut: 0, passes: 0, warns: 0, blocks: 0, durationMs: 0, outputTokens: 0, estimatedUsd: 0, pricedRuns: 0, acceptedFindings: 0, falsePositives: 0, adjudicatedRuns: 0 };
      const state = target[key];
      state.runs += 1;
      state.completed += entry.status === "done" ? 1 : 0;
      state.failed += entry.status === "done" ? 0 : 1;
      state.timedOut += entry.timedOut ? 1 : 0;
      if (entry.verdict === "pass") state.passes += 1;
      if (entry.verdict === "warn") state.warns += 1;
      if (entry.verdict === "block") state.blocks += 1;
      state.durationMs += Number(entry.durationMs) || 0;
      state.outputTokens += Number(entry.outputTokens) || 0;
      if (Number.isFinite(Number(entry.estimatedUsd))) { state.estimatedUsd += Number(entry.estimatedUsd); state.pricedRuns += 1; }
      const adjudication = adjudications.get(`${entry.taskId}:${entry.auditorSeat}`);
      if (adjudication) {
        state.adjudicatedRuns += 1;
        state.acceptedFindings += Number(adjudication.acceptedFindings) || 0;
        state.falsePositives += Number(adjudication.falsePositives) || 0;
      }
    }
  }
  for (const collection of [routes, pairs]) {
    for (const state of Object.values(collection)) {
      state.completionRate = rate(state.completed, state.runs);
      state.timeoutRate = rate(state.timedOut, state.runs);
      state.outputTps = state.durationMs > 0 ? state.outputTokens / (state.durationMs / 1000) : null;
      state.usefulFindingRate = rate(state.acceptedFindings, state.acceptedFindings + state.falsePositives);
      state.costPerAcceptedFinding = state.acceptedFindings > 0 && state.pricedRuns > 0 ? state.estimatedUsd / state.acceptedFindings : null;
      state.sampleSufficient = state.runs >= 5;
    }
  }
  return {
    entries: entries.length,
    auditRuns: entries.filter((entry) => entry.type === "audit_run").length,
    adjudications: entries.filter((entry) => entry.type === "audit_adjudication").length,
    routes,
    pairs,
    evidencePolicy: { minimumRuns: 5, note: "Harness and pairing changes require completion, latency, and adjudicated finding evidence; TPS alone is insufficient." }
  };
}
