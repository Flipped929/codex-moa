import { existsSync, readFileSync } from "node:fs";
import { appendFile, chmod, mkdir, readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, resolve } from "node:path";
import { loadPricing } from "./config.mjs";

function expandHome(value) {
  if (typeof value !== "string") return value;
  if (value === "~") return homedir();
  if (value.startsWith("~/")) return resolve(homedir(), value.slice(2));
  return resolve(value);
}

export function costLedgerPath() {
  return expandHome(process.env.CODEX_MOA_COST_LEDGER || "~/.codex-moa/cost-ledger.jsonl");
}

function number(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

export function normalizeUsage(usage) {
  if (!usage || typeof usage !== "object") {
    return { inputTokens: null, outputTokens: null, totalTokens: null, reasoningTokens: null, cacheReadTokens: null, cacheWriteTokens: null, contextUsed: null, contextWindow: null };
  }
  const pick = (...keys) => {
    for (const key of keys) {
      const value = number(usage[key]);
      if (value !== null) return value;
    }
    return null;
  };
  const cache = usage.cache && typeof usage.cache === "object" ? usage.cache : {};
  return {
    inputTokens: pick("inputTokens", "input_tokens", "promptTokens", "prompt_tokens"),
    outputTokens: pick("outputTokens", "output_tokens", "completionTokens", "completion_tokens"),
    totalTokens: pick("totalTokens", "total_tokens"),
    reasoningTokens: pick("reasoningTokens", "reasoning_tokens", "thoughtTokens", "thought_tokens") ?? number(usage.reasoning) ?? null,
    cacheReadTokens: pick("cacheReadTokens", "cachedReadTokens", "cache_read_tokens") ?? number(cache.read) ?? null,
    cacheWriteTokens: pick("cacheWriteTokens", "cachedWriteTokens", "cache_write_tokens") ?? number(cache.write) ?? null,
    contextUsed: pick("contextUsed", "used") ?? null,
    contextWindow: pick("contextWindow", "size") ?? null
  };
}

export function estimateUsageCost(model, usage, pricing = loadPricing()) {
  const normalized = normalizeUsage(usage);
  const rates = pricing?.models?.[model] ?? null;
  const hasRate = (value) => value !== null && value !== undefined && value !== "" && Number.isFinite(Number(value));
  if (!rates || !hasRate(rates.inputPerMillion) || !hasRate(rates.outputPerMillion)) {
    return { estimatedUsd: null, currency: pricing?.currency ?? "USD", pricingSource: "config/pricing.json", pricingKnown: false };
  }
  const inputCost = normalized.inputTokens === null ? null : (normalized.inputTokens / 1_000_000) * Number(rates.inputPerMillion);
  const outputCost = normalized.outputTokens === null ? null : (normalized.outputTokens / 1_000_000) * Number(rates.outputPerMillion);
  const estimatedUsd = inputCost === null && outputCost === null ? null : (inputCost ?? 0) + (outputCost ?? 0);
  return { estimatedUsd, currency: pricing?.currency ?? "USD", pricingSource: "config/pricing.json", pricingKnown: estimatedUsd !== null };
}

export function makeCostEntry({ taskId, seat, result, quota = null, pricing = loadPricing() }) {
  const usage = normalizeUsage(result?.usage);
  const estimate = estimateUsageCost(seat.model, usage, pricing);
  return {
    time: new Date().toISOString(),
    taskId,
    seat: seat.seat,
    role: seat.role,
    harness: seat.harness,
    runtime: seat.runtime ?? "cli",
    model: seat.model,
    status: result?.status ?? "unknown",
    durationMs: Number.isFinite(Number(result?.durationMs)) ? Number(result.durationMs) : null,
    timedOut: result?.timedOut === true,
    stopReason: result?.stopReason ?? null,
    usage,
    quota: quota?.quota ?? quota ?? null,
    ...estimate
  };
}

export async function recordCostEntry(entry, path = costLedgerPath()) {
  await mkdir(dirname(path), { recursive: true });
  await appendFile(path, `${JSON.stringify(entry)}\n`, { encoding: "utf8", mode: 0o600 });
  await chmod(path, 0o600).catch(() => {});
  return entry;
}

export async function readCostLedger(path = costLedgerPath(), limit = 10000) {
  if (!existsSync(path)) return [];
  try {
    const lines = (await readFile(path, "utf8")).split(/\r?\n/).filter(Boolean).slice(-limit);
    return lines.map((line) => JSON.parse(line));
  } catch {
    return [];
  }
}

export function summarizeCostLedger(entries = [], { since = null } = {}) {
  const cutoff = since ? Date.parse(since) : null;
  const filtered = entries.filter((entry) => !cutoff || Date.parse(entry.time) >= cutoff);
  const models = {};
  const providers = {};
  let totalTokens = 0;
  let totalDurationMs = 0;
  let peakContextUsed = 0;
  let estimatedUsd = 0;
  let pricedEntries = 0;
  const unknownCostModels = new Set();
  for (const entry of filtered) {
    const model = entry.model ?? "unknown";
    const provider = entry.quota?.provider ?? providerForModelName(model);
    models[model] ??= { runs: 0, inputTokens: 0, outputTokens: 0, totalTokens: 0, durationMs: 0, peakContextUsed: 0, estimatedUsd: 0, failures: 0 };
    providers[provider] ??= { runs: 0, tokens: 0, peakContextUsed: 0, estimatedUsd: 0, failures: 0 };
    const usage = entry.usage ?? {};
    const tokens = Number(usage.totalTokens) || (Number(usage.inputTokens) || 0) + (Number(usage.outputTokens) || 0);
    const duration = Number(entry.durationMs) || 0;
    const contextUsed = Number(usage.contextUsed) || 0;
    const failed = entry.status !== "done";
    models[model].runs += 1;
    models[model].inputTokens += Number(usage.inputTokens) || 0;
    models[model].outputTokens += Number(usage.outputTokens) || 0;
    models[model].totalTokens += tokens;
    models[model].durationMs += duration;
    models[model].peakContextUsed = Math.max(models[model].peakContextUsed, contextUsed);
    models[model].failures += failed ? 1 : 0;
    providers[provider].runs += 1;
    providers[provider].tokens += tokens;
    providers[provider].peakContextUsed = Math.max(providers[provider].peakContextUsed, contextUsed);
    providers[provider].failures += failed ? 1 : 0;
    totalTokens += tokens;
    totalDurationMs += duration;
    peakContextUsed = Math.max(peakContextUsed, contextUsed);
    if (entry.estimatedUsd !== null && entry.estimatedUsd !== undefined && Number.isFinite(Number(entry.estimatedUsd))) {
      const cost = Number(entry.estimatedUsd);
      models[model].estimatedUsd += cost;
      providers[provider].estimatedUsd += cost;
      estimatedUsd += cost;
      pricedEntries += 1;
    } else {
      unknownCostModels.add(model);
    }
  }
  return {
    entries: filtered.length,
    totalTokens,
    totalDurationMs,
    peakContextUsed,
    estimatedUsd: pricedEntries > 0 ? estimatedUsd : null,
    pricedEntries,
    unpricedEntries: filtered.length - pricedEntries,
    unknownCostModels: [...unknownCostModels],
    models,
    providers
  };
}

function providerForModelName(model) {
  if (/kimi/i.test(model)) return "kimi";
  if (/glm|zai/i.test(model)) return "zai";
  if (/deepseek/i.test(model)) return "deepseek";
  return "unknown";
}

export function readCostLedgerSync(path = costLedgerPath()) {
  if (!existsSync(path)) return [];
  try {
    return readFileSync(path, "utf8").split(/\r?\n/).filter(Boolean).map((line) => JSON.parse(line));
  } catch {
    return [];
  }
}
