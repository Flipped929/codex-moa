#!/usr/bin/env node
/**
 * codex-moa Skill 与 CC Switch 的对齐检查（只读）
 *
 * 用户裁决 2026-09-15：codex-moa 不写 CC Switch 的配置——包括 ~/.cc-switch/skills。
 * 本脚本只报告当前链接状态与应当怎么做；实际链接请在 CC Switch 界面里启用 Skill。
 */
import { existsSync, lstatSync, readlinkSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { assertCcSwitchReadOnly, readonlyResult } from "../src/lib/ccswitch-readonly.mjs";

const requestedWrite = process.argv.includes("--write");
const source = resolve("skills/moa");
const targetDir = join(homedir(), ".cc-switch", "skills");
const target = join(targetDir, "codex-moa");

if (!existsSync(source)) {
  console.error(`Skill source not found: ${source}`);
  process.exit(1);
}

if (requestedWrite) {
  try {
    assertCcSwitchReadOnly("把 codex-moa Skill 软链进 ~/.cc-switch/skills");
  } catch (error) {
    console.error(error.message);
    process.exit(1);
  }
}

let link = null;
try {
  link = readlinkSync(target);
} catch {
  link = null;
}
const targetExists = (() => {
  try {
    lstatSync(target);
    return true;
  } catch {
    return false;
  }
})();

console.log(JSON.stringify(readonlyResult({
  mode: "read-only",
  source,
  target,
  targetExists,
  linkedTo: link,
  aligned: targetExists && link === source,
  action: targetExists && link === source
    ? "已对齐，无需操作"
    : `请在 CC Switch 界面里启用 codex-moa Skill（目标：${target} → ${source}）`
}), null, 2));
