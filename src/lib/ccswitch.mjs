import { existsSync } from "node:fs";
import { readFile, writeFile, mkdir, rename, chmod } from "node:fs/promises";
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

function extractModelEntries(settingsConfig) {
  let parsed = null;
  try { parsed = JSON.parse(settingsConfig || "{}"); } catch {}
  const entries = [];
  if (parsed) {
    for (const model of parsed.modelCatalog?.models ?? []) {
      entries.push({
        id: model?.model ?? null,
        name: model?.displayName ?? null,
        levels: unique(model?.reasoningLevels ?? []),
        defaultLevel: model?.defaultReasoningLevel ?? null,
        contextWindow: model?.contextWindow ?? null,
        maxTokens: model?.maxOutputTokens ?? model?.maxTokens ?? null
      });
    }
    for (const model of parsed.models ?? []) {
      const levels = unique(Object.keys(model?.thinkingLevelMap ?? {}));
      entries.push({
        id: model?.id ?? null,
        name: model?.name ?? null,
        levels: levels.length > 0 ? levels : model?.reasoning ? ["high"] : [],
        defaultLevel: model?.defaultEffort ?? null,
        contextWindow: model?.contextWindow ?? null,
        maxTokens: model?.maxTokens ?? null
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

  const safeProviders = providers.map((provider) => {
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
  });
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
        const matchedReasoningLevels = unique((provider.modelEntries ?? [])
          .filter((entry) => matchedModels.some((matched) => normalize(matched) === normalize(entry.id) || normalize(matched) === normalize(entry.name)))
          .flatMap((entry) => entry.levels ?? []));
        scored.push({ provider: { ...provider, matchedModels, matchedReasoningLevels }, score: bestScore });
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
      const ccswitchLevels = unique((bindings[model.id] ?? []).flatMap((provider) => provider.matchedReasoningLevels ?? []));
      return [model.id, {
        configured,
        ccswitchLevels,
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
