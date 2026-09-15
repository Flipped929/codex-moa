import { summarizeCostLedger } from "./cost-ledger.mjs";
import { listModels } from "./models.mjs";
import { providerCircuitStatus } from "./provider-state.mjs";

const SEVERITY = { healthy: 0, inactive: 1, warning: 2, critical: 3 };

function worstStatus(statuses) {
  return statuses.reduce((worst, status) => SEVERITY[status] > SEVERITY[worst] ? status : worst, "healthy");
}

function providerState(quota, recent) {
  if (!quota || quota.status === "not_configured") return "inactive";
  if (quota.status === "unauthorized" || quota.status === "rate_limited") return "critical";
  if (quota.status !== "ok") return "warning";
  const emptyBalance = (quota.windows ?? []).some((window) => window.kind === "billing" && Number.isFinite(Number(window.remaining)) && Number(window.remaining) <= 0);
  if (emptyBalance) return "critical";
  const low = (quota.windows ?? []).some((window) => Number.isFinite(Number(window.remainingPercent)) && Number(window.remainingPercent) <= Number(quota.lowThreshold ?? 10));
  if (low) return "warning";
  if (recent?.runs >= 3 && recent.failures / recent.runs >= 0.5) return "warning";
  return "healthy";
}

export function summarizeProviderHealth({ snapshot, ledger = [], lowThreshold = 10, recentHours = 24, circuitState = null, config = {} } = {}) {
  const cutoff = Date.now() - recentHours * 3600000;
  const recentLedger = ledger.filter((entry) => !entry.time || Date.parse(entry.time) >= cutoff);
  const cost = summarizeCostLedger(recentLedger);
  const providers = {};
  for (const id of ["kimi", "zai", "deepseek"]) {
    const quota = snapshot?.providers?.[id] ?? { provider: id, status: "not_configured", windows: [] };
    const recent = cost.providers?.[id] ?? { runs: 0, failures: 0, tokens: 0 };
    const circuit = providerCircuitStatus(circuitState, id, config);
    let status = providerState({ ...quota, lowThreshold }, recent);
    if (circuit.circuit === "open") status = "critical";
    else if (circuit.circuit === "half-open" && status === "healthy") status = "warning";
    else if (circuit.latencyWarning && status === "healthy") status = "warning";
    const lowWindows = (quota.windows ?? []).filter((window) => Number.isFinite(Number(window.remainingPercent)) && Number(window.remainingPercent) <= lowThreshold);
    providers[id] = {
      provider: id,
      status,
      quotaStatus: quota.status,
      plan: quota.plan ?? null,
      windows: quota.windows ?? [],
      lowWindows: lowWindows.map((window) => ({ kind: window.kind, label: window.label, remainingPercent: window.remainingPercent })),
      recentRuns: recent.runs ?? 0,
      recentFailures: recent.failures ?? 0,
      circuit: circuit.circuit,
      consecutiveFailures: circuit.consecutiveFailures,
      openUntil: circuit.openUntil,
      p50LatencyMs: circuit.p50LatencyMs,
      p95LatencyMs: circuit.p95LatencyMs,
      lastErrorKind: circuit.lastErrorKind,
      updatedAt: snapshot?.updatedAt ?? null
    };
  }
  return {
    overall: worstStatus(Object.values(providers).map((provider) => provider.status)),
    providers,
    cost
  };
}


function providerForFamily(family) {
  if (family === "moonshot") return "kimi";
  if (family === "zhipu") return "zai";
  if (family === "deepseek") return "deepseek";
  return "unknown";
}

export function applyProviderHealthRouting(seats, { health, modelsConfig, captain = null, allowUnhealthy = false } = {}) {
  if (!health?.providers) return { adjustments: [], blocked: [] };
  const candidates = listModels(modelsConfig);
  const adjustments = [];
  const blocked = [];
  for (const seat of seats) {
    const currentProvider = providerForFamily(seat.family ?? modelsConfig.models?.[seat.model]?.family);
    const currentStatus = health.providers[currentProvider]?.status ?? "healthy";
    if (!["critical", "inactive"].includes(currentStatus)) continue;
    if (allowUnhealthy) {
      adjustments.push({ seat: seat.seat, action: "allowed_unhealthy", from: seat.model, provider: currentProvider, status: currentStatus });
      continue;
    }
    const replacement = candidates
      .filter((model) => model.id !== seat.model)
      .filter((model) => model.tier === (seat.modelTier ?? modelsConfig.models?.[seat.model]?.tier))
      .filter((model) => model.capabilities?.includes("text") !== false)
      .filter((model) => !(seat.role === "auditor" && captain?.family && model.family === captain.family))
      .filter((model) => health.providers[providerForFamily(model.family)]?.status !== "critical")
      .filter((model) => health.providers[providerForFamily(model.family)]?.status !== "inactive")
      .sort((left, right) => {
        const leftSameHarness = left.harness === seat.harness ? 0 : 1;
        const rightSameHarness = right.harness === seat.harness ? 0 : 1;
        return leftSameHarness - rightSameHarness;
      })[0];
    if (!replacement) {
      blocked.push({ seat: seat.seat, provider: currentProvider, status: currentStatus, model: seat.model });
      continue;
    }
    adjustments.push({
      seat: seat.seat,
      action: "rerouted",
      from: seat.model,
      fromProvider: currentProvider,
      fromStatus: currentStatus,
      to: replacement.id,
      toProvider: providerForFamily(replacement.family),
      toHarness: replacement.harness
    });
    seat.originalModel = seat.model;
    seat.model = replacement.id;
    seat.providerModel = replacement.providerModel;
    seat.dsh = replacement.dsh;
    seat.harness = replacement.harness;
    seat.modelTier = replacement.tier;
    seat.healthAdjusted = true;
  }
  return { adjustments, blocked };
}
