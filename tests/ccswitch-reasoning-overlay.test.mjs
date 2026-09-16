import test from "node:test";
import assert from "node:assert/strict";
import { applyCcSwitchReasoning, ccSwitchReasoningIndex } from "../src/lib/ccswitch.mjs";

// 用户裁决 2026-09-15：cc-switch 是思考等级唯一真源。
// 本测试锁定叠加语义：命中即覆盖 supported/default，未命中回落本地，非法默认值不采用。

function modelsConfig() {
  return {
    models: {
      "GLM-5.3": {
        id: "GLM-5.3",
        displayName: "GLM-5.3",
        providerModel: "GLM-5.3",
        reasoning: { supported: ["low", "high"], default: "high", canDisable: false }
      },
      "DeepSeek-flash": {
        id: "DeepSeek-flash",
        displayName: "DeepSeek V4.1 Flash",
        providerModel: "deepseek-flash",
        reasoning: { supported: ["low", "high", "max"], default: "high", canDisable: false }
      },
      "unmanaged-model": {
        id: "unmanaged-model",
        displayName: "Unmanaged",
        reasoning: { supported: ["low", "high"], default: "low", canDisable: true }
      },
      "broken-model": {
        id: "broken-model",
        displayName: "Broken",
        reasoning: { supported: ["low", "high"], default: "low", canDisable: true }
      },
      "empty-levels-model": {
        id: "empty-levels-model",
        displayName: "EmptyLevels",
        reasoning: { supported: ["low", "high"], default: "low", canDisable: true }
      }
    }
  };
}

function snapshot() {
  return {
    available: true,
    providers: [
      {
        id: "codex-glm",
        appType: "codex",
        name: "Zhipu GLM",
        isCurrent: true,
        models: ["GLM-5.3", "GLM-5.3-flash"],
        modelEntries: [
          { id: "GLM-5.3", name: "GLM-5.3", levels: ["low", "high", "max"], defaultLevel: "max" },
          { id: "GLM-5.3-flash", name: "GLM-5.3-flash", levels: ["low", "high", "max"], defaultLevel: "max" }
        ]
      },
      {
        id: "codex-deepseek",
        appType: "codex",
        name: "DeepSeek",
        isCurrent: false,
        models: ["deepseek-flash"],
        modelEntries: [
          // 只声明档位、不声明默认 → 默认应落到最高档
          { id: "deepseek-flash", name: "deepseek-flash", levels: ["low", "high", "max"], defaultLevel: null }
        ]
      },
      {
        id: "codex-broken",
        appType: "codex",
        name: "Broken",
        isCurrent: false,
        models: ["broken-model", "empty-levels-model"],
        modelEntries: [
          // 默认档位不在档位集合内 → 不得采用，落到最高档
          { id: "broken-model", name: "broken-model", levels: ["low", "high"], defaultLevel: "ultra" },
          // 没有任何档位声明 → 视为未纳管档位，保留本地值
          { id: "empty-levels-model", name: "empty-levels-model", levels: [], defaultLevel: null }
        ]
      }
    ]
  };
}

test("cc-switch 声明的档位与默认档位覆盖本地表", () => {
  const effective = applyCcSwitchReasoning(modelsConfig(), snapshot());
  assert.deepEqual(effective.models["GLM-5.3"].reasoning.supported, ["low", "high", "max"]);
  assert.equal(effective.models["GLM-5.3"].reasoning.default, "max");
  assert.equal(effective.models["GLM-5.3"].reasoning.source, "cc-switch");
  assert.equal(effective.reasoningSources["GLM-5.3"], "cc-switch");
});

test("cc-switch 未声明默认档位时回落该模型最高档", () => {
  const effective = applyCcSwitchReasoning(modelsConfig(), snapshot());
  assert.deepEqual(effective.models["DeepSeek-flash"].reasoning.supported, ["low", "high", "max"]);
  assert.equal(effective.models["DeepSeek-flash"].reasoning.default, "max");
});

test("cc-switch 没纳管的模型保留本地值", () => {
  const effective = applyCcSwitchReasoning(modelsConfig(), snapshot());
  assert.equal(effective.reasoningSources["unmanaged-model"], "local");
  assert.deepEqual(effective.models["unmanaged-model"].reasoning.supported, ["low", "high"]);
  assert.equal(effective.models["unmanaged-model"].reasoning.default, "low");
});

test("非法默认档位不采用，档位为空的模型保留本地值", () => {
  const effective = applyCcSwitchReasoning(modelsConfig(), snapshot());
  const index = ccSwitchReasoningIndex(snapshot(), modelsConfig());
  assert.deepEqual(index["broken-model"].levels, ["low", "high"]);
  assert.equal(index["broken-model"].defaultLevel, "ultra");
  assert.deepEqual(effective.models["broken-model"].reasoning.supported, ["low", "high"]);
  assert.equal(effective.models["broken-model"].reasoning.default, "high");
  // 档位声明为空的模型当作未纳管
  assert.equal(effective.reasoningSources["empty-levels-model"], "local");
  assert.equal(effective.models["empty-levels-model"].reasoning.default, "low");
});

