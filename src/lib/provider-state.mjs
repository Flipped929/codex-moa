import { homedir } from "node:os";
import { resolve } from "node:path";
import { readJsonStore, updateJsonStore } from "./json-store.mjs";
import { fetchDeepSeekQuota, fetchKimiQuota, fetchZaiQuota, resolveQuotaCredentials } from "./quota.mjs";

const STATE_VERSION = 2;
const DEFAULT_STATE = { version: STATE_VERSION, providers: {} };
const MIGRATIONS = {
  1: (state) => ({ ...state, providers: state.providers ?? {} })
};

function expandHome(value) {
  if (typeof value !== "string") return value;
  if (value === "~") return homedir();
  if (value.startsWith("~/")) return resolve(homedir(), value.slice(2));
  return resolve(value);
}

export function providerStatePath() {
  return expandHome(process.env.CODEX_MOA_PROVIDER_STATE || "~/.codex-moa/provider-state.json");
}

export function providerHealthPolicy(config = {}) {
  const source = config.providerHealth ?? {};
  return {
    failureThreshold: Number(source.failureThreshold ?? 3),
    baseOpenMs: Number(source.baseOpenMs ?? 60000),
    maxOpenMs: Number(source.maxOpenMs ?? 3600000),
    latencyWarningMs: Number(source.latencyWarningMs ?? 10000),
    windowSize: Number(source.windowSize ?? 100)
  };
}

export function classifyProviderError(error, statusCode = null) {
  const code = Number(statusCode);
  if (code === 429 || /rate.?limit|too many requests/i.test(String(error))) return "rate_limit";
  if (code === 401 || code === 403 || /auth|unauthori[sz]ed|login required/i.test(String(error))) return "auth";
  if (code >= 500 || /server error|bad gateway|unavailable/i.test(String(error))) return "server";
  if (/timeout|timed out|abort/i.test(String(error))) return "timeout";
  if (/captcha|business|model request|provider/i.test(String(error))) return "provider_business";
  return "unknown";
}

export async function readProviderState(path = providerStatePath()) {
  return readJsonStore(path, { version: STATE_VERSION, defaultValue: DEFAULT_STATE, migrations: MIGRATIONS });
}

export async function recordProviderOutcome({ provider, model = null, ok, latencyMs = null, statusCode = null, error = null }, path = providerStatePath(), config = {}) {
  const policy = providerHealthPolicy(config);
  let snapshot;
  await updateJsonStore(path, (state) => {
    const current = state.providers[provider] ??= {
      circuit: "closed",
      consecutiveFailures: 0,
      openUntil: null,
      outcomes: []
    };
    const now = Date.now();
    current.outcomes = [...(current.outcomes ?? []), {
      time: new Date(now).toISOString(),
      model,
      ok: ok === true,
      latencyMs: Number.isFinite(Number(latencyMs)) ? Number(latencyMs) : null,
      statusCode,
      errorKind: ok ? null : classifyProviderError(error, statusCode),
      error: error ? String(error).slice(0, 1000) : null
    }].slice(-policy.windowSize);
    if (ok) {
      current.circuit = "closed";
      current.consecutiveFailures = 0;
      current.openUntil = null;
      current.lastErrorKind = null;
    } else {
      current.consecutiveFailures += 1;
      current.lastErrorKind = classifyProviderError(error, statusCode);
      if (current.consecutiveFailures >= policy.failureThreshold) {
        current.circuit = "open";
        const exponent = Math.max(0, current.consecutiveFailures - policy.failureThreshold);
        current.openUntil = new Date(now + Math.min(policy.baseOpenMs * (2 ** exponent), policy.maxOpenMs)).toISOString();
      }
    }
    current.updatedAt = new Date(now).toISOString();
    snapshot = current;
    return state;
  }, { version: STATE_VERSION, defaultValue: DEFAULT_STATE, migrations: MIGRATIONS });
  return snapshot;
}

function percentile(values, ratio) {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.floor((sorted.length - 1) * ratio))];
}

export function providerCircuitStatus(state, provider, config = {}, now = Date.now()) {
  const policy = providerHealthPolicy(config);
  const current = state?.providers?.[provider];
  if (!current) return { circuit: "closed", consecutiveFailures: 0, openUntil: null, p50LatencyMs: null, p95LatencyMs: null, lastErrorKind: null };
  let circuit = current.circuit ?? "closed";
  const openUntilMs = current.openUntil ? Date.parse(current.openUntil) : null;
  if (circuit === "open" && openUntilMs !== null && openUntilMs <= now) circuit = "half-open";
  const latencies = (current.outcomes ?? []).map((entry) => Number(entry.latencyMs)).filter((value) => Number.isFinite(value) && value >= 0);
  return {
    circuit,
    consecutiveFailures: current.consecutiveFailures ?? 0,
    openUntil: current.openUntil ?? null,
    retryAt: circuit === "half-open" ? new Date(now).toISOString() : current.openUntil ?? null,
    p50LatencyMs: percentile(latencies, 0.5),
    p95LatencyMs: percentile(latencies, 0.95),
    latencyWarning: latencies.length > 0 && percentile(latencies, 0.95) > policy.latencyWarningMs,
    lastErrorKind: current.lastErrorKind ?? null,
    updatedAt: current.updatedAt ?? null
  };
}

export function shouldProbeProvider(state, provider, config = {}, now = Date.now()) {
  const status = providerCircuitStatus(state, provider, config, now);
  return status.circuit === "half-open";
}

async function defaultProbe(provider, config) {
  const credentials = resolveQuotaCredentials();
  if (provider === "kimi") return fetchKimiQuota(credentials);
  if (provider === "zai") return fetchZaiQuota(credentials, { zaiRegion: config.quota?.zaiRegion });
  if (provider === "deepseek") return fetchDeepSeekQuota(credentials);
  throw new Error(`Unknown provider: ${provider}`);
}

export async function probeProvider(provider, { config = {}, deps = {} } = {}) {
  const startedAt = Date.now();
  try {
    const result = await (deps.probe ?? defaultProbe)(provider, config);
    const ok = result?.status === "ok";
    const outcome = await recordProviderOutcome({
      provider,
      ok,
      latencyMs: Date.now() - startedAt,
      error: ok ? null : result?.error ?? result?.status ?? "probe failed"
    }, deps.statePath, config);
    return { provider, ok, status: result?.status ?? "unknown", latencyMs: Date.now() - startedAt, outcome };
  } catch (error) {
    const outcome = await recordProviderOutcome({
      provider,
      ok: false,
      latencyMs: Date.now() - startedAt,
      error: error.message
    }, deps.statePath, config);
    return { provider, ok: false, status: "unavailable", latencyMs: Date.now() - startedAt, error: error.message, outcome };
  }
}

export async function recoverProviders({ config = {}, providers = ["kimi", "zai", "deepseek"], force = false, deps = {} } = {}) {
  const state = await readProviderState(deps.statePath);
  const results = [];
  for (const provider of providers) {
    if (!force && !shouldProbeProvider(state, provider, config)) continue;
    results.push(await probeProvider(provider, { config, deps }));
  }
  return { probed: results.length, results };
}
