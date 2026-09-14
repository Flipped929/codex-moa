import test from "node:test";
import assert from "node:assert/strict";
import { accumulateBudget, evaluateBudget, newBudgetTotals, normalizeBudgetPolicy } from "../src/lib/budget.mjs";

test("normalizes and evaluates token, cost, context, and wall-time budgets", () => {
  const policy = normalizeBudgetPolicy({ config: { budgets: { maxTokens: 10, maxDurationMs: 1000 } }, input: { budget: { maxEstimatedUsd: 2 } } });
  const totals = newBudgetTotals();
  accumulateBudget(totals, { usage: { inputTokens: 8, outputTokens: 4, totalTokens: 12, contextUsed: 100 }, estimatedUsd: 3, durationMs: 50 });
  const violations = evaluateBudget(totals, policy, Date.now() - 2000);
  assert.deepEqual(violations.map((item) => item.type).sort(), ["estimated_usd", "tokens", "wall_time_ms"]);
});
