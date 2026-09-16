import test from "node:test";
import assert from "node:assert/strict";
import { planMoA } from "../src/lib/router.mjs";

const models = {
  models: {
    "kimi-k3": { id: "kimi-k3", harness: "pi", supportedHarnesses: ["kimi", "pi", "dsh"], providerModel: "kimi-code/k3", pi: { provider: "cc-switch-kimi-for-coding", model: "k3" }, dsh: { provider: "kimi-coding", model: "k3" }, tier: "deep", family: "moonshot", reasoning: { supported: ["low", "high", "max"], default: "max" } },
    "kimi-2.8": { id: "kimi-2.8", harness: "pi", supportedHarnesses: ["kimi", "pi", "dsh"], providerModel: "kimi-code/kimi-for-coding", pi: { provider: "cc-switch-kimi-for-coding", model: "kimi-for-coding" }, tier: "fast", family: "moonshot", reasoning: { supported: ["low", "high", "max"], default: "max" } },
    "GLM-5.3": { id: "GLM-5.3", harness: "pi", supportedHarnesses: ["zcode", "pi", "dsh"], providerModel: "GLM-5.3", pi: { provider: "cc-switch-zhipu-glm", model: "glm-5.3" }, tier: "deep", family: "zhipu", reasoning: { supported: ["low", "high", "max"], default: "max" } },
    "GLM-5.3-flash": { id: "GLM-5.3-flash", harness: "pi", supportedHarnesses: ["zcode", "pi", "dsh"], providerModel: "GLM-5.3-Flash", pi: { provider: "cc-switch-zhipu-glm", model: "glm-5.3-flash" }, tier: "fast", family: "zhipu", reasoning: { supported: ["low", "high", "max"], default: "max" } },
    "DeepSeek-flash": { id: "DeepSeek-flash", harness: "dsh", supportedHarnesses: ["dsh", "pi"], providerModel: "deepseek-flash", pi: { provider: "deepseek", model: "deepseek-flash" }, dsh: { provider: "deepseek-official", model: "deepseek-flash" }, tier: "fast", family: "deepseek", reasoning: { supported: ["off", "low", "high", "max"], default: "max" } }
  },
  aliases: {},
  tiers: {
    fast: { kimi: "kimi-2.8", pi: "kimi-2.8", zcode: "GLM-5.3-flash", dsh: "DeepSeek-flash" },
    deep: { kimi: "kimi-k3", pi: "kimi-k3", zcode: "GLM-5.3", dsh: "DeepSeek-flash" }
  },
  seats: {
    "pi-executor-fast": { harness: "pi", modelTier: "fast", mode: "edit", role: "executor" },
    "pi-executor-deep": { harness: "pi", modelTier: "deep", mode: "build", role: "executor" },
    "pi-glm-executor-fast": { harness: "pi", model: "GLM-5.3-flash", modelTier: "fast", mode: "edit", role: "executor" },
    "pi-glm-executor-deep": { harness: "pi", model: "GLM-5.3", modelTier: "deep", mode: "build", role: "executor" },
    "zcode-executor-fast": { harness: "zcode", modelTier: "fast", mode: "edit", role: "executor" },
    "zcode-executor-deep": { harness: "zcode", modelTier: "deep", mode: "build", role: "executor" },
    "kimi-architect": { harness: "pi", model: "kimi-k3", modelTier: "deep", mode: "plan", role: "architect" },
    "kimi-vision": { harness: "pi", model: "kimi-k3", modelTier: "deep", mode: "plan", role: "vision" },
    "dsh-auditor-fast": { harness: "dsh", modelTier: "fast", mode: "plan", role: "auditor" },
    "dsh-auditor-deep": { harness: "dsh", modelTier: "deep", mode: "plan", role: "auditor" }
  }
};

const scheduleState = {
  glmNightCampaignActive: true,
  deepSeekOffPeak: true
};

test("simple task stays in an opaque or non-GPT captain", () => {
  const plan = planMoA({ task: "explain this function", stakes: "low" }, { models, scheduleState });
  assert.equal(plan.level, "L0");
  assert.equal(plan.seats.length, 0);
});

test("does not infer the page captain from the global OpenAI provider card", () => {
  const plan = planMoA({ task: "explain this function", stakes: "low", captain: { family: "unknown", provider: { name: "OpenAI Official" } } }, { models, scheduleState });
  assert.equal(plan.level, "L0");
  assert.equal(plan.seats.length, 0);
});

