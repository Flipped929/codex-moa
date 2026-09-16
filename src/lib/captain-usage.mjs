import { existsSync } from "node:fs";
import { chmod, mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { homedir } from "node:os";
import { dirname, resolve } from "node:path";

function expandHome(value) {
  if (value === "~") return homedir();
  if (typeof value === "string" && value.startsWith("~/")) return resolve(homedir(), value.slice(2));
  return resolve(value);
}

export function captainUsagePath() {
  return expandHome(process.env.CODEX_MOA_CAPTAIN_USAGE || "~/.codex-moa/captain-usage.json");
}

function normalizeLimit(limit) {
  const usedPercent = Number(limit?.usedPercent);
  return {
    limitId: String(limit?.limitId ?? "codex"),
    windowDurationMins: Number.isFinite(Number(limit?.windowDurationMins)) ? Number(limit.windowDurationMins) : null,
    usedPercent: Number.isFinite(usedPercent) ? Math.max(0, Math.min(100, usedPercent)) : null,
    remainingPercent: Number.isFinite(usedPercent) ? Math.max(0, Math.min(100, 100 - usedPercent)) : null,
    resetsAt: Number.isFinite(Number(limit?.resetsAt)) ? Number(limit.resetsAt) : null
  };
}

export function normalizeCaptainUsage(input = {}) {
  const limits = (input.limits ?? []).map(normalizeLimit);
  return {
    source: input.source ?? "codex-app-usage-limits",
    observedAt: input.observedAt ?? new Date().toISOString(),
    planType: input.planType ?? null,
    ordinaryUsageAllowed: input.ordinaryUsageAllowed !== false,
    limits
  };
}

export async function writeCaptainUsage(input, path = captainUsagePath()) {
  const value = normalizeCaptainUsage(input);
  await mkdir(dirname(path), { recursive: true, mode: 0o700 });
  const temporary = `${path}.${randomUUID()}.tmp`;
  await writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 });
  await rename(temporary, path);
  await chmod(path, 0o600);
  return value;
}

export async function readCaptainUsage(path = captainUsagePath()) {
  if (!existsSync(path)) return null;
  try { return normalizeCaptainUsage(JSON.parse(await readFile(path, "utf8"))); } catch { return null; }
}

export function isOpenAiCaptain(captain) {
  return captain?.family === "openai" || /openai/i.test(captain?.provider?.name ?? "");
}

export function captainAllocation(captain, usage) {
  if (!isOpenAiCaptain(captain)) return { active: false, reason: "captain is not confirmed as OpenAI/GPT" };
  const primary = usage?.limits?.find((limit) => limit.limitId === "codex") ?? usage?.limits?.[0] ?? null;
  const remaining = Number(primary?.remainingPercent);
  if (!Number.isFinite(remaining)) return { active: false, reason: "GPT quota is unavailable" };
  const tier = remaining <= 10 ? "critical" : remaining <= 30 ? "protect" : remaining <= 60 ? "conserve" : "balanced";
  const externalTargetPercent = { balanced: 55, conserve: 70, protect: 85, critical: 92 }[tier];
  return {
    active: true,
    provider: "openai",
    tier,
    remainingPercent: remaining,
    externalTargetPercent,
    captainTargetPercent: 100 - externalTargetPercent,
    observedAt: usage.observedAt,
    resetsAt: primary.resetsAt,
    guidance: tier === "balanced"
      ? "Keep GPT on planning, adjudication, integration, and the final answer; delegate substantial execution."
      : "Reserve GPT for global planning, evidence adjudication, conflict resolution, integration, and the final answer; delegate execution and first-pass review aggressively."
  };
}
