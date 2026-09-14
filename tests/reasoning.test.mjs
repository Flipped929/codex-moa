import test from "node:test";
import assert from "node:assert/strict";
import { effortForTask, resolveReasoningEffort } from "../src/lib/reasoning.mjs";

const models = {
  models: {
    "kimi-k3": { id: "kimi-k3", reasoning: { supported: ["low", "high", "max"], default: "high" } },
    "kimi-2.8": { id: "kimi-2.8", reasoning: { supported: ["high"], default: "high" } },
    "GLM-5.3": { id: "GLM-5.3", reasoning: { supported: ["low", "high", "max"], default: "max" } },
    "DeepSeek-flash": { id: "DeepSeek-flash", reasoning: { supported: ["off", "low", "high", "max"], default: "high" } }
  },
  aliases: {},
  tiers: {},
  seats: {}
};

test("maps unsupported efforts to nearest supported level", () => {
  assert.equal(resolveReasoningEffort("kimi-2.8", "medium", models), "high");
  assert.equal(resolveReasoningEffort("DeepSeek-flash", "none", models), "off");
  assert.equal(resolveReasoningEffort("GLM-5.3", "xhigh", models), "max");
});

test("selects effort from task level and role", () => {
  assert.equal(effortForTask({ level: "L1", role: "executor" }).effort, "low");
  assert.equal(effortForTask({ level: "L2", role: "auditor", stakes: "medium" }).effort, "high");
  assert.equal(effortForTask({ level: "L3", role: "auditor", stakes: "high" }).effort, "max");
});
