import { loadModels } from "./config.mjs";
import { applyCcSwitchReasoning, readCcSwitchSnapshotSync } from "./ccswitch.mjs";

/**
 * 有效模型表 —— CC Switch 是 Pi 模型运行元数据的唯一真源。
 *
 * 规则：Pi 模型按 model.pi.provider/model 精确采用 CC Switch 卡片中的思考、
 * 上下文、输出与图片输入元数据；DSH 独立，不读取 CC Switch 的同名卡片。
 * CC Switch 不可用或未覆盖时回落 config/models.json。
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