test("confirmed GPT captain delegates simple execution while retaining control", () => {
  const plan = planMoA({ task: "explain this function", stakes: "low", captain: { family: "openai", model: "gpt-6-astra" } }, { models, scheduleState });
  assert.equal(plan.level, "L1");
  assert.equal(plan.seats.length, 1);
  assert.equal(plan.seats[0].role, "executor");
  assert.equal(plan.seats[0].model, "kimi-2.8");
  assert.equal(plan.captainDelegation.simpleDelegated, true);
  assert.equal(plan.captainDelegation.classifiedLevel, "L0");
});

test("off mode keeps a simple task in the GPT captain", () => {
  const plan = planMoA({ task: "explain this function", stakes: "low", orchestrationMode: "off", captain: { family: "openai" } }, { models, scheduleState });
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
  assert.equal(plan.seats[0].model, "kimi-2.8");
  assert.equal(plan.seats[0].harness, "pi");
});

test("complex task uses a complementary subscription audit gate", () => {
  const plan = planMoA({ task: "refactor the parser", stakes: "medium" }, { models, scheduleState });
  assert.equal(plan.level, "L2");
  assert.deepEqual(plan.seats.map((seat) => seat.seat), ["pi-glm-executor-deep", "cross-family-auditor-gate"]);
  assert.equal(plan.seats[0].harness, "pi");
  assert.equal(plan.seats[1].model, "kimi-2.8");
  assert.equal(plan.seats[1].auditMode, "gate");
});

test("L3 implementation keeps core execution in the page captain", () => {
  const plan = planMoA({ task: "implement a multi-model real-time safety cascade", stakes: "high", captain: { family: "openai", model: "gpt-6-astra" } }, { models, scheduleState });
  assert.equal(plan.level, "L3");
  assert.deepEqual(plan.seats.map((seat) => seat.seat), ["kimi-architect", "dsh-auditor-deep"]);
  assert.equal(plan.seats.some((seat) => seat.role === "executor"), false);
  assert.equal(plan.executionPolicy.owner, "captain");
  assert.equal(plan.executionPolicy.requiresForegroundCaptain, true);
  assert.equal(plan.executionPolicy.quotaMayChangeCoreOwnership, false);
  assert.equal(plan.executionPolicy.dispatchBlocked, false);
});

test("explicit L3 executor assignments are blocked unless core delegation is deliberate", () => {
  const blocked = planMoA({
    task: "implement a multi-model real-time safety cascade",
    stakes: "high",
    assignments: [{ model: "GLM-5.3", role: "executor", mode: "build" }]
  }, { models, scheduleState });
  assert.equal(blocked.level, "explicit");
  assert.equal(blocked.executionPolicy.owner, "captain");
  assert.equal(blocked.executionPolicy.dispatchBlocked, true);
  assert.equal(blocked.executionPolicy.blockCode, "CAPTAIN_PRIMARY_REQUIRED");

  const hybrid = planMoA({
    task: "implement a bounded module for a multi-model real-time safety cascade",
    stakes: "high",
    executionOwner: "hybrid",
    assignments: [{ model: "GLM-5.3", role: "executor", mode: "build" }]
  }, { models, scheduleState });
  assert.equal(hybrid.executionPolicy.owner, "hybrid");
  assert.equal(hybrid.executionPolicy.dispatchBlocked, false);
});

test("deliberate hybrid L3 routing retains subscription gate and DeepSeek shadow", () => {
  const plan = planMoA({ task: "review authentication migration", stakes: "high", executionOwner: "hybrid" }, { models, scheduleState });
  assert.equal(plan.level, "L3");
  assert.deepEqual(plan.seats.map((seat) => seat.seat), ["pi-glm-executor-deep", "kimi-architect", "cross-family-auditor-gate", "deepseek-auditor-shadow"]);
  assert.deepEqual(plan.seats.slice(0, 2).map((seat) => seat.harness), ["pi", "pi"]);
  assert.equal(plan.seats[2].model, "kimi-k3");
  assert.equal(plan.seats[3].auditMode, "shadow");
  assert.equal(plan.seats[3].blocking, false);
  assert.deepEqual(plan.graph.layers.at(-1), ["cross-family-auditor-gate", "deepseek-auditor-shadow"]);
});

