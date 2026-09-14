import test from "node:test";
import assert from "node:assert/strict";
import { budgetForTask } from "../src/lib/limits.mjs";

const models = {
  models: {
    "kimi-k3": { id: "kimi-k3", limits: { contextWindow: 1048576, maxOutputTokens: 131072, recommendedContextTokens: 262144, recommendedOutputTokens: 16384 } },
    "DeepSeek-flash": { id: "DeepSeek-flash", limits: { contextWindow: 1000000, maxOutputTokens: 384000, recommendedContextTokens: 262144, recommendedOutputTokens: 32768 } }
  },
  aliases: {},
  tiers: {},
  seats: {}
};

test("uses balanced task budgets by default", () => {
  const budget = budgetForTask({ selector: "kimi-k3", level: "L2", role: "executor" }, models);
  assert.equal(budget.contextBudget, 524288);
  assert.equal(budget.outputBudget, 32768);
  assert.equal(budget.source, "task-policy");
});

test("max mode exposes full model capability", () => {
  const budget = budgetForTask({ selector: "DeepSeek-flash", level: "L1", role: "executor", limitMode: "max" }, models);
  assert.equal(budget.contextBudget, 1000000);
  assert.equal(budget.outputBudget, 384000);
});