test("cc-switch 不可用时整体回落本地表且不改入参", () => {
  const local = modelsConfig();
  const effective = applyCcSwitchReasoning(local, { available: false });
  assert.equal(effective.reasoningSources["GLM-5.3"], "local");
  assert.deepEqual(effective.models["GLM-5.3"].reasoning.supported, ["low", "high"]);
  assert.deepEqual(local.models["GLM-5.3"].reasoning.supported, ["low", "high"]);
  assert.notEqual(effective.models["GLM-5.3"], local.models["GLM-5.3"]);
});

test("不会合并不同 provider 卡的思考档位", () => {
  const state = snapshot();
  state.providers.unshift({
    id: "codex-glm-current",
    appType: "codex",
    name: "Current GLM",
    isCurrent: true,
    models: ["GLM-5.3"],
    modelEntries: [{ id: "GLM-5.3", name: "GLM-5.3", levels: ["high"], defaultLevel: "high" }]
  });
  const index = ccSwitchReasoningIndex(state, modelsConfig());
  assert.deepEqual(index["GLM-5.3"].levels, ["high"]);
  assert.equal(index["GLM-5.3"].selectedProvider.id, "codex-glm-current");
  assert.ok(index["GLM-5.3"].conflicts.some((provider) => provider.id === "codex-glm"));
});

test("Pi 模型精确采用所配置 provider 的档位、限制和图片能力，DSH 保持独立", () => {
  const local = modelsConfig();
  local.models["GLM-5.3"] = {
    ...local.models["GLM-5.3"],
    harness: "pi",
    pi: { provider: "pi-glm", model: "glm-5.3" },
    capabilities: ["text", "image", "tool-use"],
    limits: { contextWindow: 1000, maxOutputTokens: 100 }
  };
  local.models["DeepSeek-flash"] = {
    ...local.models["DeepSeek-flash"],
    harness: "dsh",
    capabilities: ["text", "image", "audit"],
    limits: { contextWindow: 2000, maxOutputTokens: 200 }
  };
  const state = snapshot();
  state.providers.push(
    {
      id: "pi-glm",
      appType: "pi",
      name: "Pi GLM",
      isCurrent: false,
      models: ["glm-5.3"],
      modelEntries: [{
        id: "glm-5.3",
        name: "glm-5.3",
        levels: ["high"],
        defaultLevel: "high",
        contextWindow: 1048576,
        maxTokens: 131072,
        input: ["text"],
        reasoningEnabled: true
      }]
    },
    {
      id: "pi-deepseek",
      appType: "pi",
      name: "Pi DeepSeek",
      isCurrent: false,
      models: ["deepseek-flash"],
      modelEntries: [{
        id: "deepseek-flash",
        name: "deepseek-flash",
        levels: ["high"],
        defaultLevel: "high",
        contextWindow: 999999,
        maxTokens: 999999,
        input: ["text"],
        reasoningEnabled: true
      }]
    }
  );

  const effective = applyCcSwitchReasoning(local, state);
  const glm = effective.models["GLM-5.3"];
  assert.deepEqual(glm.reasoning.supported, ["high"]);
  assert.equal(glm.reasoning.extendedThinking, true);
  assert.equal(glm.limits.contextWindow, 1048576);
  assert.equal(glm.limits.maxOutputTokens, 131072);
  assert.equal(glm.capabilities.includes("image"), false);
  assert.equal(effective.metadataSources["GLM-5.3"], "cc-switch");

  const deepseek = effective.models["DeepSeek-flash"];
  assert.equal(deepseek.limits.contextWindow, 2000);
  assert.equal(deepseek.limits.maxOutputTokens, 200);
  assert.equal(deepseek.capabilities.includes("image"), true);
  assert.equal(effective.metadataSources["DeepSeek-flash"], "local");
});

test("Pi 卡开启思考但映射为空时使用厂商档位基线", () => {
  const local = modelsConfig();
  local.models["GLM-5.3"] = {
    ...local.models["GLM-5.3"],
    harness: "pi",
    pi: { provider: "pi-glm", model: "glm-5.3" },
    reasoning: {
      supported: ["low", "high", "max"],
      default: "high",
      canDisable: false,
      vendorProfile: { supported: ["high", "max"], default: "max" }
    }
  };
  const state = snapshot();
  state.providers.push({
    id: "pi-glm",
    appType: "pi",
    name: "Pi GLM",
    isCurrent: false,
    models: ["glm-5.3"],
    modelEntries: [{ id: "glm-5.3", name: "glm-5.3", levels: [], defaultLevel: null, reasoningEnabled: true }]
  });
  const effective = applyCcSwitchReasoning(local, state);
  assert.deepEqual(effective.models["GLM-5.3"].reasoning.supported, ["high", "max"]);
  assert.equal(effective.models["GLM-5.3"].reasoning.default, "max");
  assert.equal(effective.reasoningSources["GLM-5.3"], "cc-switch+vendor");
});
