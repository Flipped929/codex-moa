import { existsSync, readFileSync } from "node:fs";
import { copyFile, mkdir, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { assertCcSwitchReadOnly, readonlyResult } from "./ccswitch-readonly.mjs";

const REASONING_EFFORTS = new Set(["none", "low", "medium", "high", "xhigh", "max"]);

function expandHome(value) {
  if (typeof value !== "string") return value;
  if (value === "~") return homedir();
  if (value.startsWith("~/")) return resolve(homedir(), value.slice(2));
  return resolve(value);
}

function replaceTomlAssignment(text, key, value) {
  const escaped = String(key).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const pattern = new RegExp(`^(\\s*${escaped}\\s*=\\s*)["'][^"']*["']`, "m");
  if (pattern.test(text)) return text.replace(pattern, `$1"${value}"`);
  return `${String(text ?? "").replace(/\s*$/, "")}\n${key} = "${value}"\n`;
}

export function patchCodexReasoningEffort(raw, effort) {
  if (!REASONING_EFFORTS.has(effort)) throw new Error(`unsupported reasoning effort: ${effort}`);
  const settings = JSON.parse(raw || "{}");
  if (typeof settings.config !== "string") throw new Error("provider config has no TOML text");
  const config = replaceTomlAssignment(settings.config, "model_reasoning_effort", effort);
  return {
    changed: config !== settings.config,
    raw: JSON.stringify({ ...settings, config }),
    settings: { ...settings, config }
  };
}

export function patchCodexLiveReasoningEffort(raw, effort) {
  if (!REASONING_EFFORTS.has(effort)) throw new Error(`unsupported reasoning effort: ${effort}`);
  const config = replaceTomlAssignment(String(raw ?? ""), "model_reasoning_effort", effort);
  return { changed: config !== raw, raw: config };
}

async function openDatabase(dbPath) {
  const { DatabaseSync } = await import("node:sqlite");
  const db = new DatabaseSync(dbPath);
  db.exec("PRAGMA busy_timeout = 10000");
  return db;
}

export async function setCodexProviderReasoningEffort({
  providerName = "DeepSeek",
  effort,
  databasePath = expandHome("~/.cc-switch/cc-switch.db"),
  codexConfigPath = expandHome("~/.codex/config.toml"),
  write = false,
  backupRoot = expandHome("~/.codex-moa/backups/cc-switch")
} = {}) {
  if (!REASONING_EFFORTS.has(effort)) throw new Error(`unsupported reasoning effort: ${effort}`);
  if (!existsSync(databasePath)) throw new Error(`cc-switch database not found: ${databasePath}`);
  if (!existsSync(codexConfigPath)) throw new Error(`Codex config not found: ${codexConfigPath}`);

  const db = await openDatabase(databasePath);
  const row = db.prepare("SELECT id, settings_config FROM providers WHERE app_type = ? AND name = ?").get("codex", providerName);
  if (!row) {
    db.close();
    throw new Error(`Codex provider not found: ${providerName}`);
  }
  const patchedProvider = patchCodexReasoningEffort(row.settings_config, effort);
  const patchedLive = patchCodexLiveReasoningEffort(readFileSync(codexConfigPath, "utf8"), effort);
  // 写模式已被用户裁决禁掉（codex-moa 不写 CC Switch）：只保留只读 diff
  if (write) {
    db.close();
    assertCcSwitchReadOnly(`设置 ${providerName} 卡的 reasoning effort 并回写 live config`);
  }
  db.close();
  return readonlyResult({
    write: false,
    provider: providerName,
    effort,
    providerChanged: patchedProvider.changed,
    liveConfigChanged: patchedLive.changed,
    note: "只读审计：实际修改请在 CC Switch 里操作"
  });
}
