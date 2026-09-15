import test from "node:test";
import assert from "node:assert/strict";
import { planMoA } from "../src/lib/router.mjs";

const models = {
  models: {
    "kimi-k3": { id: "kimi-k3", harness: "kimi", supportedHarnesses: ["kimi", "dsh"], providerModel: "kimi-code/k3", dsh: { provider: "kimi-coding", model: "k3" }, tier: "deep", family: "moonshot", reasoning: { supported: ["low", "high", "max"], default: "max" } },
    "kimi-2.8": { id: "kimi-2.8", harness: "kimi", providerModel: "kimi-code/kimi-for-coding", tier: "fast", family: "moonshot", reasoning: { supported: ["low", "high", "max"], default: "max" } },
    "GLM-5.3": { id: "GLM-5.3", harness: "zcode", providerModel: "GLM-5.3", tier: "deep", family: "zhipu", reasoning: { supported: ["low", "high", "max"], default: "max" } },
    "GLM-5.3-flash": { id: "GLM-5.3-flash", harness: "zcode", providerModel: "GLM-5.3-Flash", tier: "fast", family: "zhipu", reasoning: { supported: ["low", "high", "max"], default: "max" } },
    "DeepSeek-flash": { id: "DeepSeek-flash", harness: "dsh", providerModel: "deepseek-flash", tier: "fast", family: "deepseek", reasoning: { supported: ["off", "low", "high", "max"], default: "max" } }
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

test("off mode keeps non-trivial work in the Codex captain", () => {
  const plan = planMoA({ task: "refactor the parser", stakes: "high", orchestrationMode: "off" }, { models, scheduleState });
  assert.equal(plan.level, "L0");
  assert.equal(plan.seats.length, 0);
});

test("force mode delegates an otherwise simple task", () => {
  const plan = planMoA({ task: "explain this function", stakes: "low", orchestrationMode: "force" }, { models, scheduleState });
  assert.equal(plan.level, "L1");
  assert.equal(plan.seats[0].model, "GLM-5.3-flash");
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

test("explicit Kimi assignments may use DeepSeekHarness", () => {
  const plan = planMoA({ task: "research the repository", assignments: [{ model: "kimi-k3", harness: "dsh", role: "researcher" }] }, { models, scheduleState });
  assert.equal(plan.seats[0].harness, "dsh");
  assert.deepEqual(plan.seats[0].dsh, { provider: "kimi-coding", model: "k3" });
});

test("DeepSeek peak pricing keeps DSH but routes routine audit to GLM Flash", () => {
  const peak = { glmNightCampaignActive: false, deepSeekOffPeak: false };
  const plan = planMoA({ task: "refactor the parser", stakes: "medium" }, { models, scheduleState: peak });
  const auditor = plan.seats.find((seat) => seat.role === "auditor");
  assert.equal(auditor.harness, "dsh");
  assert.equal(auditor.model, "GLM-5.3-flash");
  assert.equal(auditor.scheduleAdjusted, true);
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

test("hands-off: seats carry no reasoningEffort unless explicitly requested", () => {
  const plan = planMoA({ task: "refactor the parser", stakes: "high" }, { models, scheduleState });
  assert.ok(plan.seats.length > 0);
  for (const seat of plan.seats) {
    assert.equal(seat.reasoningEffort, undefined, `seat ${seat.seat} must not auto-set effort`);
    assert.equal(seat.reasoningSource, "model-default");
  }
});

test("explicit input reasoningEffort still honored", () => {
  const plan = planMoA({ task: "refactor the parser", stakes: "medium", reasoningEffort: "low" }, { models, scheduleState });
  for (const seat of plan.seats) {
    assert.equal(seat.reasoningEffort, "low");
    assert.equal(seat.reasoningSource, "explicit");
  }
});
