import test from "node:test";
import assert from "node:assert/strict";
import { applyProviderHealthRouting, summarizeProviderHealth } from "../src/lib/provider-health.mjs";

const models = {
  models: {
    "GLM-5.3": { id: "GLM-5.3", harness: "zcode", providerModel: "GLM-5.3", tier: "deep", family: "zhipu", capabilities: ["text"] },
    "kimi-k3": { id: "kimi-k3", harness: "kimi", providerModel: "kimi-code/k3", tier: "deep", family: "moonshot", capabilities: ["text"] },
    "DeepSeek-flash": { id: "DeepSeek-flash", harness: "dsh", providerModel: "deepseek-flash", tier: "fast", family: "deepseek", capabilities: ["text"] }
  }, aliases: {}, tiers: {}, seats: {}
};

test("reroutes an automatic seat away from a critical provider", () => {
  const seats = [{ seat: "executor", role: "executor", harness: "zcode", model: "GLM-5.3", providerModel: "GLM-5.3", modelTier: "deep", family: "zhipu" }];
  const health = { providers: { zai: { status: "critical" }, kimi: { status: "healthy" }, deepseek: { status: "healthy" } } };
  const result = applyProviderHealthRouting(seats, { health, modelsConfig: models });
  assert.equal(result.blocked.length, 0);
  assert.equal(result.adjustments[0].action, "rerouted");
  assert.equal(seats[0].model, "kimi-k3");
  assert.equal(seats[0].harness, "kimi");
});

test("blocks when no healthy replacement exists", () => {
  const seats = [{ seat: "executor", role: "executor", harness: "zcode", model: "GLM-5.3", providerModel: "GLM-5.3", modelTier: "deep", family: "zhipu" }];
  const health = { providers: { zai: { status: "critical" }, kimi: { status: "critical" }, deepseek: { status: "critical" } } };
  const result = applyProviderHealthRouting(seats, { health, modelsConfig: models });
  assert.equal(result.blocked.length, 1);
  assert.equal(result.adjustments.length, 0);
});

test("summarizes provider health from quota and recent cost failures", () => {
  const snapshot = { updatedAt: new Date().toISOString(), providers: { kimi: { status: "ok", windows: [] }, zai: { status: "rate_limited", windows: [] }, deepseek: { status: "not_configured", windows: [] } } };
  const health = summarizeProviderHealth({ snapshot, ledger: [] });
  assert.equal(health.providers.zai.status, "critical");
  assert.equal(health.providers.deepseek.status, "inactive");
});
