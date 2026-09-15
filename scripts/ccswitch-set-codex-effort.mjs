#!/usr/bin/env node
/**
 * Codex 主模型 reasoning effort 的差异审计（只读）
 *
 * 用户裁决 2026-09-15：cc-switch 是模型与思考等级的唯一出口，codex-moa 不写它的配置。
 * 本脚本只对比"CC Switch 卡声明的值 vs live config.toml 的实际值"，并给出应在 CC Switch 里怎么改。
 */
import { setCodexProviderReasoningEffort } from "../src/lib/ccswitch-effort.mjs";
import { assertCcSwitchReadOnly, CC_SWITCH_READONLY_MESSAGE } from "../src/lib/ccswitch-readonly.mjs";

function readOption(name, fallback) {
  const index = process.argv.indexOf(name);
  return index === -1 ? fallback : process.argv[index + 1];
}

if (process.argv.includes("--write")) {
  try {
    assertCcSwitchReadOnly("写 CC Switch 供应商卡与 live Codex config 的 reasoning effort（--write）");
  } catch (error) {
    console.error(error.message);
    process.exit(1);
  }
}

const providerName = readOption("--provider", "DeepSeek");
const effort = readOption("--effort", "max");
const result = await setCodexProviderReasoningEffort({ providerName, effort, write: false });
console.log(JSON.stringify(result, null, 2));
if (result.providerChanged || result.liveConfigChanged) {
  console.log(`\n${CC_SWITCH_READONLY_MESSAGE}`);
  console.log(`差异：CC Switch 卡内值 -> "${effort}" 尚未生效，或 live config 与卡不一致。请在 CC Switch 里改卡并重新切换一次供应商。`);
}
