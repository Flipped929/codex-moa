import { existsSync, lstatSync, mkdirSync, readFileSync, readlinkSync, symlinkSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join, resolve } from "node:path";

function expandHome(value) {
  if (typeof value !== "string") return value;
  if (value === "~") return homedir();
  if (value.startsWith("~/")) return resolve(homedir(), value.slice(2));
  return resolve(value);
}

function setTopLevelValue(text, blockName, key, value) {
  const lines = text.split(/\r?\n/);
  const start = lines.findIndex((line) => line === `${blockName}:`);
  if (start < 0) return text;
  for (let index = start + 1; index < lines.length; index += 1) {
    const line = lines[index];
    if (line && !line.startsWith(" ")) break;
    if (line.startsWith(`  ${key}:`)) {
      lines[index] = `  ${key}: ${value}`;
      break;
    }
  }
  return lines.join("\n");
}

function setModelMaxTokens(text, providerName, modelId, value) {
  const lines = text.split(/\r?\n/);
  const providerStart = lines.findIndex((line) => line === `${providerName}:`);
  if (providerStart < 0) return text;
  for (let index = providerStart + 1; index < lines.length; index += 1) {
    if (lines[index] && !lines[index].startsWith(" ")) break;
    if (lines[index].trim() !== `- id: ${modelId}`) continue;
    for (let child = index + 1; child < lines.length; child += 1) {
      if (lines[child].startsWith("    - id:")) break;
      if (lines[child].startsWith("      maxTokens:")) {
        lines[child] = `      maxTokens: ${value}`;
        return lines.join("\n");
      }
    }
  }
  return text;
}

function ensureSymlink(target, source) {
  if (!existsSync(source)) return;
  try {
    const stat = lstatSync(target);
    if (stat.isSymbolicLink() && readlinkSync(target) === source) return;
    return;
  } catch {}
  symlinkSync(source, target);
}

export async function prepareDshHome(reasoningEffort = "high", options = {}) {
  const sourceHome = expandHome(options.sourceHome || process.env.DSH_HOME || "~/.dsh");
  const root = expandHome(options.targetRoot || "~/.codex-moa/dsh-homes");
  const effort = ["off", "low", "high", "max"].includes(reasoningEffort) ? reasoningEffort : "high";
  const outputBudget = Number(options.outputBudget ?? 0);
  const target = join(root, outputBudget > 0 ? `${effort}-out-${outputBudget}` : effort);
  await mkdir(target, { recursive: true });

  const sourceSettings = join(sourceHome, "settings.yaml");
  let settings = existsSync(sourceSettings) ? readFileSync(sourceSettings, "utf8") : "";
  settings = setTopLevelValue(settings, "agent-default-model", "reasoningEffort", effort);
  settings = setTopLevelValue(settings, "llm-deepseek", "reasoningEffort", effort);
  if (outputBudget > 0) settings = setModelMaxTokens(settings, "llm-deepseek", "deepseek-flash", outputBudget);
  await writeFile(join(target, "settings.yaml"), settings, "utf8");

  ensureSymlink(join(target, "profiles"), join(sourceHome, "profiles"));
  ensureSymlink(join(target, "skills"), join(sourceHome, "skills"));
  ensureSymlink(join(target, ".credentials.yaml"), join(sourceHome, ".credentials.yaml"));
  ensureSymlink(join(target, "cordis.patch.yml"), join(sourceHome, "cordis.patch.yml"));
  mkdirSync(join(target, "sessions"), { recursive: true });
  mkdirSync(join(target, "storages"), { recursive: true });
  return { home: target, effort, outputBudget: outputBudget > 0 ? outputBudget : null };
}
