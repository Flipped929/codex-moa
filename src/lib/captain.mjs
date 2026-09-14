import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { loadModels } from "./config.mjs";
import { resolveModel } from "./models.mjs";
import { readCcSwitchSnapshot } from "./ccswitch.mjs";

function readCodexConfigModel() {
  const path = join(homedir(), ".codex", "config.toml");
  try {
    const text = readFileSync(path, "utf8");
    return text.match(/^\s*model\s*=\s*["']([^"']+)["']/m)?.[1] ?? null;
  } catch {
    return null;
  }
}

function inferFamily(value) {
  const text = String(value ?? "").toLowerCase();
  if (/kimi|moonshot|k2|k3/.test(text)) return "moonshot";
  if (/glm|zhipu|bigmodel|z\.ai/.test(text)) return "zhipu";
  if (/deepseek/.test(text)) return "deepseek";
  if (/gpt|openai|codex|o[0-9]/.test(text)) return "openai";
  return "unknown";
}

function canonicalize(value, modelsConfig) {
  if (!value) return null;
  try { return resolveModel(value, modelsConfig); } catch { return null; }
}

export async function resolveCaptain({ captainModel, ccswitchSnapshot } = {}) {
  const modelsConfig = loadModels();
  const envModel = process.env.CODEX_MOA_CAPTAIN_MODEL || null;
  const configModel = readCodexConfigModel();
  let ccswitchModel = null;
  let ccswitchProvider = null;
  let ccswitch = ccswitchSnapshot;
  try {
    ccswitch = ccswitch ?? await readCcSwitchSnapshot();
    ccswitchProvider = ccswitch?.currentProviders?.codex ?? null;
    for (const hint of ccswitchProvider?.models ?? []) {
      if (canonicalize(hint, modelsConfig)) {
        ccswitchModel = hint;
        break;
      }
    }
    if (!ccswitchModel && ccswitchProvider?.name) ccswitchModel = ccswitchProvider.name;
  } catch {}

  const selected = captainModel || envModel || configModel || ccswitchModel || "codex-selected";
  const canonical = canonicalize(selected, modelsConfig);
  return {
    model: selected,
    canonicalModel: canonical?.id ?? null,
    harness: canonical?.harness ?? null,
    family: canonical?.family ?? inferFamily(selected),
    source: captainModel ? "explicit"
      : envModel ? "environment"
        : configModel ? "codex-config"
          : ccswitchModel ? "cc-switch"
            : "fallback",
    provider: ccswitchProvider ? { id: ccswitchProvider.id, name: ccswitchProvider.name, appType: ccswitchProvider.appType } : null,
    note: "Codex main model is never overridden. Sub-agents are selected independently."
  };
}

export function auditConflict(captain, assignments, modelsConfig = loadModels()) {
  if (!captain?.family || captain.family === "unknown") return [];
  const conflicts = [];
  for (const assignment of assignments ?? []) {
    let model;
    try { model = resolveModel(assignment.model, modelsConfig); } catch { continue; }
    const role = assignment.role ?? "executor";
    const isAuditRole = role === "auditor" || role === "reviewer";
    if (isAuditRole && model.family === captain.family) conflicts.push({ assignment, model, reason: "same-family-audit" });
  }
  return conflicts;
}
