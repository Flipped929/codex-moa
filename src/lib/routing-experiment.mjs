import { createHash } from "node:crypto";
import { homedir } from "node:os";
import { resolve } from "node:path";
import { readJsonStore, updateJsonStore } from "./json-store.mjs";

const ROUTING_VERSION = 2;
const DEFAULT_STATE = { version: ROUTING_VERSION, experiments: {} };
const MIGRATIONS = {
  1: (state) => ({ ...state, experiments: state.experiments ?? {} })
};

function expandHome(value) {
  if (typeof value !== "string") return value;
  if (value === "~") return homedir();
  if (value.startsWith("~/")) return resolve(homedir(), value.slice(2));
  return resolve(value);
}

export function routingExperimentStatePath() {
  return expandHome(process.env.CODEX_MOA_ROUTING_EXPERIMENT_PATH || "~/.codex-moa/routing-experiments.json");
}

function isObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function merge(base, patch) {
  if (!isObject(base) || !isObject(patch)) return patch ?? base;
  const output = { ...base };
  for (const [key, value] of Object.entries(patch)) output[key] = merge(output[key], value);
  return output;
}

export async function readRoutingExperimentState(path = routingExperimentStatePath()) {
  return readJsonStore(path, { version: ROUTING_VERSION, defaultValue: DEFAULT_STATE, migrations: MIGRATIONS });
}

async function updateRoutingState(path, updater) {
  return updateJsonStore(path, async (state) => updater(state), {
    version: ROUTING_VERSION,
    defaultValue: DEFAULT_STATE,
    migrations: MIGRATIONS
  });
}

export function routingExperimentDefinition(policy) {
  const experiment = policy?.routing?.experiment;
  if (!experiment?.id || experiment.enabled !== true) return null;
  if (!experiment.control || !experiment.challenger) return null;
  return experiment;
}

export function selectRoutingVariant({ policy, task, cwd, state = null, forceVariant = null }) {
  const experiment = routingExperimentDefinition(policy);
  if (!experiment) return { enabled: false, id: null, variant: "control", policy, rationale: "routing experiment disabled" };
  const experimentState = state?.experiments?.[experiment.id];
  let variant;
  let rationale;
  let bucket = null;
  if (forceVariant === "control" || forceVariant === "challenger") {
    variant = forceVariant;
    rationale = `${experiment.id}=${variant} (forced by checkpoint)`;
  } else if (experimentState?.status === "rolled_back" || experimentState?.status === "closed") {
    variant = "control";
    rationale = `experiment ${experiment.id} is ${experimentState.status}; routing pinned to control`;
  } else {
    const digest = createHash("sha256").update(`${resolve(cwd || process.cwd())}\n${task}`).digest();
    bucket = digest[0] % 100;
    const controlWeight = Number(experiment.control.weight ?? 50);
    variant = bucket < controlWeight ? "control" : "challenger";
    rationale = `${experiment.id}=${variant} (bucket ${bucket}, control weight ${controlWeight})`;
  }
  const selected = experiment[variant] ?? {};
  return {
    enabled: true,
    id: experiment.id,
    variant,
    bucket,
    forced: forceVariant === "control" || forceVariant === "challenger",
    policy: merge(policy, { routing: selected.policyOverrides ?? {} }),
    rationale
  };
}

function resultSucceeded(result) {
  return result?.status === "done" && result?.timedOut !== true;
}

export async function recordRoutingOutcome(route, { taskId, results, path = routingExperimentStatePath() }) {
  if (!route?.enabled || !route.id) return null;
  let summary = null;
  await updateRoutingState(path, (state) => {
    const experiment = state.experiments[route.id] ??= {
      id: route.id,
      status: "running",
      createdAt: new Date().toISOString(),
      variants: {}
    };
    const variant = experiment.variants[route.variant] ??= { runs: 0, successes: 0, failures: 0 };
    const success = results.length > 0 && results.every(resultSucceeded);
    variant.runs += 1;
    variant.successes += success ? 1 : 0;
    variant.failures += success ? 0 : 1;
    experiment.updatedAt = new Date().toISOString();
    experiment.history = [...(experiment.history ?? []), {
      at: experiment.updatedAt,
      taskId,
      variant: route.variant,
      success,
      results: results.map((result) => ({ seat: result.seat, status: result.status }))
    }].slice(-200);
    summary = { experimentId: route.id, variant: route.variant, success, runs: variant.runs };
    return state;
  });
  return summary;
}

function rate(variant) {
  if (!variant?.runs) return null;
  return variant.successes / variant.runs;
}

export async function evaluateRoutingRollback(route, definition, { path = routingExperimentStatePath() } = {}) {
  if (!route?.enabled || !route.id || !definition) return { rolledBack: false };
  const minSamples = Number(definition.minSamples ?? 8);
  const margin = Number(definition.rollbackMargin ?? 0.15);
  let evaluation = { rolledBack: false };
  await updateRoutingState(path, (state) => {
    const experiment = state.experiments?.[route.id];
    if (!experiment || experiment.status !== "running") {
      evaluation = { rolledBack: false, status: experiment?.status ?? "missing" };
      return state;
    }
    const control = experiment.variants?.control;
    const challenger = experiment.variants?.challenger;
    const controlRate = rate(control);
    const challengerRate = rate(challenger);
    const enoughSamples = (control?.runs ?? 0) >= minSamples && (challenger?.runs ?? 0) >= minSamples;
    const compare = {
      minSamples,
      margin,
      control: { runs: control?.runs ?? 0, successes: control?.successes ?? 0, rate: controlRate },
      challenger: { runs: challenger?.runs ?? 0, successes: challenger?.successes ?? 0, rate: challengerRate }
    };
    if (!enoughSamples || controlRate === null || challengerRate === null || challengerRate >= controlRate - margin) {
      evaluation = { rolledBack: false, comparison: compare };
      return state;
    }
    experiment.status = "rolled_back";
    experiment.rolledBackAt = new Date().toISOString();
    experiment.rollbackReason = `challenger success rate ${(challengerRate * 100).toFixed(1)}% is ${(margin * 100).toFixed(1)} points below control ${(controlRate * 100).toFixed(1)}%`;
    experiment.updatedAt = experiment.rolledBackAt;
    evaluation = { rolledBack: true, experimentId: route.id, reason: experiment.rollbackReason, comparison: compare };
    return state;
  });
  return evaluation;
}

export async function routingExperimentStatus(path = routingExperimentStatePath()) {
  return readRoutingExperimentState(path);
}
