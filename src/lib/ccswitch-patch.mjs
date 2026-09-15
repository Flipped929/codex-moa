import { existsSync, readFileSync } from "node:fs";
import { copyFile, mkdir, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { assertCcSwitchReadOnly, readonlyResult } from "./ccswitch-readonly.mjs";

function expandHome(value) {
  if (typeof value !== "string") return value;
  if (value === "~") return homedir();
  if (value.startsWith("~/")) return resolve(homedir(), value.slice(2));
  return resolve(value);
}

// Compatibility entries are fill-only. GLM-5.3-flash is intentionally kept
// even when current upstream presets omit it; this patch never removes models.
const CODEX_PATCHES = {
  "Kimi For Coding": {
    "k3": { reasoningLevels: ["low", "high", "max"], defaultReasoningLevel: "high" },
    "kimi-for-coding": { reasoningLevels: ["low", "high", "max"], defaultReasoningLevel: "max" }
  },
  "Zhipu GLM": {
    "glm-5.3": { reasoningLevels: ["low", "high", "max"], defaultReasoningLevel: "max" },
    "glm-5.3-flash": { reasoningLevels: ["low", "high", "max"], defaultReasoningLevel: "max" }
  },
  "DeepSeek": {
    "deepseek-flash": { reasoningLevels: ["none", "low", "high", "max"], defaultReasoningLevel: "high" }
  }
};

const PI_LIMITS = {
  "k3": { contextWindow: 1048576, maxTokens: 131072 },
  "kimi-for-coding": { contextWindow: 1048576, maxTokens: 131072 },
  "glm-5.3": { contextWindow: 1000000, maxTokens: 128000 },
  "glm-5.3-flash": { contextWindow: 1000000, maxTokens: 128000 },
  "deepseek-v4-flash": { contextWindow: 1000000, maxTokens: 384000 },
  "deepseek-v4-pro": { contextWindow: 1000000, maxTokens: 384000 },
  "deepseek-v4-flash-vision-exp": { contextWindow: 1000000, maxTokens: 384000 }
};

const PI_THINKING_LEVELS = {
  "k3": { low: "low", high: "high", max: "max" },
  "kimi-k3": { low: "low", high: "high", max: "max" },
  "kimi-for-coding": { low: "low", high: "high", max: "max" },
  "glm-5.3": { low: "low", high: "high", max: "max" },
  "glm-5.3-flash": { low: "low", high: "high", max: "max" },
  "deepseek-v4-flash": { off: "off", low: "low", high: "high", max: "max" },
  "deepseek-v4-pro": { off: "off", low: "low", high: "high", max: "max" },
  "deepseek-v4-flash-vision-exp": { off: "off", low: "low", high: "high", max: "max" }
};

function object(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}

function isMissing(value) {
  return value === undefined || value === null || (typeof value === "string" && value.trim() === "");
}

function mergeReasoningLevels(current, canonical) {
  const existing = Array.isArray(current) ? current.filter((level) => typeof level === "string" && level) : [];
  const missing = canonical.filter((level) => !existing.includes(level));
  return [...existing, ...missing];
}

function mergeReasoningCatalogLevels(current, canonical) {
  const existing = Array.isArray(current)
    ? current.filter((level) => level && typeof level === "object" && typeof level.effort === "string")
    : [];
  const efforts = new Set(existing.map((level) => level.effort));
  return [...existing, ...canonical.filter((level) => !efforts.has(level.effort))];
}

export function patchProviderConfig(appType, name, raw, rawMeta = null) {
  const config = JSON.parse(raw || "{}");
  let changed = false;
  const meta = rawMeta === null ? null : JSON.parse(rawMeta || "{}");
  if (appType === "codex") {
    const patches = CODEX_PATCHES[name];
    if (patches && Array.isArray(config.modelCatalog?.models)) {
      for (const model of config.modelCatalog.models) {
        const patch = patches[model.model];
        if (!patch) continue;
        const levels = mergeReasoningLevels(model.reasoningLevels, patch.reasoningLevels ?? []);
        if (JSON.stringify(levels) !== JSON.stringify(model.reasoningLevels)) {
          model.reasoningLevels = levels;
          changed = true;
        }
        if (isMissing(model.defaultReasoningLevel) && patch.defaultReasoningLevel) {
          model.defaultReasoningLevel = patch.defaultReasoningLevel;
          changed = true;
        }
      }
    }
  } else if (appType === "pi") {
    for (const model of Array.isArray(config.models) ? config.models : []) {
      const levels = PI_THINKING_LEVELS[model.id];
      if (!levels) continue;
      if (model.reasoning === undefined || model.reasoning === null) {
        model.reasoning = true;
        changed = true;
      }
      const currentLevels = object(model.thinkingLevelMap);
      const missingLevels = Object.fromEntries(Object.entries(levels).filter(([key]) => !(key in currentLevels)));
      if (Object.keys(missingLevels).length > 0) {
        model.thinkingLevelMap = { ...currentLevels, ...missingLevels };
        changed = true;
      }
      const limits = PI_LIMITS[model.id];
      if (limits) {
        for (const [key, value] of Object.entries(limits)) {
          if (isMissing(model[key])) {
            model[key] = value;
            changed = true;
          }
        }
      }
    }
  }
  return {
    changed,
    raw: changed ? JSON.stringify(config) : raw,
    config,
    metaChanged: false,
    metaRaw: rawMeta,
    meta
  };
}

async function openDatabase(dbPath) {
  const { DatabaseSync } = await import("node:sqlite");
  const db = new DatabaseSync(dbPath);
  db.exec("PRAGMA busy_timeout = 10000");
  return db;
}

const CATALOG_PATCHES = {
  "deepseek-flash": {
    levels: [
      { description: "Disable Thinking", effort: "none" },
      { description: "Low Thinking", effort: "low" },
      { description: "Enabled Thinking", effort: "high" },
      { description: "Maximum Thinking", effort: "max" }
    ],
    default: "high"
  },
  "glm-5.3": {
    levels: [
      { description: "Low Thinking", effort: "low" },
      { description: "Enabled Thinking", effort: "high" },
      { description: "Maximum Thinking", effort: "max" }
    ],
    default: "max"
  },
  "glm-5.3-flash": {
    levels: [
      { description: "Low Thinking", effort: "low" },
      { description: "Enabled Thinking", effort: "high" },
      { description: "Maximum Thinking", effort: "max" }
    ],
    default: "max"
  }
};

export function patchCodexCatalog(raw) {
  const catalog = JSON.parse(raw || "{}");
  let changed = false;
  for (const model of Array.isArray(catalog.models) ? catalog.models : []) {
    const patch = CATALOG_PATCHES[model.slug];
    if (!patch) continue;
    const levels = mergeReasoningCatalogLevels(model.supported_reasoning_levels, patch.levels);
    if (JSON.stringify(levels) !== JSON.stringify(model.supported_reasoning_levels)) {
      model.supported_reasoning_levels = levels;
      changed = true;
    }
    if (isMissing(model.default_reasoning_level)) {
      model.default_reasoning_level = patch.default;
      changed = true;
    }
  }
  return { changed, raw: changed ? JSON.stringify(catalog, null, 2) + "\n" : raw };
}

async function patchCatalog({ catalogPath, write, backupRoot, stamp }) {
  if (!existsSync(catalogPath)) return { path: catalogPath, exists: false, changed: false, backup: null };
  const raw = readFileSync(catalogPath, "utf8");
  const patched = patchCodexCatalog(raw);
  if (!patched.changed || !write) return { path: catalogPath, exists: true, changed: patched.changed, backup: null };
  const backup = join(backupRoot, `codex-model-catalog-${stamp}.json`);
  await copyFile(catalogPath, backup);
  await writeFile(catalogPath, patched.raw, "utf8");
  return { path: catalogPath, exists: true, changed: true, backup };
}

export async function applyReasoningPatch({ databasePath = expandHome("~/.cc-switch/cc-switch.db"), codexCatalogPath = expandHome("~/.codex/cc-switch-model-catalog.json"), write = false, backupRoot = expandHome("~/.codex-moa/backups/cc-switch") } = {}) {
  if (!existsSync(databasePath)) throw new Error(`cc-switch database not found: ${databasePath}`);
  const db = await openDatabase(databasePath);
  const rows = db.prepare("SELECT id, app_type, name, settings_config FROM providers ORDER BY app_type, name").all();
  const changes = [];
  for (const row of rows) {
    const patched = patchProviderConfig(row.app_type, row.name, row.settings_config);
    if (patched.changed) {
      changes.push({
        id: row.id,
        appType: row.app_type,
        name: row.name,
        raw: patched.raw,
        config: patched.config,
        configChanged: true
      });
    }
  }
  // 写模式已被用户裁决禁掉（codex-moa 不写 CC Switch）：只保留只读审计
  if (write) {
    db.close();
    assertCcSwitchReadOnly("补写 CC Switch 供应商卡的 reasoning/limits 元数据与 codex catalog");
  }
  db.close();
  const catalog = await patchCatalog({ catalogPath: codexCatalogPath, write: false, backupRoot, stamp: null });
  return readonlyResult({
    write: false,
    changed: changes.length,
    changes: changes.map(({ raw, config, ...change }) => change),
    catalog: { ...catalog, raw: undefined },
    note: "只读审计：实际修改请在 CC Switch 里操作"
  });
}
