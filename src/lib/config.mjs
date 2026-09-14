import { existsSync, readFileSync } from "node:fs";
import { basename, dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { homedir } from "node:os";

const moduleDir = dirname(fileURLToPath(import.meta.url));
export const pluginRoot = basename(moduleDir) === "mcp" ? resolve(moduleDir, "..") : resolve(moduleDir, "..", "..");

function readJson(path) {
  return JSON.parse(readFileSync(path, "utf8"));
}

function isObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function mergeDeep(base, override) {
  if (!isObject(base) || !isObject(override)) return override ?? base;
  const output = { ...base };
  for (const [key, value] of Object.entries(override)) {
    output[key] = isObject(value) && isObject(output[key]) ? mergeDeep(output[key], value) : value;
  }
  return output;
}

export function expandHome(value) {
  if (typeof value !== "string") return value;
  if (value === "~") return homedir();
  if (value.startsWith("~/")) return resolve(homedir(), value.slice(2));
  return value;
}

function expandEnv(value) {
  if (typeof value !== "string") return value;
  return value.replace(/\$\{([A-Z0-9_]+)\}/gi, (_, name) => process.env[name] ?? "");
}

function expand(value) {
  if (Array.isArray(value)) return value.map(expand);
  if (isObject(value)) return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, expand(v)]));
  return expandHome(expandEnv(value));
}

function loadWithLocal(name) {
  const basePath = resolve(pluginRoot, "config", name);
  if (!existsSync(basePath)) throw new Error(`Missing config file: ${basePath}`);
  const base = readJson(basePath);
  const stem = name.replace(/\.json$/i, "");
  const overlayName = name === "default.json" ? "local.json" : `${stem}.local.json`;
  const localPath = resolve(pluginRoot, "config", overlayName);
  if (!existsSync(localPath)) return expand(base);
  const local = readJson(localPath);
  return expand(mergeDeep(base, local));
}

export function loadConfig() {
  const config = loadWithLocal("default.json");
  if (process.env.CODEX_MOA_BLACKBOARD) config.blackboardDir = process.env.CODEX_MOA_BLACKBOARD;
  return config;
}

export function loadModels() {
  return loadWithLocal("models.json");
}

export function loadSchedule() {
  return loadWithLocal("schedule.json");
}

export function loadPricing() {
  return loadWithLocal("pricing.json");
}

export function loadEvolutionPolicy() {
  const base = loadWithLocal("evolution.json");
  const userPath = resolve(homedir(), ".codex-moa", "evolution-policy.json");
  if (!existsSync(userPath)) return base;
  return expand(mergeDeep(base, readJson(userPath)));
}
