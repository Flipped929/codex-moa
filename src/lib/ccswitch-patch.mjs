import { existsSync, readFileSync } from "node:fs";
import { copyFile, mkdir, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join, resolve } from "node:path";

function expandHome(value) {
  if (typeof value !== "string") return value;
  if (value === "~") return homedir();
  if (value.startsWith("~/")) return resolve(homedir(), value.slice(2));
  return resolve(value);
}

const CODEX_PATCHES = {
  "Zhipu GLM": {
    "glm-5.3": { reasoningLevels: ["low", "high", "max"], defaultReasoningLevel: "max" },
    "glm-5.3-flash": { reasoningLevels: ["low", "high", "max"], defaultReasoningLevel: "max" }
  },
  "DeepSeek": {
    "deepseek-flash": { reasoningLevels: ["off", "low", "high", "max"], defaultReasoningLevel: "high" }
  }
};

const CODEX_TRANSPORT_PATCHES = {
  "Kimi For Coding": {
    apiFormat: "openai_responses",
    baseUrl: "https://api.kimi.com/coding/v1",
    removeMetaKeys: ["promptCacheRouting", "codexChatReasoning"]
  },
  "Zhipu GLM": {
    apiFormat: "openai_responses",
    baseUrl: "https://open.bigmodel.cn/api/v1",
    removeMetaKeys: ["codexChatReasoning"]
  },
  "DeepSeek": {
    apiFormat: "openai_responses",
    baseUrl: "https://api.deepseek.com",
    model: "deepseek-flash"
  }
};

const PI_LIMITS = {
  "k3": { contextWindow: 1048576, maxTokens: 131072 },
  "glm-5.3": { contextWindow: 1000000, maxTokens: 128000 },
  "glm-5.3-flash": { contextWindow: 1000000, maxTokens: 128000 },
  "deepseek-v4-flash": { contextWindow: 1000000, maxTokens: 384000 },
  "deepseek-v4-pro": { contextWindow: 1000000, maxTokens: 384000 },
  "deepseek-v4-flash-vision-exp": { contextWindow: 1000000, maxTokens: 384000 }
};

const PI_THINKING_LEVELS = {
  "k3": { low: "low", high: "high", max: "max" },
  "kimi-k3": { low: "low", high: "high", max: "max" },
  "glm-5.3": { low: "low", high: "high", max: "max" },
  "glm-5.3-flash": { low: "low", high: "high", max: "max" },
  "deepseek-v4-flash": { off: "off", low: "low", high: "high", max: "max" },
  "deepseek-v4-pro": { off: "off", low: "low", high: "high", max: "max" },
  "deepseek-v4-flash-vision-exp": { off: "off", low: "low", high: "high", max: "max" }
};

function object(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}

