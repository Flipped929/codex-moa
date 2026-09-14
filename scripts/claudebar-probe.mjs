#!/usr/bin/env node
import { readQuotaSnapshot, refreshQuota } from "../src/lib/quota.mjs";
import { buildStatusSummary, toClaudeBarCost, toClaudeBarMetrics, toClaudeBarStatus } from "../src/lib/status-summary.mjs";

function option(name, fallback = null) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] ?? fallback : fallback;
}

const section = option("--section", "quotas");
const maxAgeMs = 5 * 60 * 1000;

async function quotaPayload() {
  let snapshot = await readQuotaSnapshot();
  if (!snapshot || Date.now() - Date.parse(snapshot.updatedAt) > maxAgeMs) {
    try {
      snapshot = await refreshQuota();
    } catch {
      snapshot = snapshot ?? { providers: {} };
    }
  }

  const quotas = [];
  function addProviderQuota(providerId, label) {
    const provider = snapshot?.providers?.[providerId];
    if (!provider) return;
    for (const window of provider.windows ?? []) {
      const quota = { type: `${window.kind}:${label}` };
      if (window.remainingPercent !== null && window.remainingPercent !== undefined) {
        quota.percentRemaining = Math.max(0, Math.min(100, window.remainingPercent));
      }
      if (window.remaining !== null && window.remaining !== undefined && window.currency) {
        quota.dollarRemaining = window.remaining;
      }
      if (window.resetAt) quota.resetsAt = window.resetAt;
      if (Object.keys(quota).length > 1) quotas.push(quota);
    }
  }

  addProviderQuota("kimi", "Kimi");
  addProviderQuota("zai", "GLM");

  const deepseekBudget = Number(process.env.CLAUDEBAR_DEEPSEEK_BUDGET || 100);
  for (const window of snapshot?.providers?.deepseek?.windows ?? []) {
    if (!Number.isFinite(deepseekBudget) || deepseekBudget <= 0 || window.remaining === undefined) continue;
    quotas.push({
      type: "billing:DeepSeek",
      percentRemaining: Math.max(0, Math.min(100, (window.remaining / deepseekBudget) * 100)),
      dollarRemaining: window.remaining
    });
  }
  return { quotas };
}

let payload;
try {
  if (section === "quotas") payload = await quotaPayload();
  else if (section === "metrics") payload = toClaudeBarMetrics(await buildStatusSummary());
  else if (section === "status") payload = toClaudeBarStatus(await buildStatusSummary());
  else if (section === "cost") payload = toClaudeBarCost(await buildStatusSummary());
  else if (section === "all") {
    const summary = await buildStatusSummary();
    payload = { ...(await quotaPayload()), ...toClaudeBarMetrics(summary), ...toClaudeBarStatus(summary), ...toClaudeBarCost(summary) };
  } else {
    throw new Error(`Unknown ClaudeBar section: ${section}`);
  }
} catch (error) {
  payload = section === "status"
    ? { status: { text: `Codex MOA probe error: ${error.message}`, level: "warning" } }
    : { metrics: [] };
}

process.stdout.write(`${JSON.stringify(payload, null, 2)}\n`);
