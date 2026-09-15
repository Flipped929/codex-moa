import { loadModels } from "./config.mjs";
import { loadEffectiveModels } from "./effective-models.mjs";
import { resolveModel } from "./models.mjs";
import { readCcSwitchSnapshot } from "./ccswitch.mjs";

function inferFamily(value) {
  const text = String(value ?? "").toLowerCase();
  if (!text || text === "codex-selected") return "unknown";
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
  const modelsConfig = loadEffectiveModels();
  let ccswitchProvider = null;
  let ccswitch = ccswitchSnapshot;
  try {
    ccswitch = ccswitch ?? await readCcSwitchSnapshot();
    ccswitchProvider = ccswitch?.currentProviders?.codex ?? null;
  } catch {}

  // MCP servers do not receive the active thread's model selection. Reading the
  // global config or CC Switch card can therefore misidentify a page-level model.
  // Only trust the model when the Codex caller supplies it for this invocation.
  const selected = captainModel || "codex-selected";
  const canonical = canonicalize(selected, modelsConfig);
  return {
    model: selected,
    canonicalModel: canonical?.id ?? null,
    harness: canonical?.harness ?? null,
    family: canonical?.family ?? inferFamily(selected),
    source: captainModel ? "explicit" : "active-codex-thread",
    provider: ccswitchProvider ? { id: ccswitchProvider.id, name: ccswitchProvider.name, appType: ccswitchProvider.appType } : null,
    note: captainModel
      ? "Codex main model was reported explicitly and is never overridden. Sub-agents are selected independently."
      : "The active Codex thread remains captain. Its page-level model is intentionally not guessed from global config or CC Switch."
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
