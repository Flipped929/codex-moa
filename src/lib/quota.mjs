import { existsSync, readFileSync } from "node:fs";
import { chmod, mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { randomUUID } from "node:crypto";
import { loadConfig } from "./config.mjs";
import { resolveModel, resolveSeatModel } from "./models.mjs";

function expandHome(value) {
  if (typeof value !== "string") return value;
  if (value === "~") return homedir();
  if (value.startsWith("~/")) return resolve(homedir(), value.slice(2));
  return resolve(value);
}

function readDshCredential(name) {
  const path = join(homedir(), ".dsh", ".credentials.yaml");
  try {
    const text = readFileSync(path, "utf8");
    const pattern = new RegExp(`^\\s*${name}:\\s*(?:"([^"]+)"|'([^']+)'|([^\\s#]+))`, "m");
    const match = text.match(pattern);
    return match?.[1] ?? match?.[2] ?? match?.[3] ?? "";
  } catch {
    return "";
  }
}

function readKimiAccessToken() {
  try {
    const path = join(homedir(), ".kimi-code", "credentials", "kimi-code.json");
    return JSON.parse(readFileSync(path, "utf8")).access_token ?? "";
  } catch {
    return "";
  }
}

function numberOrNull(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function iso(value) {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function percent(used, limit) {
  const usedNumber = numberOrNull(used);
  const limitNumber = numberOrNull(limit);
  if (usedNumber === null || limitNumber === null || limitNumber <= 0) return null;
  return Math.max(0, Math.min(100, 100 - (usedNumber / limitNumber) * 100));
}

async function fetchJson(url, init = {}, timeoutMs = 15000) {
  const response = await fetch(url, { ...init, signal: AbortSignal.timeout(timeoutMs) });
  const text = await response.text();
  let body = null;
  try { body = JSON.parse(text); } catch {}
  if (!response.ok) {
    const error = new Error(`${url} returned HTTP ${response.status}`);
    error.status = response.status === 401 || response.status === 403 ? "unauthorized" : response.status === 429 ? "rate_limited" : "unavailable";
    error.body = body;
    throw error;
  }
  if (body === null) throw new Error(`${url} returned invalid JSON`);
  return body;
}

export function resolveQuotaCredentials(env = process.env) {
  const dshKimi = readDshCredential("KIMI_CODING_API_KEY");
  const dshZai = readDshCredential("ZAI_CODING_CN_API_KEY");
  const dshDeepSeek = readDshCredential("DEEPSEEK_API_KEY");
  return {
    kimiApiKey: env.KIMI_CODE_API_KEY || dshKimi || readKimiAccessToken(),
    zaiApiKey: env.ZAI_API_KEY || env.Z_AI_API_KEY || env.GLM_API_KEY || env.ZHIPU_API_KEY || dshZai,
    deepseekApiKey: env.DEEPSEEK_API_KEY || dshDeepSeek
  };
}

export function parseKimiQuota(raw) {
  const windows = [];
  const usage = raw?.usage;
  if (usage) {
    windows.push({
      kind: "weekly",
      label: "Weekly",
      limit: numberOrNull(usage.limit),
      used: numberOrNull(usage.used),
      remaining: numberOrNull(usage.remaining),
      remainingPercent: percent(usage.used, usage.limit),
      resetAt: iso(usage.resetTime)
    });
  }
  const details = raw?.usages;
  if (details?.limit_5h) {
    const usedRatio = numberOrNull(details.limit_5h.used_ratio);
    windows.push({
      kind: "session",
      label: "5-hour",
      remainingPercent: usedRatio === null ? null : Math.max(0, 100 - usedRatio * 100),
      resetAt: iso(details.limit_5h.reset_time)
    });
  }
  if (details?.limit_7d) {
    const usedRatio = numberOrNull(details.limit_7d.used_ratio);
    const weekly = windows.find((window) => window.kind === "weekly");
    if (weekly) {
      weekly.remainingPercent = usedRatio === null ? weekly.remainingPercent : Math.max(0, 100 - usedRatio * 100);
      weekly.resetAt = iso(details.limit_7d.reset_time) || weekly.resetAt;
    } else {
      windows.push({
        kind: "weekly",
        label: "Weekly",
        remainingPercent: usedRatio === null ? null : Math.max(0, 100 - usedRatio * 100),
        resetAt: iso(details.limit_7d.reset_time)
      });
    }
  }
  if (!windows.some((window) => window.kind === "session") && Array.isArray(raw?.limits)) {
    for (const entry of raw.limits) {
      const duration = numberOrNull(entry?.window?.duration);
      const unit = String(entry?.window?.timeUnit ?? "");
      const minutes = unit.includes("MIN") ? duration : unit.includes("HOUR") ? duration * 60 : duration;
      if (minutes !== null && minutes <= 360) {
        windows.push({
          kind: "session",
          label: "5-hour",
          limit: numberOrNull(entry?.detail?.limit),
          used: numberOrNull(entry?.detail?.used),
          remaining: numberOrNull(entry?.detail?.remaining),
          remainingPercent: percent(entry?.detail?.used, entry?.detail?.limit),
          resetAt: iso(entry?.detail?.resetTime)
        });
      }
    }
  }
  return windows.filter((window) => window.remainingPercent !== null || window.remaining !== null);
}

export function parseZaiQuota(raw) {
  const limits = Array.isArray(raw?.data?.limits) ? raw.data.limits : [];
  const windows = [];
  for (const limit of limits) {
    const type = String(limit?.type ?? "").toUpperCase();
    const unit = numberOrNull(limit?.unit);
    const usage = numberOrNull(limit?.usage);
    const remaining = numberOrNull(limit?.remaining);
    const used = usage !== null && remaining !== null ? usage - remaining : null;
    const remainingPercent = usage !== null && usage > 0 ? Math.max(0, Math.min(100, (remaining / usage) * 100)) : numberOrNull(limit?.percentage) === null ? null : Math.max(0, 100 - numberOrNull(limit.percentage));
    let kind = "billing";
    let label = "MCP";
    if (type === "CREDIT_LIMIT" || type === "TOKENS_LIMIT") {
      if (unit === 3) { kind = "session"; label = "5-hour"; }
      else if (unit === 6) { kind = "weekly"; label = "Weekly"; }
      else if (unit === 7) { kind = "monthly"; label = "Monthly"; }
      else { kind = "billing"; label = "Quota"; }
    }
    if (remainingPercent === null && remaining === null) continue;
    windows.push({
      kind,
      label,
      limit: usage,
      used,
      remaining,
      remainingPercent,
      resetAt: iso(limit?.nextResetTime ?? limit?.next_reset_time)
    });
  }
  return windows;
}

export function parseDeepSeekQuota(raw) {
  const balances = Array.isArray(raw?.balance_infos) ? raw.balance_infos : [];
  const rows = balances.map((row) => ({
    currency: String(row?.currency ?? "").toUpperCase(),
    amount: numberOrNull(row?.total_balance),
    granted: numberOrNull(row?.granted_balance),
    toppedUp: numberOrNull(row?.topped_up_balance)
  })).filter((row) => row.currency && row.amount !== null);
  if (rows.length === 0) return [];
  const row = rows.sort((a, b) => b.amount - a.amount)[0];
  return [{
    kind: "billing",
    label: "Balance",
    remaining: row.amount,
    currency: row.currency,
    granted: row.granted,
    toppedUp: row.toppedUp
  }];
}

export async function fetchKimiQuota(credentials) {
  if (!credentials.kimiApiKey) return { provider: "kimi", status: "not_configured", windows: [] };
  try {
    const raw = await fetchJson("https://api.kimi.com/coding/v1/usages", {
      headers: { Authorization: `Bearer ${credentials.kimiApiKey}`, Accept: "application/json" }
    });
    return { provider: "kimi", status: "ok", windows: parseKimiQuota(raw) };
  } catch (error) {
    return { provider: "kimi", status: error.status ?? "unavailable", error: error.message, windows: [] };
  }
}

export async function fetchZaiQuota(credentials, options = {}) {
  if (!credentials.zaiApiKey) return { provider: "zai", status: "not_configured", windows: [] };
  const region = options.zaiRegion ?? "bigmodel-cn";
  const baseUrl = region === "global" ? "https://api.z.ai" : "https://open.bigmodel.cn";
  try {
    const raw = await fetchJson(`${baseUrl}/api/monitor/usage/quota/limit`, {
      headers: { Authorization: `Bearer ${credentials.zaiApiKey}`, Accept: "application/json" }
    });
    return { provider: "zai", status: "ok", region, plan: raw?.data?.level ?? null, windows: parseZaiQuota(raw) };
  } catch (error) {
    return { provider: "zai", status: error.status ?? "unavailable", region, error: error.message, windows: [] };
  }
}

export async function fetchDeepSeekQuota(credentials) {
  if (!credentials.deepseekApiKey) return { provider: "deepseek", status: "not_configured", windows: [] };
  try {
    const raw = await fetchJson("https://api.deepseek.com/user/balance", {
      headers: { Authorization: `Bearer ${credentials.deepseekApiKey}`, Accept: "application/json" }
    });
    return { provider: "deepseek", status: raw?.is_available === false ? "unavailable" : "ok", windows: parseDeepSeekQuota(raw) };
  } catch (error) {
    return { provider: "deepseek", status: error.status ?? "unavailable", error: error.message, windows: [] };
  }
}

export function quotaFilePath(config = loadConfig()) {
  return expandHome(config.quota?.snapshotPath ?? "~/.codex-moa/quota.json");
}

export async function refreshQuota(config = loadConfig(), deps = {}) {
  const credentials = deps.credentials ?? resolveQuotaCredentials(deps.env);
  const providers = await Promise.all([
    fetchKimiQuota(credentials),
    fetchZaiQuota(credentials, { zaiRegion: config.quota?.zaiRegion }),
    fetchDeepSeekQuota(credentials)
  ]);
  const snapshot = {
    version: 1,
    updatedAt: new Date().toISOString(),
    providers: Object.fromEntries(providers.map((provider) => [provider.provider, provider]))
  };
  if (deps.write !== false) {
    const path = quotaFilePath(config);
    await mkdir(join(path, ".."), { recursive: true });
    const temporary = `${path}.${randomUUID()}.tmp`;
    await writeFile(temporary, `${JSON.stringify(snapshot, null, 2)}\n`, { mode: 0o600 });
    await rename(temporary, path);
    await chmod(path, 0o600);
  }
  return snapshot;
}

export async function readQuotaSnapshot(config = loadConfig()) {
  const path = quotaFilePath(config);
  if (!existsSync(path)) return null;
  try {
    return JSON.parse(await readFile(path, "utf8"));
  } catch {
    return null;
  }
}

export function providerForModel(selector, modelsConfig) {
  return resolveModel(selector, modelsConfig).family === "moonshot" ? "kimi"
    : resolveModel(selector, modelsConfig).family === "zhipu" ? "zai"
      : "deepseek";
}

export function modelQuota(selector, snapshot, modelsConfig) {
  const model = resolveModel(selector, modelsConfig);
  const provider = model.family === "moonshot" ? "kimi" : model.family === "zhipu" ? "zai" : "deepseek";
  const quota = snapshot?.providers?.[provider] ?? null;
  if (!quota) return { provider, status: "unknown", windows: [] };
  const windows = quota.windows ?? [];
  const preferred = windows.find((window) => window.kind === "session")
    ?? windows.find((window) => window.kind === "weekly")
    ?? windows[0]
    ?? null;
  return { provider, status: quota.status, plan: quota.plan ?? null, window: preferred, windows };
}

export function depletedModels(assignments, snapshot, modelsConfig) {
  if (!snapshot) return [];
  return assignments.map((assignment) => ({ assignment, quota: modelQuota(assignment.model, snapshot, modelsConfig) }))
    .filter(({ quota }) => quota.window?.remainingPercent !== undefined && quota.window?.remainingPercent <= 0
      || quota.window?.remaining !== undefined && quota.window?.remaining <= 0);
}

export function quotaForSeats(seats, snapshot, modelsConfig) {
  return seats.map((seat) => ({ seat: seat.seat, model: seat.model, quota: modelQuota(seat.model, snapshot, modelsConfig) }));
}
