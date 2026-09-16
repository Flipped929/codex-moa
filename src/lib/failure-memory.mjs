import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { appendFile, chmod, mkdir, readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, resolve } from "node:path";
import { classifyProviderError } from "./provider-state.mjs";
import { listModels, resolveModel } from "./models.mjs";
import { redactText } from "./redact.mjs";

function expandHome(value) {
  if (value === "~") return homedir();
  if (typeof value === "string" && value.startsWith("~/")) return resolve(homedir(), value.slice(2));
  return resolve(value);
}

export function failureMemoryPath() {
  return expandHome(process.env.CODEX_MOA_FAILURE_MEMORY || "~/.codex-moa/failures.jsonl");
}

export function failureMemoryPolicy(config = {}) {
  const source = config.failureMemory ?? {};
  return {
    transientWindowMs: Number(source.transientWindowHours ?? 6) * 3600000,
    transientThreshold: Number(source.transientThreshold ?? 2),
    transientGuardMs: Number(source.transientGuardHours ?? 1) * 3600000,
    deterministicGuardMs: Number(source.deterministicGuardHours ?? 24) * 3600000,
    protocolGuardMs: Number(source.protocolGuardHours ?? 2) * 3600000
  };
}

function failureText(result = {}) {
  return redactText(result.stderr || result.error || result.stopReason || result.summary || result.status || "unknown failure").slice(0, 1000);
}

export function classifySeatFailure(result = {}) {
  const text = failureText(result);
  if (result.timedOut === true || /timeout|timed out|abort/i.test(text)) return "timeout";
  if (/unsupported|not supported|unknown model|model not found|invalid model|capabilit/i.test(text)) return "capability";
  if (/context.{0,20}(length|limit|window)|too many tokens/i.test(text)) return "context_limit";
  if (/invalid (json|response)|parse error|protocol|malformed/i.test(text)) return "protocol";
  const providerKind = classifyProviderError(text);
  return providerKind === "unknown" ? "execution" : providerKind;
}

function normalizedFingerprintText(text) {
  return text.toLowerCase()
    .replace(/[0-9a-f]{8}-[0-9a-f-]{27,}/gi, "<uuid>")
    .replace(/\b\d{4,}\b/g, "<n>")
    .replace(/\/[\w./-]+/g, "<path>")
    .replace(/\s+/g, " ")
    .trim();
}

export async function recordSeatFailure({ taskId, level, seat, result }, path = failureMemoryPath()) {
  const message = failureText(result);
  const kind = classifySeatFailure(result);
  const signature = createHash("sha256")
    .update(`${seat.model}\n${seat.harness}\n${kind}\n${normalizedFingerprintText(message)}`)
    .digest("hex").slice(0, 20);
  const entry = {
    type: "failure",
    time: new Date().toISOString(),
    taskId,
    level,
    seat: seat.seat,
    role: seat.role,
    model: seat.model,
    harness: seat.harness,
    runtime: seat.runtime ?? "cli",
    auditMode: seat.auditMode ?? null,
    status: result.status ?? "failed",
    timedOut: result.timedOut === true,
    stopReason: result.stopReason ?? null,
    kind,
    signature,
    message
  };
  await mkdir(dirname(path), { recursive: true });
  await appendFile(path, `${JSON.stringify(entry)}\n`, { encoding: "utf8", mode: 0o600 });
  await chmod(path, 0o600).catch(() => {});
  return entry;
}

export async function recordSeatRecovery({ taskId, level, seat, result }, path = failureMemoryPath()) {
  const entry = {
    type: "recovery",
    time: new Date().toISOString(),
    taskId,
    level,
    seat: seat.seat,
    role: seat.role,
    model: seat.model,
    harness: seat.harness,
    runtime: seat.runtime ?? "cli",
    auditMode: seat.auditMode ?? null,
    status: result.status ?? "done",
    durationMs: Number.isFinite(Number(result.durationMs)) ? Number(result.durationMs) : null
  };
  await mkdir(dirname(path), { recursive: true });
  await appendFile(path, `${JSON.stringify(entry)}\n`, { encoding: "utf8", mode: 0o600 });
  await chmod(path, 0o600).catch(() => {});
  return entry;
}

export async function readFailureMemory(path = failureMemoryPath(), limit = 10000) {
  if (!existsSync(path)) return [];
  try { return (await readFile(path, "utf8")).split(/\r?\n/).filter(Boolean).slice(-limit).map(JSON.parse); } catch { return []; }
}

