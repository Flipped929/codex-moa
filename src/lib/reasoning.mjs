import { resolveModel } from "./models.mjs";

export const CANONICAL_EFFORTS = ["off", "low", "medium", "high", "xhigh", "max"];
const RANK = Object.fromEntries(CANONICAL_EFFORTS.map((level, index) => [level, index]));

export function normalizeEffort(value) {
  const text = String(value ?? "").toLowerCase().trim();
  if (["none", "disabled", "disable"].includes(text)) return "off";
  if (["minimal", "minimum"].includes(text)) return "low";
  if (["extra-high", "extra_high", "very-high"].includes(text)) return "xhigh";
  return CANONICAL_EFFORTS.includes(text) ? text : null;
}

export function modelReasoning(selector, modelsConfig) {
  return resolveModel(selector, modelsConfig).reasoning ?? { supported: [], default: null, canDisable: false };
}

export function resolveReasoningEffort(selector, requested, modelsConfig) {
  const reasoning = modelReasoning(selector, modelsConfig);
  const supported = reasoning.supported ?? [];
  const normalized = normalizeEffort(requested);
  const mapped = normalized ? normalizeEffort(reasoning.inputAliases?.[normalized]) : null;
  if (mapped && supported.includes(mapped)) return mapped;
  if (normalized && supported.includes(normalized)) return normalized;
  if (normalized === "medium" && supported.includes("high")) return "high";
  if (normalized && supported.length > 0) {
    const target = RANK[normalized];
    return [...supported].sort((a, b) => {
      const distanceA = Math.abs(RANK[a] - target);
      const distanceB = Math.abs(RANK[b] - target);
      if (distanceA !== distanceB) return distanceA - distanceB;
      return target >= RANK.high ? RANK[b] - RANK[a] : RANK[a] - RANK[b];
    })[0];
  }
  return reasoning.default ?? supported[0] ?? "off";
}

export function effortForTask({ level = "L1", role = "executor", stakes = "medium", quotaPercent = null, requested, policy = null } = {}) {
  if (requested) return { effort: requested, source: "explicit", rationale: "explicit reasoningEffort" };
  const rules = policy?.reasoning ?? {};
  let effort = rules.defaultByLevel?.[level] ?? (level === "L0" ? "off" : level === "L1" ? "low" : level === "L3" ? "max" : "high");
  if (role === "auditor" || role === "reviewer") effort = rules.auditByStakes?.[stakes] ?? (stakes === "high" ? "max" : "high");
  if (role === "architect") effort = rules.architectByLevel?.[level] ?? (level === "L3" ? "max" : "high");
  if (role === "vision") effort = rules.vision ?? "high";
  const downgradeBelow = Number(rules.quotaDowngradeBelow ?? 10);
  if (quotaPercent !== null && quotaPercent < downgradeBelow && !["auditor", "reviewer"].includes(role)) {
    const index = Math.max(0, RANK[effort] - 1);
    effort = CANONICAL_EFFORTS[index];
  }
  return { effort, source: "task-policy", rationale: `${level}/${role}/${stakes}${quotaPercent !== null ? `/quota:${quotaPercent}` : ""}` };
}
