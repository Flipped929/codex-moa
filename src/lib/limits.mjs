import { resolveModel } from "./models.mjs";

export function modelLimits(selector, modelsConfig) {
  return resolveModel(selector, modelsConfig).limits ?? {};
}

export function budgetForTask({ selector, level = "L1", role = "executor", stakes = "medium", requestedContext = null, requestedOutput = null, limitMode = "balanced" }, modelsConfig) {
  const limits = modelLimits(selector, modelsConfig);
  const contextWindow = Number(limits.contextWindow ?? 0);
  const maxOutputTokens = Number(limits.maxOutputTokens ?? 0);
  if (limitMode === "max") {
    return { contextWindow, maxOutputTokens, contextBudget: contextWindow, outputBudget: maxOutputTokens, source: "max-capability" };
  }
  const contextRatio = level === "L3" ? 0.75 : level === "L2" ? 0.5 : level === "L1" ? 0.25 : 0.1;
  const taskOutput = role === "auditor" || role === "reviewer"
    ? (stakes === "high" ? 16384 : 8192)
    : level === "L3" ? 65536 : level === "L2" ? 32768 : 8192;
  const contextBudget = Math.min(contextWindow || Number.MAX_SAFE_INTEGER, Number(requestedContext ?? Math.max(limits.recommendedContextTokens ?? 0, Math.floor(contextWindow * contextRatio))));
  const outputBudget = Math.min(maxOutputTokens || Number.MAX_SAFE_INTEGER, Number(requestedOutput ?? Math.max(limits.recommendedOutputTokens ?? 0, taskOutput)));
  return {
    contextWindow,
    maxOutputTokens,
    contextBudget,
    outputBudget,
    source: requestedContext || requestedOutput ? "explicit" : "task-policy"
  };
}
