import { chmod, mkdir, readFile, rename, rm, symlink, writeFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { homedir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import { readCcSwitchCliProviderConfig } from "./ccswitch.mjs";

function expandHome(value) {
  if (value === "~") return homedir();
  if (typeof value === "string" && value.startsWith("~/")) return resolve(homedir(), value.slice(2));
  return resolve(value);
}

async function atomicWritePrivate(path, value, json = false) {
  await mkdir(dirname(path), { recursive: true, mode: 0o700 });
  const temporary = join(dirname(path), `.${basename(path)}.${randomUUID()}.tmp`);
  const body = json ? `${JSON.stringify(value, null, 2)}\n` : String(value ?? "");
  await writeFile(temporary, body, { encoding: "utf8", mode: 0o600 });
  await rename(temporary, path);
  await chmod(path, 0o600);
}

async function projectSkills(home, skillPaths = []) {
  const skillsHome = join(home, "skills");
  await mkdir(skillsHome, { recursive: true, mode: 0o700 });
  const projected = [];
  for (const [index, source] of skillPaths.entries()) {
    const target = join(skillsHome, `${String(index + 1).padStart(2, "0")}-${basename(source)}`);
    await rm(target, { recursive: true, force: true });
    await symlink(source, target);
    projected.push(target);
  }
  return projected;
}

function codexReasoningDescription(effort) {
  if (effort === "low" || effort === "none") return "Fast responses with lighter reasoning";
  if (effort === "max") return "Maximum reasoning depth for the hardest problems";
  return "Greater reasoning depth for complex problems";
}

function normalizeCodexModelCatalog(catalog) {
  const models = (catalog?.models ?? []).map((model, index) => {
    if (model?.slug) return model;
    const slug = model?.model ?? model?.id;
    if (!slug) throw new Error(`CC Switch Codex model catalog entry ${index} has no model id`);
    const contextWindow = Number(model.contextWindow ?? model.context_window ?? 262144);
    const levels = model.reasoningLevels ?? model.supported_reasoning_levels ?? [];
    const supportedReasoningLevels = levels.map((level) => typeof level === "string"
      ? { effort: level === "none" ? "none" : level, description: codexReasoningDescription(level) }
      : level);
    return {
      additional_speed_tiers: [],
      availability_nux: null,
      base_instructions: "You are Codex, a coding agent. You and the user share the same workspace and collaborate to achieve the user's goals.",
      context_window: contextWindow,
      default_reasoning_level: model.defaultReasoningLevel ?? model.default_reasoning_level ?? supportedReasoningLevels.at(-1)?.effort ?? "high",
      default_reasoning_summary: "none",
      description: model.displayName ?? model.display_name ?? slug,
      display_name: model.displayName ?? model.display_name ?? slug,
      effective_context_window_percent: 95,
      experimental_supported_tools: [],
      input_modalities: model.input ?? model.input_modalities ?? ["text"],
      max_context_window: contextWindow,
      priority: 1000 + index,
      service_tiers: [],
      shell_type: "shell_command",
      slug,
      support_verbosity: false,
      supported_in_api: true,
      supported_reasoning_levels: supportedReasoningLevels,
      supports_image_detail_original: false,
      supports_parallel_tool_calls: true,
      supports_reasoning_summaries: true,
      supports_search_tool: false,
      truncation_policy: { limit: 10000, mode: "bytes" },
      upgrade: null,
      visibility: "list"
    };
  });
  return { models };
}

function isolateCodexConfig(configText, envKey = "CODEX_MOA_PROVIDER_API_KEY") {
  const lines = String(configText ?? "").split(/\r?\n/);
  const kept = [];
  let dropSection = false;
  for (const line of lines) {
    const section = line.match(/^\s*\[([^\]]+)\]\s*$/)?.[1] ?? null;
    if (section) dropSection = /^(desktop|marketplaces\.|plugins\.|projects\.)/.test(section);
    if (!dropSection) kept.push(line);
  }
  let text = kept.join("\n");
  const provider = text.match(/^\s*model_provider\s*=\s*["']([^"']+)["']/m)?.[1];
  if (!provider) throw new Error("CC Switch Codex config has no model_provider");
  const escaped = provider.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const sectionRe = new RegExp(`(^\\s*\\[model_providers\\.${escaped}\\]\\s*$)([\\s\\S]*?)(?=^\\s*\\[|$)`, "m");
  if (!sectionRe.test(text)) throw new Error(`CC Switch Codex config has no model_providers.${provider} section`);
  text = text.replace(sectionRe, (_all, header, body) => {
    const withoutExisting = body.replace(/^\s*env_key\s*=.*(?:\r?\n|$)/gm, "");
    return `${header}\nenv_key = "${envKey}"${withoutExisting}`;
  });
  return `${text.trim()}\n`;
}

export async function prepareClaudeHome(config = {}, providerId, skillPaths = []) {
  if (config.claude?.syncCcSwitchProviders === false) {
    const home = expandHome(config.claude?.headlessHome ?? "~/.codex-moa/claude-homes/test");
    await mkdir(home, { recursive: true, mode: 0o700 });
    return { home, settingsPath: join(home, "settings.json"), providerId, providerName: "test", projectedSkills: [] };
  }
  const snapshot = await readCcSwitchCliProviderConfig("claude", providerId);
  if (!snapshot.available) throw new Error(snapshot.reason);
  const root = expandHome(config.claude?.headlessHome ?? "~/.codex-moa/claude-homes");
  const home = join(root, providerId);
  await mkdir(home, { recursive: true, mode: 0o700 });
  await chmod(home, 0o700).catch(() => {});
  const settingsPath = join(home, "settings.json");
  await atomicWritePrivate(settingsPath, snapshot.settings, true);
  const projectedSkills = await projectSkills(home, skillPaths);
  return { home, settingsPath, providerId, providerName: snapshot.name, projectedSkills };
}

export async function prepareCodexHome(config = {}, providerId, skillPaths = []) {
  if (config.codex?.syncCcSwitchProviders === false) {
    const home = expandHome(config.codex?.headlessHome ?? "~/.codex-moa/codex-homes/test");
    await mkdir(home, { recursive: true, mode: 0o700 });
    return { home, configPath: join(home, "config.toml"), authPath: join(home, "auth.json"), providerId, providerName: "test", projectedSkills: [] };
  }
  const snapshot = await readCcSwitchCliProviderConfig("codex", providerId);
  if (!snapshot.available) throw new Error(snapshot.reason);
  const root = expandHome(config.codex?.headlessHome ?? "~/.codex-moa/codex-homes");
  const home = join(root, providerId);
  await mkdir(home, { recursive: true, mode: 0o700 });
  await chmod(home, 0o700).catch(() => {});
  if (typeof snapshot.settings.config !== "string" || !snapshot.settings.config.trim()) {
    throw new Error(`CC Switch Codex provider ${providerId} has no config.toml content`);
  }
  const configPath = join(home, "config.toml");
  const authPath = join(home, "auth.json");
  const modelCatalogPath = join(home, "cc-switch-model-catalog.json");
  const providerApiKey = snapshot.settings.auth?.OPENAI_API_KEY ?? snapshot.settings.auth?.api_key ?? null;
  if (typeof providerApiKey !== "string" || !providerApiKey.trim()) {
    throw new Error(`CC Switch Codex provider ${providerId} has no API key in auth settings`);
  }
  await atomicWritePrivate(configPath, isolateCodexConfig(snapshot.settings.config));
  if (snapshot.settings.auth && typeof snapshot.settings.auth === "object") {
    await atomicWritePrivate(authPath, snapshot.settings.auth, true);
  }
  if (snapshot.settings.modelCatalog && typeof snapshot.settings.modelCatalog === "object") {
    await atomicWritePrivate(modelCatalogPath, normalizeCodexModelCatalog(snapshot.settings.modelCatalog), true);
  }
  const projectedSkills = await projectSkills(home, skillPaths);
  return { home, configPath, authPath, modelCatalogPath, providerId, providerName: snapshot.name, projectedSkills, providerApiKey };
}
