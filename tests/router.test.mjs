import test from "node:test";
import assert from "node:assert/strict";
import { planMoA } from "../src/lib/router.mjs";

const models = {
  models: {
    "kimi-k3": { id: "kimi-k3", harness: "kimi", providerModel: "kimi-code/k3", tier: "deep", family: "moonshot" },
    "kimi-2.8": { id: "kimi-2.8", harness: "kimi", providerModel: "kimi-code/kimi-for-coding", tier: "fast", family: "moonshot" },
    "GLM-5.3": { id: "GLM-5.3", harness: "zcode", providerModel: "GLM-5.3", tier: "deep", family: "zhipu" },
    "GLM-5.3-flash": { id: "GLM-5.3-flash", harness: "zcode", providerModel: "GLM-5.3-Flash", tier: "fast", family: "zhipu" },
    "DeepSeek-flash": { id: "DeepSeek-flash", harness: "dsh", providerModel: "deepseek-flash", tier: "fast", family: "deepseek" }
  },
  aliases: {},
  tiers: {
    fast: { kimi: "kimi-2.8", zcode: "GLM-5.3-flash", dsh: "DeepSeek-flash" },
    deep: { kimi: "kimi-k3", zcode: "GLM-5.3", dsh: "DeepSeek-flash" }
  },
  seats: {
    "zcode-executor-fast": { harness: "zcode", modelTier: "fast", mode: "edit", role: "executor" },
    "zcode-executor-deep": { harness: "zcode", modelTier: "deep", mode: "build", role: "executor" },
    "kimi-architect": { harness: "kimi", modelTier: "deep", mode: "plan", role: "architect" },
    "kimi-vision": { harness: "kimi", modelTier: "deep", mode: "plan", role: "vision" },
    "dsh-auditor-fast": { harness: "dsh", modelTier: "fast", mode: "plan", role: "auditor" },
    "dsh-auditor-deep": { harness: "dsh", modelTier: "deep", mode: "plan", role: "auditor" }
  }
};

const scheduleState = {
  glmNightCampaignActive: true,
  deepSeekOffPeak: true
};

test("simple task stays in Codex", () => {
  const plan = planMoA({ task: "explain this function", stakes: "low" }, { models, scheduleState });
  assert.equal(plan.level, "L0");
  assert.equal(plan.seats.length, 0);
});

test("complex task uses DeepSeekHarness audit", () => {
  const plan = planMoA({ task: "refactor the parser", stakes: "medium" }, { models, scheduleState });
  assert.equal(plan.level, "L2");
  assert.deepEqual(plan.seats.map((seat) => seat.seat), ["zcode-executor-deep", "dsh-auditor-fast"]);
});

test("high-risk task uses Kimi architecture and deep DSH audit", () => {
  const plan = planMoA({ task: "review authentication migration", stakes: "high" }, { models, scheduleState });
  assert.equal(plan.level, "L3");
  assert.deepEqual(plan.seats.map((seat) => seat.seat), ["zcode-executor-deep", "kimi-architect", "dsh-auditor-deep"]);
});

test("vision flag adds Kimi vision seat", () => {
  const plan = planMoA({ task: "fix the UI", stakes: "medium", vision: true }, { models, scheduleState });
  assert.ok(plan.seats.some((seat) => seat.seat === "kimi-vision"));
});

test("explicit assignments map models to harnesses", () => {
  const plan = planMoA({
    task: "review this migration",
    assignments: [
      { model: "kimi-k3", role: "architect", mode: "plan" },
      { model: "GLM-5.3", role: "executor", mode: "build" },
      { model: "DeepSeek-flash", role: "auditor", mode: "plan" }
    ]
  }, { models, scheduleState });
  assert.equal(plan.level, "explicit");
  assert.deepEqual(plan.seats.map((seat) => seat.harness), ["kimi", "zcode", "dsh"]);
  assert.deepEqual(plan.seats.map((seat) => seat.model), ["kimi-k3", "GLM-5.3", "DeepSeek-flash"]);
});

test("auto audit routing avoids the captain family", () => {
  const policy = {
    audit: {
      avoidCaptainFamily: true,
      preferredByCaptainFamily: {
        deepseek: ["GLM-5.3", "kimi-k3"]
      }
    },
    timeouts: { fastMs: 1000, deepMs: 2000 }
  };
  const plan = planMoA({
    task: "refactor the parser",
    stakes: "medium",
    captain: { family: "deepseek" }
  }, { models, scheduleState, policy });
  const auditor = plan.seats.find((seat) => seat.role === "auditor");
  assert.equal(auditor.model, "GLM-5.3");
  assert.equal(auditor.harness, "zcode");
  assert.equal(auditor.evolutionAdjusted, true);
});
