import { normalizeUsage } from "./cost-ledger.mjs";

function finite(value) {
  if (value === null || value === undefined || value === "") return null;
  const number = Number(value);
  return Number.isFinite(number) && number >= 0 ? number : null;
}

export function normalizeBudgetPolicy({ config = {}, input = {} } = {}) {
  const configured = config.budgets ?? {};
  const requested = input.budget ?? {};
  return {
    enforce: requested.enforce ?? configured.enforce ?? true,
    maxTokens: finite(requested.maxTokens ?? configured.maxTokens),
    maxEstimatedUsd: finite(requested.maxEstimatedUsd ?? configured.maxEstimatedUsd),
    maxDurationMs: finite(requested.maxDurationMs ?? configured.maxDurationMs),
    maxContextUsed: finite(requested.maxContextUsed ?? configured.maxContextUsed)
  };
}

export function newBudgetTotals() {
  return {
    inputTokens: 0,
    outputTokens: 0,
    totalTokens: 0,
    reasoningTokens: 0,
    cacheReadTokens: 0,
    cacheWriteTokens: 0,
    contextPeak: 0,
    estimatedUsd: 0,
    pricedEntries: 0,
    durationMs: 0
  };
}

export function accumulateBudget(totals, entry) {
  const usage = normalizeUsage(entry?.usage);
  const tokens = Number(usage.totalTokens) || (Number(usage.inputTokens) || 0) + (Number(usage.outputTokens) || 0);
  totals.inputTokens += Number(usage.inputTokens) || 0;
  totals.outputTokens += Number(usage.outputTokens) || 0;
  totals.totalTokens += tokens;
  totals.reasoningTokens += Number(usage.reasoningTokens) || 0;
  totals.cacheReadTokens += Number(usage.cacheReadTokens) || 0;
  totals.cacheWriteTokens += Number(usage.cacheWriteTokens) || 0;
  totals.contextPeak = Math.max(totals.contextPeak, Number(usage.contextUsed) || 0);
  totals.durationMs += Number(entry?.durationMs) || 0;
  if (Number.isFinite(Number(entry?.estimatedUsd))) {
    totals.estimatedUsd += Number(entry.estimatedUsd);
    totals.pricedEntries += 1;
  }
  return totals;
}

export function evaluateBudget(totals, policy, startedAt = Date.now()) {
  if (policy.enforce === false) return [];
  const violations = [];
  const wallDurationMs = Math.max(0, Date.now() - startedAt);
  if (policy.maxTokens !== null && totals.totalTokens > policy.maxTokens) {
    violations.push({ type: "tokens", limit: policy.maxTokens, actual: totals.totalTokens });
  }
  if (policy.maxEstimatedUsd !== null && totals.estimatedUsd > policy.maxEstimatedUsd) {
    violations.push({ type: "estimated_usd", limit: policy.maxEstimatedUsd, actual: totals.estimatedUsd });
  }
  if (policy.maxDurationMs !== null && wallDurationMs > policy.maxDurationMs) {
    violations.push({ type: "wall_time_ms", limit: policy.maxDurationMs, actual: wallDurationMs });
  }
  if (policy.maxContextUsed !== null && totals.contextPeak > policy.maxContextUsed) {
    violations.push({ type: "context_tokens", limit: policy.maxContextUsed, actual: totals.contextPeak });
  }
  return violations;
}

export function budgetSummary(policy, totals, startedAt = Date.now()) {
  return {
    policy,
    totals: { ...totals, wallDurationMs: Math.max(0, Date.now() - startedAt) }
  };
}