export function summarizeFailureMemory(entries = [], { config = {}, now = Date.now() } = {}) {
  const policy = failureMemoryPolicy(config);
  const routes = {};
  const recentSignatureCounts = new Map();
  const latestRecovery = new Map();
  for (const entry of entries) {
    const at = Date.parse(entry.time);
    if (!Number.isFinite(at)) continue;
    const route = `${entry.model}@${entry.harness}`;
    if (entry.type === "recovery") {
      if (!latestRecovery.has(route) || at > latestRecovery.get(route)) latestRecovery.set(route, at);
      continue;
    }
    if (now - at > policy.transientWindowMs) continue;
    const key = `${entry.model}@${entry.harness}:${entry.signature}`;
    recentSignatureCounts.set(key, (recentSignatureCounts.get(key) ?? 0) + 1);
  }
  for (const entry of entries) {
    const at = Date.parse(entry.time);
    if (!Number.isFinite(at)) continue;
    const route = `${entry.model}@${entry.harness}`;
    const state = routes[route] ??= { model: entry.model, harness: entry.harness, failures: 0, recoveries: 0, byKind: {}, signatures: {}, activeGuard: null, lastFailureAt: null, lastRecoveryAt: null };
    if (entry.type === "recovery") {
      state.recoveries += 1;
      if (!state.lastRecoveryAt || at > Date.parse(state.lastRecoveryAt)) state.lastRecoveryAt = entry.time;
      continue;
    }
    state.failures += 1;
    state.byKind[entry.kind] = (state.byKind[entry.kind] ?? 0) + 1;
    state.signatures[entry.signature] = (state.signatures[entry.signature] ?? 0) + 1;
    if (!state.lastFailureAt || at > Date.parse(state.lastFailureAt)) state.lastFailureAt = entry.time;
    const age = now - at;
    const deterministic = ["auth", "capability"].includes(entry.kind);
    const protocol = entry.kind === "protocol";
    const sameSignatureRecent = recentSignatureCounts.get(`${entry.model}@${entry.harness}:${entry.signature}`) ?? 0;
    const guardMs = deterministic ? policy.deterministicGuardMs : protocol ? policy.protocolGuardMs : sameSignatureRecent >= policy.transientThreshold ? policy.transientGuardMs : 0;
    if (guardMs > 0 && age < guardMs && (latestRecovery.get(route) ?? -Infinity) < at) {
      const guardUntil = new Date(at + guardMs).toISOString();
      if (!state.activeGuard || Date.parse(guardUntil) > Date.parse(state.activeGuard.guardUntil)) {
        state.activeGuard = { kind: entry.kind, signature: entry.signature, count: sameSignatureRecent, guardUntil, reason: deterministic || protocol ? "deterministic failure" : "repeated transient failure" };
      }
    }
  }
  return { entries: entries.length, routes, policy };
}

function guarded(summary, model, harness) {
  return summary?.routes?.[`${model}@${harness}`]?.activeGuard ?? null;
}

export function failureGuardFor(summary, model, harness) {
  return guarded(summary, model, harness);
}

function providerForFamily(family) {
  if (family === "moonshot") return "kimi";
  if (family === "zhipu") return "zai";
  if (family === "deepseek") return "deepseek";
  return "unknown";
}

function applyModel(seat, model, harness) {
  seat.originalModel ??= seat.model;
  seat.originalHarness ??= seat.harness;
  seat.model = model.id;
  seat.providerModel = model.providerModel;
  seat.dsh = model.dsh;
  seat.pi = model.pi;
  seat.claude = model.claude;
  seat.codex = model.codex;
  seat.family = model.family;
  seat.harness = harness;
  seat.modelTier = model.tier;
  seat.failureAdjusted = true;
}

export function applyFailureAvoidance(seats, { summary, modelsConfig, captain = null, health = null } = {}) {
  const adjustments = [];
  const blocked = [];
  const models = listModels(modelsConfig);
  for (const seat of seats) {
    const active = guarded(summary, seat.model, seat.harness);
    if (!active) continue;
    const current = resolveModel(seat.model, modelsConfig);
    const alternateHarness = (current.supportedHarnesses ?? [current.harness])
      .find((harness) => harness !== seat.harness && !guarded(summary, current.id, harness));
    if (alternateHarness) {
      const from = `${seat.model}@${seat.harness}`;
      seat.originalHarness ??= seat.harness;
      seat.harness = alternateHarness;
      seat.failureAdjusted = true;
      adjustments.push({ seat: seat.seat, action: "changed_harness_same_model", from, to: `${seat.model}@${seat.harness}`, guard: active });
      continue;
    }
    if (seat.auditMode === "shadow") {
      seat.skipDispatch = true;
      seat.skipReason = `active failure guard for ${seat.model}@${seat.harness}`;
      adjustments.push({ seat: seat.seat, action: "skipped_shadow", from: `${seat.model}@${seat.harness}`, guard: active });
      continue;
    }
    const pairedExecutor = seats.find((item) => item.seat === seat.pairedExecutor) ?? seats.find((item) => item.role === "executor");
    const pairedFamily = pairedExecutor ? resolveModel(pairedExecutor.model, modelsConfig).family : null;
    const candidates = models
      .filter((model) => model.id !== current.id)
      .filter((model) => model.tier === current.tier)
      .filter((model) => !(seat.role === "auditor" && pairedFamily && model.family === pairedFamily))
      .filter((model) => !(seat.role === "auditor" && captain?.family && captain.family !== "unknown" && model.family === captain.family))
      .filter((model) => !["critical", "inactive"].includes(health?.providers?.[providerForFamily(model.family)]?.status))
      .map((model) => ({ model, harness: (model.supportedHarnesses ?? [model.harness]).includes("pi") ? "pi" : model.harness }))
      .filter(({ model, harness }) => !guarded(summary, model.id, harness))
      .sort((left, right) => {
        const leftSubscription = ["moonshot", "zhipu"].includes(left.model.family) ? 0 : 1;
        const rightSubscription = ["moonshot", "zhipu"].includes(right.model.family) ? 0 : 1;
        return leftSubscription - rightSubscription;
      });
    const replacement = candidates[0];
    if (!replacement) {
      blocked.push({ seat: seat.seat, route: `${seat.model}@${seat.harness}`, guard: active });
      continue;
    }
    const from = `${seat.model}@${seat.harness}`;
    applyModel(seat, replacement.model, replacement.harness);
    adjustments.push({ seat: seat.seat, action: "rerouted_failure_guard", from, to: `${seat.model}@${seat.harness}`, guard: active });
  }
  return { adjustments, blocked };
}