test("L3 with a known non-GPT captain recommends GPT without switching models", () => {
  const plan = planMoA({ task: "implement a production safety architecture", stakes: "high", captain: { family: "moonshot", model: "kimi-k3" } }, { models, scheduleState });
  assert.equal(plan.executionPolicy.owner, "captain");
  assert.match(plan.executionPolicy.recommendation, /GPT\/OpenAI/);
  assert.equal(plan.captain.model, "kimi-k3");
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
  assert.deepEqual(plan.seats.map((seat) => seat.harness), ["pi", "pi", "dsh"]);
  assert.deepEqual(plan.seats.map((seat) => seat.model), ["kimi-k3", "GLM-5.3", "DeepSeek-flash"]);
});

test("explicit Kimi assignments may use DeepSeekHarness", () => {
  const plan = planMoA({ task: "research the repository", assignments: [{ model: "kimi-k3", harness: "dsh", role: "researcher" }] }, { models, scheduleState });
  assert.equal(plan.seats[0].harness, "dsh");
  assert.deepEqual(plan.seats[0].dsh, { provider: "kimi-coding", model: "k3" });
});

test("explicit Kimi assignments may use Pi", () => {
  const plan = planMoA({ task: "research the repository", assignments: [{ model: "kimi-k3", harness: "pi", role: "researcher" }] }, { models, scheduleState });
  assert.equal(plan.seats[0].harness, "pi");
  assert.deepEqual(plan.seats[0].pi, { provider: "cc-switch-kimi-for-coding", model: "k3" });
});

test("explicit DeepSeek assignments may use Pi", () => {
  const plan = planMoA({
    task: "review the implementation",
    assignments: [{ model: "DeepSeek-flash", harness: "pi", role: "reviewer" }]
  }, { models, scheduleState });
  assert.equal(plan.seats[0].harness, "pi");
  assert.deepEqual(plan.seats[0].pi, { provider: "deepseek", model: "deepseek-flash" });
});

test("subscription balancing routes an eligible GLM executor to Kimi through Pi", () => {
  const quotaSnapshot = {
    providers: {
      kimi: { status: "ok", windows: [{ kind: "weekly", remainingPercent: 98 }] },
      zai: { status: "ok", windows: [{ kind: "weekly", remainingPercent: 70 }] }
    }
  };
  const plan = planMoA({ task: "refactor the parser", stakes: "medium" }, {
    models,
    scheduleState: { ...scheduleState, glmNightCampaignActive: false },
    quotaSnapshot
  });
  const executor = plan.seats.find((seat) => seat.role === "executor");
  assert.equal(executor.model, "kimi-k3");
  assert.equal(executor.harness, "pi");
  assert.equal(executor.quotaBalanced, true);
});

test("GLM uses Pi even while the legacy ZCode campaign is active", () => {
  const quotaSnapshot = {
    providers: {
      kimi: { status: "ok", windows: [{ kind: "weekly", remainingPercent: 99 }] },
      zai: { status: "ok", windows: [{ kind: "weekly", remainingPercent: 70 }] }
    }
  };
  const plan = planMoA({ task: "refactor the parser", stakes: "medium" }, { models, scheduleState, quotaSnapshot });
  const executor = plan.seats.find((seat) => seat.role === "executor");
  assert.equal(executor.model, "GLM-5.3");
  assert.equal(executor.harness, "pi");
});

test("DeepSeek peak pricing keeps the subscription gate and lowers shadow sampling", () => {
  const peak = { glmNightCampaignActive: false, deepSeekOffPeak: false };
  const plan = planMoA({ task: "refactor the parser", stakes: "medium" }, { models, scheduleState: peak });
  const auditor = plan.seats.find((seat) => seat.role === "auditor");
  assert.equal(auditor.harness, "pi");
  assert.equal(auditor.model, "kimi-2.8");
  assert.equal(plan.auditStrategy.shadowSampleRate, 0.25);
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
  assert.equal(auditor.model, "kimi-2.8");
  assert.equal(auditor.harness, "pi");
  assert.notEqual(models.models[auditor.model].family, "deepseek");
});

test("task-aware mode selects and clamps reasoning effort", () => {
  const plan = planMoA({ task: "refactor the parser", stakes: "high" }, { models, scheduleState });
  assert.ok(plan.seats.length > 0);
  for (const seat of plan.seats) {
    assert.equal(seat.reasoningEffort, "max");
    assert.ok(["task-policy", "vendor-profile"].includes(seat.reasoningSource));
  }
});

test("provider-default mode leaves reasoning effort to the harness", () => {
  const policy = { reasoning: { mode: "provider-default" } };
  const plan = planMoA({ task: "refactor the parser", stakes: "high" }, { models, scheduleState, policy });
  for (const seat of plan.seats) {
    assert.equal(seat.reasoningEffort, undefined);
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
