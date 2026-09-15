import { loadModels } from "./config.mjs";
import { applyCcSwitchReasoning, readCcSwitchSnapshotSync } from "./ccswitch.mjs";

/**
 * 有效模型表 —— 思考等级的唯一真源是 cc-switch（用户裁决 2026-09-15）。
 *
 * 规则：cc-switch 纳管的模型，其 reasoning.supported / reasoning.default 以 cc-switch
 * 卡片声明为准；cc-switch 未覆盖的模型（或 cc-switch 不可用/离线）回落到本地
 * config/models.json。返回表额外带 reasoningSources: { [modelId]: "cc-switch" | "local" }。
 *
 * 逃生阀：CODEX_MOA_NO_CCSWITCH=1（测试/离线确定性场景）跳过叠加，纯用本地表。
 */
export function loadEffectiveModels({ snapshot } = {}) {
  const models = loadModels();
  if (process.env.CODEX_MOA_NO_CCSWITCH === "1") return { ...models, reasoningSources: {} };
  try {
    const resolved = snapshot ?? readCcSwitchSnapshotSync();
    if (!resolved?.available) return { ...models, reasoningSources: {} };
    return applyCcSwitchReasoning(models, resolved);
  } catch {
    // 读库失败不得让派活链断掉：静默回落本地表
    return { ...models, reasoningSources: {} };
  }
}

/** 某个模型的等级来源（供结果卡/日志标注"等级取自哪") */
export function reasoningSourceFor(selector, modelsConfig) {
  const sources = modelsConfig?.reasoningSources ?? {};
  const key = String(selector ?? "").trim();
  const aliases = modelsConfig?.aliases ?? {};
  const id = aliases[key] ?? Object.keys(sources).find((candidate) => candidate.toLowerCase() === key.toLowerCase());
  return (id && sources[id]) || "local";
}
