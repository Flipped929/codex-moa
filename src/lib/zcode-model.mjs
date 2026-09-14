import { chmod, copyFile, mkdir, readFile, rename, stat, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { homedir } from "node:os";
import { randomUUID } from "node:crypto";

const DEFAULT_DESKTOP_CONFIG = "~/.zcode/v2/config.json";
const DEFAULT_SETTINGS = "~/.zcode/v2/setting.json";
const DEFAULT_CLI_CONFIG = "~/.zcode/cli/config.json";

function expandHome(value) {
  if (typeof value !== "string") return value;
  if (value === "~") return homedir();
  if (value.startsWith("~/")) return resolve(homedir(), value.slice(2));
  return resolve(value);
}

async function readJson(path, missingOk = false) {
  try {
    return JSON.parse(await readFile(path, "utf8"));
  } catch (error) {
    if (missingOk && error?.code === "ENOENT") return {};
    throw new Error(`Unable to read JSON ${path}: ${error.message}`);
  }
}

function isObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function providerModels(provider) {
  const models = isObject(provider?.models) ? provider.models : {};
  return Object.entries(models).map(([key, value]) => ({
    key,
    id: isObject(value) ? value.id : undefined,
    name: isObject(value) ? value.name : undefined
  }));
}

function providerSummary(providerId, provider) {
  const options = isObject(provider?.options) ? provider.options : {};
  const models = providerModels(provider);
  return {
    id: providerId,
    name: provider?.name || providerId,
    kind: provider?.kind,
    enabled: provider?.enabled !== false,
    baseURL: options.baseURL,
    apiKeyPresent: Boolean(options.apiKey),
    models,
    supported: provider?.kind === "anthropic" && Boolean(options.baseURL) && Boolean(options.apiKey) && models.length > 0
  };
}

function resolveProvider(providers, selector) {
  if (selector) {
    const folded = selector.toLowerCase();
    const matches = Object.entries(providers).filter(([id, provider]) => id.toLowerCase() === folded || String(provider?.name ?? "").toLowerCase() === folded);
    if (matches.length === 0) throw new Error(`ZCode provider not found: ${selector}`);
    if (matches.length > 1) throw new Error(`ZCode provider selector is ambiguous: ${selector}`);
    return matches[0];
  }
  const candidates = Object.entries(providers).filter(([id, provider]) => providerSummary(id, provider).supported);
  if (candidates.length === 0) throw new Error("No runnable ZCode provider found (need kind=anthropic, baseURL, apiKey, models)");
  const preferredIds = ["builtin:zai", "builtin:bigmodel-coding-plan", "builtin:bigmodel-start-plan", "builtin:bigmodel"];
  for (const preferredId of preferredIds) {
    const match = candidates.find(([id]) => id === preferredId);
    if (match) return match;
  }
  return candidates[0];
}

function resolveModelKey(provider, selector) {
  const folded = String(selector ?? "").toLowerCase();
  const models = providerModels(provider);
  for (const model of models) {
    if ([model.key, model.id, model.name].some((value) => typeof value === "string" && value.toLowerCase() === folded)) return model.key;
  }
  throw new Error(`ZCode model not found: ${selector}. Available: ${models.map((model) => model.key).join(", ")}`);
}

function cliProviderCopy(provider) {
  const copied = {};
  for (const key of ["name", "kind", "headers", "models"]) if (provider[key] !== undefined) copied[key] = provider[key];
  const options = isObject(provider.options) ? provider.options : {};
  copied.options = Object.fromEntries(Object.entries(options).filter(([key]) => ["apiKey", "apiKeyRequired", "baseURL", "headers", "timeout", "chunkTimeout"].includes(key)));
  return copied;
}

async function atomicWritePrivate(path, value) {
  await mkdir(dirname(path), { recursive: true });
  const temporary = join(dirname(path), `.${path.split("/").pop()}.${randomUUID()}.tmp`);
  await writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`, { encoding: "utf8", mode: 0o600 });
  await rename(temporary, path);
  await chmod(path, 0o600);
}

export async function resolveZCodeSelection({ model, config }) {
  const zcodeConfig = config.zcode ?? {};
  const desktopPath = expandHome(zcodeConfig.desktopConfig ?? DEFAULT_DESKTOP_CONFIG);
  const cliPath = expandHome(zcodeConfig.cliConfig ?? DEFAULT_CLI_CONFIG);
  const settingsPath = expandHome(zcodeConfig.settingsPath ?? DEFAULT_SETTINGS);
  const desktop = await readJson(desktopPath);
  const providers = isObject(desktop.provider) ? desktop.provider : {};
  const settings = await readJson(settingsPath, true).catch(() => ({}));
  const selectedKeys = Object.values(settings.modelProviderFamilySelectedKeys ?? {}).filter((value) => typeof value === "string");

  let providerId;
  let provider;
  const explicitProvider = zcodeConfig.headlessProvider || zcodeConfig.provider;
  if (explicitProvider) {
    [providerId, provider] = resolveProvider(providers, explicitProvider);
  } else {
    const preferred = Object.entries(providers).find(([id, candidate]) => selectedKeys.some((key) => key === id || key.endsWith(`:${id}`)) && providerSummary(id, candidate).supported);
    if (preferred) [providerId, provider] = preferred;
    else [providerId, provider] = resolveProvider(providers, null);
  }

  const summary = providerSummary(providerId, provider);
  if (!summary.supported) throw new Error(`ZCode provider ${providerId} is not runnable`);
  const modelKey = resolveModelKey(provider, model);
  return { desktopPath, cliPath, providerId, provider, modelKey, selectedModel: modelKey };
}

export async function syncZCodeSelection({ model, reasoningEffort, contextBudget, outputBudget, config }) {
  const selection = await resolveZCodeSelection({ model, config });
  let cliConfig = {};
  try {
    cliConfig = await readJson(selection.cliPath, true);
  } catch {
    cliConfig = {};
  }
  const providers = isObject(cliConfig.provider) ? cliConfig.provider : {};
  const providerCopy = cliProviderCopy(selection.provider);
  if (reasoningEffort && isObject(providerCopy.models)) {
    for (const [key, value] of Object.entries(providerCopy.models)) {
      if (!isObject(value)) continue;
      if (key.toLowerCase() === selection.modelKey.toLowerCase()) {
        providerCopy.models[key] = {
          ...value,
          reasoning: { ...(isObject(value.reasoning) ? value.reasoning : {}), defaultVariant: reasoningEffort },
          ...(contextBudget || outputBudget ? {
            limit: {
              ...(isObject(value.limit) ? value.limit : {}),
              ...(contextBudget ? { context: contextBudget } : {}),
              ...(outputBudget ? { output: outputBudget } : {})
            }
          } : {})
        };
      }
    }
  }
  providers[selection.providerId] = providerCopy;
  cliConfig = {
    ...cliConfig,
    provider: providers,
    model: `${selection.providerId}/${selection.modelKey}`,
    ...(reasoningEffort ? { thoughtLevel: reasoningEffort } : {})
  };

  try {
    const info = await stat(selection.cliPath);
    const backup = `${selection.cliPath}.pre-codex-moa.bak`;
    try { await stat(backup); } catch { await copyFile(selection.cliPath, backup).catch(() => {}); await chmod(backup, 0o600).catch(() => {}); }
    void info;
  } catch {}

  await atomicWritePrivate(selection.cliPath, cliConfig);
  return {
    providerId: selection.providerId,
    modelKey: selection.modelKey,
    modelRef: `${selection.providerId}/${selection.modelKey}`,
    reasoningEffort: reasoningEffort ?? null,
    contextBudget: contextBudget ?? null,
    outputBudget: outputBudget ?? null
  };
}

let zcodeQueue = Promise.resolve();

export function withZCodeLock(fn) {
  const run = zcodeQueue.then(fn, fn);
  zcodeQueue = run.catch(() => {});
  return run;
}
