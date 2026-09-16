import { existsSync, readFileSync } from "node:fs";
import { readFile, writeFile, mkdir, rename, chmod } from "node:fs/promises";
import { createRequire } from "node:module";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { randomUUID } from "node:crypto";
import { loadModels } from "./config.mjs";
import { listModels } from "./models.mjs";

function expandHome(value) {
  if (typeof value !== "string") return value;
  if (value === "~") return homedir();
  if (value.startsWith("~/")) return resolve(homedir(), value.slice(2));
  return resolve(value);
}

function unique(values) {
  return [...new Set(values.filter((value) => typeof value === "string" && value.trim()).map((value) => value.trim()))];
}

function normalizeReasoningLevel(value) {
  const level = String(value ?? "").trim().toLowerCase();
  if (["none", "disabled", "disable"].includes(level)) return "off";
  if (["minimal", "minimum"].includes(level)) return "low";
  return level;
}

function extractModelEntries(settingsConfig) {
  let parsed = null;
  try { parsed = JSON.parse(settingsConfig || "{}"); } catch {}
  const entries = [];
  if (parsed) {
    for (const model of parsed.modelCatalog?.models ?? []) {
      entries.push({
        id: model?.model ?? null,
        name: model?.displayName ?? null,
        levels: unique(model?.reasoningLevels ?? []).map(normalizeReasoningLevel),
        defaultLevel: model?.defaultReasoningLevel ? normalizeReasoningLevel(model.defaultReasoningLevel) : null,
        contextWindow: model?.contextWindow ?? null,
        maxTokens: model?.maxOutputTokens ?? model?.maxTokens ?? null,
        input: unique(model?.input ?? model?.modalities ?? []),
        reasoningEnabled: typeof model?.reasoning === "boolean" ? model.reasoning : null
      });
    }
    for (const model of parsed.models ?? []) {
      const levels = unique(Object.keys(model?.thinkingLevelMap ?? {})).map(normalizeReasoningLevel);
      entries.push({
        id: model?.id ?? null,
        name: model?.name ?? null,
        // An empty map means CC Switch enabled reasoning but did not constrain
        // selectable efforts. The model's vendor profile supplies that baseline.
        levels,
        defaultLevel: model?.defaultEffort ? normalizeReasoningLevel(model.defaultEffort) : null,
        contextWindow: model?.contextWindow ?? null,
        maxTokens: model?.maxTokens ?? null,
        input: unique(model?.input ?? []),
        reasoningEnabled: typeof model?.reasoning === "boolean" ? model.reasoning : null
      });
    }
  }
  const seen = new Set();
  return entries.filter((entry) => {
    const key = `${entry.id ?? ""}|${entry.name ?? ""}|${entry.levels.join(",")}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function extractModelHints(settingsConfig) {
  const hints = [];
  for (const entry of extractModelEntries(settingsConfig)) {
    if (entry.id) hints.push(entry.id);
    if (entry.name) hints.push(entry.name);
  }
  let parsed = null;
  try { parsed = JSON.parse(settingsConfig || "{}"); } catch {}
  const env = parsed?.env ?? {};
  for (const [key, value] of Object.entries(env)) {
    if (/MODEL/i.test(key) && typeof value === "string") hints.push(value);
  }
  if (typeof parsed?.model === "string") hints.push(parsed.model);
  const text = String(settingsConfig || "");
  for (const match of text.matchAll(/(?:^|\s)model\s*=\s*["']([^"']+)["']/g)) hints.push(match[1]);
  return unique(hints).filter((hint) => hint.length < 160);
}

function parseJsonObject(raw) {
  try {
    const value = JSON.parse(raw || "{}");
    return value && typeof value === "object" && !Array.isArray(value) ? value : {};
  } catch {
    return {};
  }
}

function extractTomlAssignment(text, key) {
  const escaped = String(key).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = String(text ?? "").match(new RegExp(`^\\s*${escaped}\\s*=\\s*["']([^"']+)["']`, "m"));
  return match?.[1] ?? null;
}

function extractTomlTable(text, tableName) {
  const escaped = String(tableName).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = new RegExp(`^\\[${escaped}\\]\\s*$`, "m").exec(String(text ?? ""));
  if (!match) return null;
  const rest = String(text).slice(match.index + match[0].length);
  const next = rest.search(/^\s*\[/m);
  return (next === -1 ? rest : rest.slice(0, next)).trim();
}

function sanitizeBaseUrl(value) {
  if (typeof value !== "string" || !value.trim()) return null;
  try {
    const url = new URL(value.trim());
    url.username = "";
    url.password = "";
    url.search = "";
    url.hash = "";
    return url.toString().replace(/\/$/, "");
  } catch {
    return value.trim();
  }
}

function isLoopbackBaseUrl(value) {
  if (typeof value !== "string") return false;
  try {
    const host = new URL(value).hostname.toLowerCase();
    return host === "localhost" || host === "127.0.0.1" || host === "::1" || host === "0.0.0.0";
  } catch {
    return /(?:localhost|127\.0\.0\.1|\[::1\]|0\.0\.0\.0)/i.test(value);
  }
}

export function extractCodexTransport(settingsConfig, apiFormat = null) {
  const parsed = parseJsonObject(settingsConfig);
  const text = typeof parsed.config === "string" ? parsed.config : "";
  const modelProvider = extractTomlAssignment(text, "model_provider");
  const providerSection = modelProvider ? extractTomlTable(text, `model_providers.${modelProvider}`) : null;
  const scope = providerSection || text;
  const baseUrl = extractTomlAssignment(scope, "base_url");
  const wireApi = extractTomlAssignment(scope, "wire_api");
  const proxyManaged = isLoopbackBaseUrl(baseUrl) || /experimental_bearer_token\s*=\s*["']PROXY_MANAGED["']/i.test(scope);
  const directCapable = Boolean(baseUrl && wireApi === "responses" && !proxyManaged);
  const directEligible = directCapable && (!apiFormat || apiFormat === "openai_responses");
  const metadataMismatch = directCapable && Boolean(apiFormat) && apiFormat !== "openai_responses";
  const proxyRequired = !directCapable && (apiFormat === "openai_chat" || apiFormat === "anthropic" || (wireApi && wireApi !== "responses"));
  const routingMode = proxyManaged
    ? "proxy"
    : directEligible
      ? "direct"
      : metadataMismatch
        ? "metadata_stale"
        : proxyRequired
          ? "proxy_required"
          : directCapable
            ? "direct_candidate"
            : "unknown";
  return {
    modelProvider,
    baseUrl: sanitizeBaseUrl(baseUrl),
    wireApi,
    apiFormat: apiFormat ?? null,
    proxyManaged,
    directCapable,
    directEligible,
    metadataMismatch,
    proxyRequired,
    routingMode
  };
}

async function querySqlite(dbPath, sql) {
  try {
    const { DatabaseSync } = await import("node:sqlite");
    const db = new DatabaseSync(dbPath, { readOnly: true });
    const rows = db.prepare(sql).all().map((row) => ({ ...row }));
    db.close();
    return rows;
  } catch (error) {
    if (error?.code !== "ERR_UNKNOWN_BUILTIN_MODULE" && !/node:sqlite/i.test(String(error?.message))) throw error;
  }

  const { runCommand } = await import("./process.mjs");
  const result = await runCommand({
    command: "sqlite3",
    args: ["-readonly", "-json", dbPath, sql],
    timeoutMs: 15000,
    stripSecretEnv: true
  });
  if (!result.ok) throw new Error(result.stderr || `sqlite3 failed with exit ${result.code}`);
  return JSON.parse(result.stdout || "[]");
}

export function ccSwitchPaths() {
  const root = expandHome(process.env.CC_SWITCH_HOME || "~/.cc-switch");
  return {
    root,
    settings: join(root, "settings.json"),
    database: join(root, "cc-switch.db"),
    skillsDir: join(root, "skills")
  };
}

function codexPaths() {
  const root = expandHome(process.env.CODEX_HOME || "~/.codex");
  return {
    root,
    config: join(root, "config.toml"),
    auth: join(root, "auth.json")
  };
}

function toSnapshotProvider(provider) {
  const meta = parseJsonObject(provider.meta);
  const apiFormat = typeof meta.apiFormat === "string" ? meta.apiFormat : null;
  return {
    id: provider.id,
    appType: provider.app_type,
    name: provider.name,
    category: provider.category,
    isCurrent: Boolean(provider.is_current),
    apiFormat,
    meta: {
      apiFormat,
      promptCacheRouting: meta.promptCacheRouting ?? null,
      codexChatReasoning: Boolean(meta.codexChatReasoning)
    },
    transport: extractCodexTransport(provider.settings_config, apiFormat),
    models: extractModelHints(provider.settings_config),
    modelEntries: extractModelEntries(provider.settings_config)
  };
}

const PROVIDER_SNAPSHOT_SQL = `
    SELECT id, app_type, name, category, is_current, settings_config, meta
    FROM providers
    ORDER BY app_type, is_current DESC, sort_index, name
  `;

export async function readCcSwitchSnapshot() {
  const paths = ccSwitchPaths();
  if (!existsSync(paths.database) || !existsSync(paths.settings)) {
    return { available: false, reason: "cc-switch data not found", paths };
  }
  const settings = JSON.parse(await readFile(paths.settings, "utf8"));
  const providers = await querySqlite(paths.database, `
    SELECT id, app_type, name, category, is_current, settings_config, meta
    FROM providers
    ORDER BY app_type, is_current DESC, sort_index, name
  `);
  const skills = await querySqlite(paths.database, `
    SELECT id, name, description, directory, repo_owner, repo_name,
           enabled_claude, enabled_codex, enabled_gemini, enabled_opencode,
           enabled_hermes, enabled_grokbuild
    FROM skills
    ORDER BY name
  `);

  const safeProviders = providers.map(toSnapshotProvider);
  const current = {
    codex: settings.currentProviderCodex ?? null,
    claude: settings.currentProviderClaude ?? null
  };
  const codex = codexPaths();
  let liveTransport = null;
  if (existsSync(codex.config)) {
    try {
      liveTransport = extractCodexTransport(JSON.stringify({ config: await readFile(codex.config, "utf8") }), null);
    } catch {}
  }
  return {
    available: true,
    paths,
    settings: {
      currentProviderCodex: current.codex,
      currentProviderClaude: current.claude,
      localProxyEnabled: Boolean(settings.enableLocalProxy),
      proxyConfirmed: Boolean(settings.proxyConfirmed),
      skillStorageLocation: settings.skillStorageLocation ?? null,
      skillSyncMethod: settings.skillSyncMethod ?? null
    },
    liveTransport,
    currentProviders: Object.fromEntries(Object.entries(current).map(([app, id]) => [app, safeProviders.find((provider) => provider.id === id) ?? null])),
    providers: safeProviders,
    skills: skills.map((skill) => ({
      id: skill.id,
      name: skill.name,
      description: skill.description,
      directory: skill.directory,
      upstream: skill.repo_owner && skill.repo_name ? `${skill.repo_owner}/${skill.repo_name}` : null,
      enabled: {
        claude: Boolean(skill.enabled_claude),
        codex: Boolean(skill.enabled_codex),
        gemini: Boolean(skill.enabled_gemini),
        opencode: Boolean(skill.enabled_opencode),
        hermes: Boolean(skill.enabled_hermes),
        grokbuild: Boolean(skill.enabled_grokbuild)
      }
    }))
  };
}

// Sensitive provider material for the isolated Pi runtime. Keep this internal to
// execution paths: callers must never return or log the provider configs.
export async function readCcSwitchPiProviderConfigs() {
  const paths = ccSwitchPaths();
  if (!existsSync(paths.database)) return { available: false, reason: "cc-switch database not found", providers: {} };
  const rows = await querySqlite(paths.database, `
    SELECT id, name, settings_config
    FROM providers
    WHERE app_type = 'pi'
    ORDER BY name
  `);
  const providers = {};
  const errors = [];
  for (const row of rows) {
    try {
      const value = JSON.parse(row.settings_config || "{}");
      if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("provider config must be an object");
      if (!value.baseUrl || !value.api || !Array.isArray(value.models)) throw new Error("baseUrl, api, and models are required");
      providers[row.id] = value;
    } catch (error) {
      errors.push({ id: row.id, name: row.name, error: error.message });
    }
  }
  return { available: true, providers, errors, source: paths.database };
}

// Sensitive CLI provider material for isolated harness runtimes. These values
// must only be written to private per-provider homes and must never be returned
// by MCP tools, doctor reports, logs, or result cards.
export async function readCcSwitchCliProviderConfig(appType, providerId) {
  if (!["claude", "codex"].includes(appType)) throw new Error(`Unsupported CC Switch CLI app type: ${appType}`);
  if (!providerId) throw new Error(`Missing CC Switch ${appType} provider id`);
  const paths = ccSwitchPaths();
  if (!existsSync(paths.database)) return { available: false, reason: "cc-switch database not found" };
  const escapedAppType = String(appType).replaceAll("'", "''");
  const escapedProviderId = String(providerId).replaceAll("'", "''");
  const rows = await querySqlite(paths.database, `
    SELECT id, name, settings_config
    FROM providers
    WHERE app_type = '${escapedAppType}' AND id = '${escapedProviderId}'
    LIMIT 1
  `);
  const row = rows[0];
  if (!row) return { available: false, reason: `CC Switch ${appType} provider not found: ${providerId}` };
  let settings;
  try {
    settings = JSON.parse(row.settings_config || "{}");
  } catch (error) {
    throw new Error(`Invalid CC Switch ${appType} provider config for ${providerId}: ${error.message}`);
  }
  if (!settings || typeof settings !== "object" || Array.isArray(settings)) {
    throw new Error(`Invalid CC Switch ${appType} provider config for ${providerId}`);
  }
  return { available: true, id: row.id, name: row.name, settings, source: paths.database };
}

function normalize(value) {
  return String(value ?? "").toLowerCase().replace(/\[[^\]]+\]/g, "").replace(/[^a-z0-9]+/g, "");
}

export function bindModelsToCcSwitch(snapshot, modelsConfig = loadModels()) {
  if (!snapshot?.available) return {};
  return Object.fromEntries(listModels(modelsConfig).map((model) => {
    const candidates = unique([
      model.id,
      model.providerModel,
      model.displayName,
      ...Object.entries(modelsConfig.aliases ?? {}).filter(([, id]) => id === model.id).map(([alias]) => alias)
    ]).map(normalize);
    const scored = [];
    for (const provider of snapshot.providers) {
      const matches = [];
      for (const hint of provider.models) {
        const normalizedHint = normalize(hint);
        for (const candidate of candidates) {
          let score = 0;
          if (normalizedHint === candidate) score = 100;
          else if (candidate.length >= 4 && normalizedHint.includes(candidate)) score = 50;
          else if (normalizedHint.length >= 4 && candidate.includes(normalizedHint)) score = 40;
          if (score > 0) matches.push({ hint, score });
        }
      }
      const bestScore = Math.max(0, ...matches.map((match) => match.score));
      if (bestScore > 0) {
        const matchedModels = unique(matches.filter((match) => match.score === bestScore).map((match) => match.hint));
        const matchedEntries = (provider.modelEntries ?? [])
          .filter((entry) => matchedModels.some((matched) => normalize(matched) === normalize(entry.id) || normalize(matched) === normalize(entry.name)));
        const matchedReasoningLevels = unique(matchedEntries.flatMap((entry) => entry.levels ?? []));
        const matchedReasoningDefaults = unique(matchedEntries.map((entry) => entry.defaultLevel ?? null));
        scored.push({ provider: { ...provider, matchedModels, matchedReasoningLevels, matchedReasoningDefaults }, score: bestScore });
      }
    }
    const best = Math.max(0, ...scored.map((item) => item.score));
    return [model.id, scored.filter((item) => item.score === best).sort((a, b) => Number(b.provider.isCurrent) - Number(a.provider.isCurrent)).map((item) => item.provider)];
  }));
}

function routingObservation(provider) {
  const transport = provider.transport ?? {};
  const status = transport.routingMode === "direct"
    ? "direct_ready"
    : transport.routingMode === "metadata_stale"
      ? "metadata_stale"
      : transport.routingMode === "proxy"
        ? "proxy_managed"
        : transport.routingMode === "proxy_required"
          ? "proxy_required"
          : "unknown";
  const recommendedAction = {
    direct_ready: "No local routing is required for this provider.",
    metadata_stale: "Set the CC Switch upstream format to Responses or re-import the official preset.",
    proxy_managed: "The live config still points at the local proxy; stop or disable takeover with live restore.",
    proxy_required: "This upstream still requires local routing because it is not native Responses.",
    unknown: "Inspect the provider base URL, wire API, and upstream format."
  }[status];
  return {
    provider: provider.name,
    appType: provider.appType,
    apiFormat: provider.apiFormat ?? null,
    baseUrl: transport.baseUrl ?? null,
    wireApi: transport.wireApi ?? null,
    routingMode: transport.routingMode ?? "unknown",
    status,
    recommendedAction
  };
}

export function ccswitchRoutingAudit(snapshot, modelsConfig = loadModels()) {
  if (!snapshot?.available) return { available: false, models: {} };
  const bindings = bindModelsToCcSwitch(snapshot, modelsConfig);
  const models = Object.fromEntries(listModels(modelsConfig).map((model) => {
    const boundProviders = bindings[model.id] ?? [];
    const codexProviders = boundProviders.filter((provider) => provider.appType === "codex");
    const observations = (codexProviders.length > 0 ? codexProviders : boundProviders).map(routingObservation);
    const status = observations.some((item) => item.status === "metadata_stale")
      ? "metadata_stale"
      : observations.some((item) => item.status === "direct_ready")
        ? "direct_ready"
        : observations.some((item) => item.status === "proxy_required")
          ? "proxy_required"
          : observations.some((item) => item.status === "proxy_managed")
            ? "proxy_managed"
            : "unknown";
    return [model.id, {
      status,
      observations,
      recommendedAction: observations.find((item) => item.status === status)?.recommendedAction
        ?? "Inspect the bound CC Switch provider."
    }];
  }));
  const liveMode = snapshot.liveTransport?.routingMode ?? "unknown";
  const warnings = [];
  if (!snapshot.settings?.localProxyEnabled && liveMode === "proxy") {
    warnings.push("Codex live config is still proxy-managed while local routing is disabled.");
  }
  if (snapshot.settings?.localProxyEnabled && Object.values(models).some((item) => item.status === "direct_ready")) {
    warnings.push("At least one provider is direct-ready; disable takeover for those providers when possible.");
  }
  return {
    available: true,
    localProxyEnabled: snapshot.settings?.localProxyEnabled ?? null,
    liveMode,
    liveTransport: snapshot.liveTransport ?? null,
    warnings,
    models
  };
}

export function ccswitchReasoningAudit(snapshot, modelsConfig = loadModels()) {
  if (!snapshot?.available) return { available: false, models: {} };
  const bindings = bindModelsToCcSwitch(snapshot, modelsConfig);
  return {
    available: true,
    models: Object.fromEntries(listModels(modelsConfig).map((model) => {
      const configured = model.reasoning?.supported ?? [];
      const providers = bindings[model.id] ?? [];
      const selectedProvider = selectReasoningProvider(providers);
      const ccswitchLevels = unique(selectedProvider?.matchedReasoningLevels ?? []);
      return [model.id, {
        configured,
        ccswitchLevels,
        selectedProvider: selectedProvider ? { id: selectedProvider.id, name: selectedProvider.name, appType: selectedProvider.appType, isCurrent: selectedProvider.isCurrent } : null,
        conflictingProviders: providers.filter((provider) => provider.id !== selectedProvider?.id)
          .filter((provider) => JSON.stringify(unique(provider.matchedReasoningLevels ?? [])) !== JSON.stringify(ccswitchLevels))
          .map((provider) => ({ id: provider.id, name: provider.name, levels: unique(provider.matchedReasoningLevels ?? []) })),
        missingInCcSwitch: configured.filter((level) => !ccswitchLevels.includes(level)),
        extraInCcSwitch: ccswitchLevels.filter((level) => !configured.includes(level)),
        complete: configured.every((level) => ccswitchLevels.includes(level))
      }];
    }))
  };
}

export function ccswitchLimitsAudit(snapshot, modelsConfig = loadModels()) {
  if (!snapshot?.available) return { available: false, models: {} };
  const bindings = bindModelsToCcSwitch(snapshot, modelsConfig);
  return {
    available: true,
    models: Object.fromEntries(listModels(modelsConfig).map((model) => {
      const observed = (bindings[model.id] ?? [])
        .flatMap((provider) => (provider.modelEntries ?? []).filter((entry) => (provider.matchedModels ?? []).some((matched) => normalize(matched) === normalize(entry.id) || normalize(matched) === normalize(entry.name))))
        .map((entry) => ({ provider: providerForEntry(bindings[model.id], entry), contextWindow: entry.contextWindow, maxTokens: entry.maxTokens }));
      return [model.id, { configured: model.limits ?? {}, observed }];
    }))
  };
}

function providerForEntry(providers, entry) {
  return providers.find((provider) => (provider.modelEntries ?? []).some((candidate) => candidate.id === entry.id && candidate.name === entry.name))?.name ?? null;
}

export function ccSwitchSkillStatus(snapshot, skillName = "codex-moa") {
  if (!snapshot?.available) return { available: false, enabled: false };
  const skill = snapshot.skills.find((item) => item.directory === skillName || item.name === skillName);
  return skill ? { available: true, enabled: Boolean(skill.enabled.codex), skill } : { available: false, enabled: false };
}

function selectReasoningProvider(providers) {
  const list = Array.isArray(providers) ? providers : [];
  return [...list].sort((left, right) => {
    const leftHasLevels = Number((left.matchedReasoningLevels?.length ?? 0) > 0 || (left.matchedReasoningDefaults?.length ?? 0) > 0);
    const rightHasLevels = Number((right.matchedReasoningLevels?.length ?? 0) > 0 || (right.matchedReasoningDefaults?.length ?? 0) > 0);
    if (leftHasLevels !== rightHasLevels) return rightHasLevels - leftHasLevels;
    const leftCodex = Number(left.appType === "codex");
    const rightCodex = Number(right.appType === "codex");
    if (leftCodex !== rightCodex) return rightCodex - leftCodex;
    return Number(right.isCurrent) - Number(left.isCurrent);
  })[0] ?? null;
}

function exactPiProvider(snapshot, model) {
  const providerId = model?.pi?.provider;
  const modelId = model?.pi?.model;
  if (!providerId || !modelId) return null;
  const provider = (snapshot?.providers ?? []).find((item) => item.appType === "pi" && item.id === providerId);
  if (!provider) return null;
  const entry = (provider.modelEntries ?? []).find((item) => normalize(item.id) === normalize(modelId));
  if (!entry) return null;
  return {
    ...provider,
    matchedModels: [entry.id],
    matchedEntries: [entry],
    matchedReasoningLevels: unique(entry.levels ?? []),
    matchedReasoningDefaults: unique([entry.defaultLevel])
  };
}

function selectedProviderForModel(snapshot, model, fallbackProviders) {
  // A Pi-routed model is governed by its explicitly configured Pi provider card.
  // DSH models deliberately have no Pi mapping and therefore remain independent.
  if (model?.harness === "dsh") return null;
  return exactPiProvider(snapshot, model) ?? selectReasoningProvider(fallbackProviders);
}

// ── cc-switch 作为思考等级唯一真源（用户裁决 2026-09-15）─────────────────────
// 「所有由 cc-switch 管的模型，各 agent 请求思考等级要找 cc-switch」：
// 可选档位与默认档位以 cc-switch 的 modelCatalog（codex 类）/ thinkingLevelMap（pi 类）为准，
// 本地 config/models.json 仅在 cc-switch 未覆盖该模型时兜底。

/** node:sqlite 的同步读（createRequire 拿到内置模块）；不可用/失败返回 null 交由上层兜底 */
function querySqliteSync(dbPath, sql) {
  try {
    const require = createRequire(import.meta.url);
    const { DatabaseSync } = require("node:sqlite");
    const db = new DatabaseSync(dbPath, { readOnly: true });
    const rows = db.prepare(sql).all().map((row) => ({ ...row }));
    db.close();
    return rows;
  } catch {
    return null;
  }
}

/** 同步版快照：dispatch 路径（planMoA/runMoA 是同步解析模型表）不得异步读库 */
export function readCcSwitchSnapshotSync() {
  const paths = ccSwitchPaths();
  if (!existsSync(paths.database) || !existsSync(paths.settings)) {
    return { available: false, reason: "cc-switch data not found", paths };
  }
  const rows = querySqliteSync(paths.database, PROVIDER_SNAPSHOT_SQL);
  if (!rows) return { available: false, reason: "node:sqlite unavailable", paths };
  let settings = {};
  try { settings = JSON.parse(readFileSync(paths.settings, "utf8")); } catch {}
  return {
    available: true,
    paths,
    settings: {
      currentProviderCodex: settings.currentProviderCodex ?? null,
      currentProviderClaude: settings.currentProviderClaude ?? null,
      localProxyEnabled: Boolean(settings.enableLocalProxy)
    },
    providers: rows.map(toSnapshotProvider)
  };
}

/** 模型 → 该模型在 cc-switch 声明的档位/默认档位（命中即覆盖本地表） */
export function ccSwitchReasoningIndex(snapshot, modelsConfig = loadModels()) {
  if (!snapshot?.available) return {};
  const bindings = bindModelsToCcSwitch(snapshot, modelsConfig);
  const index = {};
  for (const [modelId, providers] of Object.entries(bindings)) {
    const list = Array.isArray(providers) ? providers : [];
    // Provider cards are independent authorities. Never union levels across
    // cards, because the resulting set may not exist on any real endpoint.
    const selected = selectedProviderForModel(snapshot, modelsConfig.models?.[modelId], list);
    const levels = unique(selected?.matchedReasoningLevels ?? []);
    const defaults = unique(selected?.matchedReasoningDefaults ?? []);
    if (levels.length === 0 && defaults.length === 0 && !selected?.matchedEntries?.length) continue;
    index[modelId] = {
      levels,
      defaultLevel: defaults[0] ?? null,
      entry: selected?.matchedEntries?.[0] ?? null,
      selectedProvider: selected ? { id: selected.id, name: selected.name, appType: selected.appType, isCurrent: selected.isCurrent } : null,
      providers: list.map((provider) => ({ id: provider.id, name: provider.name, appType: provider.appType, isCurrent: provider.isCurrent })),
      conflicts: list.filter((provider) => provider.id !== selected?.id)
        .filter((provider) => JSON.stringify(unique(provider.matchedReasoningLevels ?? [])) !== JSON.stringify(levels))
        .map((provider) => ({ id: provider.id, name: provider.name, levels: unique(provider.matchedReasoningLevels ?? []) }))
    };
  }
  return index;
}

/**
 * 把 cc-switch 的档位叠加到本地模型表上（纯函数：返回新表，不改入参）。
 * cc-switch 给了档位 → 用它；只给了默认档位 → 默认值在本地档位内才采用；
 * 两者都没给 → 整体保留本地表（未纳管的模型）。
 */
export function applyCcSwitchReasoning(modelsConfig = loadModels(), snapshot) {
  const index = ccSwitchReasoningIndex(snapshot, modelsConfig);
  const models = {};
  const reasoningSources = {};
  const metadataSources = {};
  for (const [id, model] of Object.entries(modelsConfig.models ?? {})) {
    const managed = index[id];
    const localSupported = model.reasoning?.supported ?? [];
    const entry = managed?.entry ?? null;
    // cc-switch 未命中该模型 → 整个模型保留本地值。
    if (!managed) {
      models[id] = { ...model };
      reasoningSources[id] = "local";
      metadataSources[id] = "local";
      continue;
    }
    const vendor = model.reasoning?.vendorProfile ?? {};
    const supported = managed.levels.length > 0
      ? managed.levels
      : entry?.reasoningEnabled === false
        ? ["off"]
        : vendor.supported ?? localSupported;
    // 已纳管的模型以 cc-switch 为准：显式默认（须合法）→ 否则取最高档
    // （与 cc-switch 自身 apply_codex_reasoning_level_override 的回落一致）
    const defaultLevel =
      (managed.defaultLevel && supported.includes(managed.defaultLevel) ? managed.defaultLevel : null)
      ?? (vendor.default && supported.includes(vendor.default) ? vendor.default : null)
      ?? supported[supported.length - 1]
      ?? null;
    const capabilities = [...(model.capabilities ?? [])].filter((capability) => capability !== "image");
    if (entry?.input?.includes("image")) capabilities.push("image");
    const hasManagedReasoning = managed.levels.length > 0 || typeof entry?.reasoningEnabled === "boolean";
    const reasoning = hasManagedReasoning
      ? {
          ...(model.reasoning ?? {}),
          supported,
          default: defaultLevel,
          canDisable: supported.includes("off"),
          extendedThinking: entry?.reasoningEnabled ?? null,
          source: "cc-switch"
        }
      : { ...(model.reasoning ?? {}) };
    models[id] = {
      ...model,
      capabilities: entry?.input?.length ? unique(capabilities) : [...(model.capabilities ?? [])],
      reasoning,
      limits: {
        ...(model.limits ?? {}),
        ...(Number.isFinite(entry?.contextWindow) ? { contextWindow: entry.contextWindow } : {}),
        ...(Number.isFinite(entry?.maxTokens) ? { maxOutputTokens: entry.maxTokens } : {})
      }
    };
    reasoningSources[id] = hasManagedReasoning
      ? (managed.levels.length > 0 || entry?.reasoningEnabled === false ? "cc-switch" : "cc-switch+vendor")
      : "local";
    metadataSources[id] = entry ? "cc-switch" : "local";
  }
  return { ...modelsConfig, models, reasoningSources, metadataSources };
}

export async function writeCcSwitchSnapshot(snapshot) {
  snapshot = snapshot ?? await readCcSwitchSnapshot();
  const path = expandHome("~/.codex-moa/ccswitch.json");
  await mkdir(dirname(path), { recursive: true });
  const temporary = `${path}.${randomUUID()}.tmp`;
  await writeFile(temporary, `${JSON.stringify(snapshot, null, 2)}\n`, { mode: 0o600 });
  await rename(temporary, path);
  await chmod(path, 0o600);
  return path;
}