function tomlKeyPattern(key) {
  return String(key).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function replaceTomlAssignment(text, key, value) {
  const pattern = new RegExp(`^(\\s*${tomlKeyPattern(key)}\\s*=\\s*)["'][^"']*["']`, "m");
  const assignment = `${key} = "${value}"`;
  if (pattern.test(text)) return text.replace(pattern, `$1"${value}"`);
  return `${String(text ?? "").replace(/\s*$/, "")}\n${assignment}\n`;
}

export function patchProviderConfig(appType, name, raw, rawMeta = null) {
  const config = JSON.parse(raw || "{}");
  let changed = false;
  let metaChanged = false;
  let meta = rawMeta === null ? null : JSON.parse(rawMeta || "{}");
  if (appType === "codex") {
    const patches = CODEX_PATCHES[name];
    if (patches) {
      config.modelCatalog ??= {};
      config.modelCatalog.models ??= [];
      for (const model of config.modelCatalog.models) {
        const patch = patches[model.model];
        if (!patch) continue;
        for (const [key, value] of Object.entries(patch)) {
          if (JSON.stringify(model[key]) !== JSON.stringify(value)) {
            model[key] = value;
            changed = true;
          }
        }
      }
    }

    const transportPatch = CODEX_TRANSPORT_PATCHES[name];
    if (transportPatch) {
      if (typeof config.config === "string") {
        const withBaseUrl = transportPatch.baseUrl
          ? replaceTomlAssignment(config.config, "base_url", transportPatch.baseUrl)
          : config.config;
        const withWireApi = transportPatch.apiFormat === "openai_responses"
          ? replaceTomlAssignment(withBaseUrl, "wire_api", "responses")
          : withBaseUrl;
        const withModel = transportPatch.model
          ? replaceTomlAssignment(withWireApi, "model", transportPatch.model)
          : withWireApi;
        if (withModel !== config.config) {
          config.config = withModel;
          changed = true;
        }
      }
      if (meta !== null) {
        if (transportPatch.apiFormat && meta.apiFormat !== transportPatch.apiFormat) {
          meta.apiFormat = transportPatch.apiFormat;
          metaChanged = true;
        }
        for (const key of transportPatch.removeMetaKeys ?? []) {
          if (Object.prototype.hasOwnProperty.call(meta, key)) {
            delete meta[key];
            metaChanged = true;
          }
        }
      }
    }
  } else if (appType === "pi") {
    for (const model of Array.isArray(config.models) ? config.models : []) {
      const levels = PI_THINKING_LEVELS[model.id];
      if (!levels) continue;
      if (model.reasoning !== true) {
        model.reasoning = true;
        changed = true;
      }
      if (JSON.stringify(model.thinkingLevelMap) !== JSON.stringify(levels)) {
        model.thinkingLevelMap = levels;
        changed = true;
      }
      const limits = PI_LIMITS[model.id];
      if (limits) {
        for (const [key, value] of Object.entries(limits)) {
          if (model[key] !== value) {
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
    metaChanged,
    metaRaw: metaChanged ? JSON.stringify(meta) : rawMeta,
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
    if (JSON.stringify(model.supported_reasoning_levels) !== JSON.stringify(patch.levels)) {
      model.supported_reasoning_levels = patch.levels;
      changed = true;
    }
    if (model.default_reasoning_level !== patch.default) {
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
  const providerColumns = new Set(db.prepare("PRAGMA table_info(providers)").all().map((row) => row.name));
  const hasMeta = providerColumns.has("meta");
  const rows = db.prepare(`SELECT id, app_type, name, settings_config${hasMeta ? ", meta" : ""} FROM providers ORDER BY app_type, name`).all();
  const changes = [];
  for (const row of rows) {
    const patched = patchProviderConfig(row.app_type, row.name, row.settings_config, hasMeta ? row.meta : null);
    if (patched.changed || patched.metaChanged) {
      changes.push({
        id: row.id,
        appType: row.app_type,
        name: row.name,
        raw: patched.raw,
        config: patched.config,
        metaRaw: patched.metaRaw,
        meta: patched.meta,
        configChanged: patched.changed,
        metaChanged: patched.metaChanged
      });
    }
  }
  if (!write) {
    db.close();
    const catalog = await patchCatalog({ catalogPath: codexCatalogPath, write: false, backupRoot, stamp: null });
    return { write: false, changed: changes.length, changes: changes.map(({ raw, config, metaRaw, meta, ...change }) => change), catalog: { ...catalog, raw: undefined } };
  }

  await mkdir(backupRoot, { recursive: true });
  const stamp = new Date().toISOString().replace(/[-:.TZ]/g, "").slice(0, 14);
  const backup = join(backupRoot, `cc-switch-${stamp}.db`);
  await copyFile(databasePath, backup);

  db.exec("BEGIN IMMEDIATE");
  try {
    const updateConfig = db.prepare("UPDATE providers SET settings_config = ? WHERE id = ?");
    const updateMeta = hasMeta ? db.prepare("UPDATE providers SET meta = ? WHERE id = ?") : null;
    for (const change of changes) {
      if (change.configChanged) updateConfig.run(change.raw, change.id);
      if (change.metaChanged && updateMeta) updateMeta.run(change.metaRaw, change.id);
    }
    db.exec("COMMIT");
  } catch (error) {
    db.exec("ROLLBACK");
    db.close();
    throw error;
  }
  db.close();
  const catalog = await patchCatalog({ catalogPath: codexCatalogPath, write, backupRoot, stamp });
  return {
    write: true,
    changed: changes.length,
    backup,
    providers: changes.map(({ raw, config, metaRaw, meta, ...change }) => change),
    catalog: { ...catalog, raw: undefined }
  };
}
