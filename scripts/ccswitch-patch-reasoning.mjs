#!/usr/bin/env node
/**
 * CC Switch 推理元数据审计（只读）
 *
 * 用户裁决 2026-09-15：codex-moa 不写 CC Switch 的配置。
 * 本脚本只报告"缺哪些字段、建议在 CC Switch 里怎么填"，写入请到 CC Switch 界面。
 */
import { applyReasoningPatch } from "../src/lib/ccswitch-patch.mjs";
import { assertCcSwitchReadOnly, CC_SWITCH_READONLY_MESSAGE } from "../src/lib/ccswitch-readonly.mjs";

if (process.argv.includes("--write")) {
  try {
    assertCcSwitchReadOnly("补写 CC Switch 供应商卡元数据（--write）");
  } catch (error) {
    console.error(error.message);
    process.exit(1);
  }
}

const result = await applyReasoningPatch({ write: false });
console.log(JSON.stringify(result, null, 2));
if (result.changed > 0) {
  console.log(`\n${CC_SWITCH_READONLY_MESSAGE}`);
  console.log("上面每一张卡的缺失字段，请在 CC Switch 界面里补；补完再跑一次本审计确认。");
}
