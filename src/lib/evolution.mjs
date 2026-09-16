import { existsSync, readFileSync } from "node:fs";
import { appendFile, chmod, copyFile, mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { createHash, randomUUID } from "node:crypto";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { loadEvolutionPolicy } from "./config.mjs";
import { loadEffectiveModels } from "./effective-models.mjs";
import { normalizeEffort, resolveReasoningEffort } from "./reasoning.mjs";
import { resolveModel } from "./models.mjs";
import { readAuditMetrics, summarizeAuditMetrics } from "./audit-metrics.mjs";
import { readFailureMemory, summarizeFailureMemory } from "./failure-memory.mjs";

function expandHome(value) {
  if (typeof value !== "string") return value;
  if (value === "~") return homedir();
  if (value.startsWith("~/")) return resolve(homedir(), value.slice(2));
  return resolve(value);
}

export function evolutionPaths() {
  const root = expandHome(process.env.CODEX_MOA_EVOLUTION_HOME || "~/.codex-moa/evolution");
  return {
    root,
    events: join(root, "events.jsonl"),
    outcomes: join(root, "outcomes.jsonl"),
    proposals: join(root, "proposals"),
    backups: join(root, "backups")
  };
}

export function policyPath() {
  return expandHome(process.env.CODEX_MOA_POLICY_PATH || "~/.codex-moa/evolution-policy.json");
}

export async function ensureEvolutionStore(paths = evolutionPaths()) {
  for (const path of [paths.root, paths.proposals, paths.backups]) await mkdir(path, { recursive: true });
}

function id(prefix = "evo") {
  return `${prefix}-${new Date().toISOString().replace(/[-:.TZ]/g, "").slice(0, 14)}-${randomUUID().slice(0, 8)}`;
}

function validateProposalId(proposalId) {
  const value = String(proposalId ?? "");
  if (!/^evo-[A-Za-z0-9-]{8,80}$/.test(value)) throw new Error(`Invalid proposal ID: ${value}`);
  return value;
}

function hash(value) {
  return createHash("sha256").update(String(value)).digest("hex");
}

function stableJson(value) {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableJson(value[key])}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

function summarizeReliability(states, minimumSamples = 3) {
  return Object.fromEntries(Object.entries(states).map(([key, state]) => [key, {
    ...state,
    successRate: state.runs ? state.done / state.runs : null,
    failureRate: state.runs ? state.failed / state.runs : null,
    timeoutRate: state.runs ? state.timedOut / state.runs : null,
    outputTps: Number(state.durationMs) > 0 ? Number(state.outputTokens ?? 0) / (Number(state.durationMs) / 1000) : null,
    sampleSufficient: state.runs >= minimumSamples
  }]));
}

const DANGEROUS_KEYS = new Set(["__proto__", "prototype", "constructor"]);
const ALLOWED_POLICY_KEYS = new Set(["version", "audit", "routing", "timeouts", "reasoning"]);
const PROPOSAL_TTL_DAYS = 30;

export function validatePolicyPatch(patch, topLevel = true) {
  if (patch === null || typeof patch !== "object" || Array.isArray(patch)) throw new Error("policyPatch must be a JSON object");
  for (const [key, value] of Object.entries(patch)) {
    if (DANGEROUS_KEYS.has(key)) throw new Error(`Unsafe policy key: ${key}`);
    if (topLevel && !ALLOWED_POLICY_KEYS.has(key)) throw new Error(`Unsupported evolution policy key: ${key}`);
    if (value && typeof value === "object" && !Array.isArray(value)) validatePolicyPatch(value, false);
  }
  return patch;
}

function effortEntries(reasoning = {}) {
  const entries = [];
  for (const [field, values] of Object.entries({
    defaultByLevel: reasoning.defaultByLevel,
    auditByStakes: reasoning.auditByStakes,
    architectByLevel: reasoning.architectByLevel
  })) {
    for (const [key, value] of Object.entries(values ?? {})) entries.push({ path: `reasoning.${field}.${key}`, value });
  }
  if (reasoning.vision !== undefined) entries.push({ path: "reasoning.vision", value: reasoning.vision });
  for (const [model, profile] of Object.entries(reasoning.byModel ?? {})) {
    for (const [level, value] of Object.entries(profile?.byLevel ?? {})) {
      entries.push({ path: `reasoning.byModel.${model}.byLevel.${level}`, value, model });
    }
  }
  return entries;
}

export function validateReasoningPolicyPatch(patch, modelsConfig = loadEffectiveModels()) {
  const reasoning = patch?.reasoning;
  if (!reasoning) return { ok: true, checks: [], modelCapabilities: {} };
  if (reasoning.mode !== undefined && !["task-aware", "provider-default"].includes(reasoning.mode)) {
    throw new Error(`Unsupported reasoning.mode: ${reasoning.mode}`);
  }
  const checks = [];
  for (const entry of effortEntries(reasoning)) {
    const normalized = normalizeEffort(entry.value);
    if (!normalized) throw new Error(`Unsupported reasoning effort at ${entry.path}: ${entry.value}`);
    if (entry.model) {
      const model = resolveModel(entry.model, modelsConfig);
      const effective = resolveReasoningEffort(model.id, normalized, modelsConfig);
      if (effective !== normalized) {
        throw new Error(`${entry.path}=${normalized} is not an effective effort for ${model.id}; current capability maps it to ${effective}`);
      }
      checks.push({ path: entry.path, requested: normalized, effective, model: model.id });
    } else {
      checks.push({ path: entry.path, requested: normalized, effective: null, model: null });
    }
  }
  const modelCapabilities = Object.fromEntries(Object.entries(modelsConfig.models ?? {}).map(([id, model]) => [id, {
    supported: model.reasoning?.supported ?? [],
    default: model.reasoning?.default ?? null,
    source: modelsConfig.reasoningSources?.[id] ?? "local"
  }]));
  return { ok: true, checks, modelCapabilities };
}

export function deepMerge(base, patch) {
  if (patch === null || typeof patch !== "object" || Array.isArray(patch)) return patch;
  const output = base && typeof base === "object" && !Array.isArray(base) ? { ...base } : {};
  for (const [key, value] of Object.entries(patch)) output[key] = deepMerge(output[key], value);
  return output;
}

export async function recordEvolutionEvent(event, paths = evolutionPaths()) {
  await ensureEvolutionStore(paths);
  await appendFile(paths.events, `${JSON.stringify({ time: new Date().toISOString(), ...event })}\n`, "utf8");
}

export async function recordOutcome(outcome, paths = evolutionPaths()) {
  await ensureEvolutionStore(paths);
  await appendFile(paths.outcomes, `${JSON.stringify({ time: new Date().toISOString(), ...outcome, stage: outcome.stage ?? "final" })}\n`, "utf8");
}

async function readJsonl(path) {
  try {
    return (await readFile(path, "utf8")).split(/\r?\n/).filter(Boolean).map((line) => JSON.parse(line));
  } catch {
    return [];
  }
}

export async function analyzeEvolution(paths = evolutionPaths(), limit = 200) {
  const events = (await readJsonl(paths.events)).slice(-limit);
  const outcomes = (await readJsonl(paths.outcomes)).slice(-limit);
  const seatStates = {};
  const models = {};
  const reasoningRoutes = {};
  const executionRoutes = {};
  let auditWarnings = 0;
  let timeouts = 0;
  const finalOutcomes = outcomes.filter((outcome) => !outcome.stage || outcome.stage === "final");
  const finalOutcomeByTask = new Map(finalOutcomes.map((outcome) => [outcome.taskId, outcome]));
  let automaticStageReviews = 0;
  for (const event of events) {
    if (event.type === "task_completed") {
      auditWarnings += event.auditWarnings?.length ?? 0;
      automaticStageReviews += event.stageReviews?.length ?? 0;
      for (const result of event.results ?? []) {
        const seat = result.seat ?? "unknown";
        seatStates[seat] ??= { runs: 0, done: 0, failed: 0, timedOut: 0 };
        seatStates[seat].runs += 1;
        if (result.status === "done") seatStates[seat].done += 1;
        else seatStates[seat].failed += 1;
        if (result.timedOut) { seatStates[seat].timedOut += 1; timeouts += 1; }
        const model = result.requestedModel ?? "unknown";
        models[model] ??= { runs: 0, done: 0, failed: 0, timedOut: 0 };
        models[model].runs += 1;
        if (result.status === "done") models[model].done += 1;
        else models[model].failed += 1;
        if (result.timedOut) models[model].timedOut += 1;
        const effort = result.reasoningEffort ?? "provider-default";
        const harness = result.harness ?? "unknown";
        const route = `${model}@${harness}@${effort}`;
        reasoningRoutes[route] ??= { model, harness, effort, source: result.reasoningSource ?? "unknown", runs: 0, done: 0, failed: 0, timedOut: 0, durationMs: 0, totalTokens: 0, outputTokens: 0 };
        reasoningRoutes[route].runs += 1;
        reasoningRoutes[route].done += result.status === "done" ? 1 : 0;
        reasoningRoutes[route].failed += result.status === "done" ? 0 : 1;
        reasoningRoutes[route].timedOut += result.timedOut ? 1 : 0;
        reasoningRoutes[route].durationMs += Number(result.durationMs) || 0;
        reasoningRoutes[route].totalTokens += Number(result.usage?.totalTokens) || 0;
        reasoningRoutes[route].outputTokens += Number(result.usage?.outputTokens) || 0;
        if (result.role === "executor") {
          const executionKey = `${event.level ?? "unknown"}:${model}@${harness}`;
          executionRoutes[executionKey] ??= {
            level: event.level ?? "unknown",
            model,
            harness,
            runs: 0,
            done: 0,
            failed: 0,
            timedOut: 0,
            adjudicated: 0,
            accepted: 0,
            rejected: 0,
            testsPassed: 0,
            testsFailed: 0,
            rated: 0,
            qualityTotal: 0,
            durationMs: 0,
            outputTokens: 0,
            estimatedUsd: 0,
            pricedRuns: 0
          };
          const state = executionRoutes[executionKey];
          const outcome = finalOutcomeByTask.get(event.taskId);
          state.runs += 1;
          state.done += result.status === "done" ? 1 : 0;
          state.failed += result.status === "done" ? 0 : 1;
          state.timedOut += result.timedOut ? 1 : 0;
          state.durationMs += Number(result.durationMs) || 0;
          state.outputTokens += Number(result.usage?.outputTokens) || 0;
          if (Number.isFinite(Number(result.estimatedUsd))) {
            state.estimatedUsd += Number(result.estimatedUsd);
            state.pricedRuns += 1;
          }
          if (outcome) {
            state.adjudicated += 1;
            state.accepted += outcome.accepted === true ? 1 : 0;
            state.rejected += outcome.accepted === false ? 1 : 0;
            state.testsPassed += outcome.testsPassed === true ? 1 : 0;
            state.testsFailed += outcome.testsPassed === false ? 1 : 0;
            if (Number.isFinite(Number(outcome.quality))) {
              state.rated += 1;
              state.qualityTotal += Number(outcome.quality);
            }
          }
        }
      }
    }
  }
  for (const state of Object.values(executionRoutes)) {
    state.completionRate = state.runs ? state.done / state.runs : null;
    state.acceptanceRate = state.adjudicated ? state.accepted / state.adjudicated : null;
    state.testsPassRate = state.testsPassed + state.testsFailed > 0 ? state.testsPassed / (state.testsPassed + state.testsFailed) : null;
    state.averageQuality = state.rated ? state.qualityTotal / state.rated : null;
    state.outputTps = state.durationMs > 0 ? state.outputTokens / (state.durationMs / 1000) : null;
    state.costPerAcceptedTask = state.accepted > 0 && state.pricedRuns > 0 ? state.estimatedUsd / state.accepted : null;
    state.sampleSufficient = state.runs >= 3 && state.adjudicated >= 3;
    state.qualityGatePassed = state.sampleSufficient
      && state.completionRate >= 0.75
      && state.acceptanceRate >= 0.75
      && (state.averageQuality === null || state.averageQuality >= 7);
  }
  const bestQualifiedRouteByLevel = {};
  for (const level of new Set(Object.values(executionRoutes).map((state) => state.level))) {
    const candidates = Object.entries(executionRoutes).filter(([, state]) => state.level === level && state.qualityGatePassed);
    candidates.sort(([, left], [, right]) => {
      for (const field of ["acceptanceRate", "averageQuality", "testsPassRate", "completionRate"]) {
        const difference = (Number(right[field]) || 0) - (Number(left[field]) || 0);
        if (difference !== 0) return difference;
      }
      if (left.costPerAcceptedTask !== null && right.costPerAcceptedTask !== null) {
        const costDifference = left.costPerAcceptedTask - right.costPerAcceptedTask;
        if (costDifference !== 0) return costDifference;
      }
      return (left.durationMs / left.runs) - (right.durationMs / right.runs);
    });
    if (candidates[0]) {
      const [route, state] = candidates[0];
      bestQualifiedRouteByLevel[level] = {
        route,
        qualityGatePassed: true,
        acceptanceRate: state.acceptanceRate,
        averageQuality: state.averageQuality,
        testsPassRate: state.testsPassRate,
        completionRate: state.completionRate,
        costPerAcceptedTask: state.costPerAcceptedTask,
        averageDurationMs: state.durationMs / state.runs,
        note: "Observed leader only; routing changes require a separate proposal and user approval."
      };
    }
  }
  const accepted = finalOutcomes.filter((outcome) => outcome.accepted === true).length;
  const ratedOutcomes = finalOutcomes.filter((outcome) => Number.isFinite(Number(outcome.quality)));
  const rated = ratedOutcomes.length;
  const averageQuality = rated
    ? ratedOutcomes.reduce((sum, outcome) => sum + Number(outcome.quality), 0) / rated
    : null;
  const auditMetrics = summarizeAuditMetrics(await readAuditMetrics());
  const failureMemory = summarizeFailureMemory(await readFailureMemory());
  return {
    sample: { events: events.length, outcomes: outcomes.length },
    auditWarnings,
    timeouts,
    accepted,
    acceptanceRate: finalOutcomes.length ? accepted / finalOutcomes.length : null,
    averageQuality,
    seats: summarizeReliability(seatStates),
    models: summarizeReliability(models),
    reasoningRoutes: summarizeReliability(reasoningRoutes),
    executionRoutes,
    bestQualifiedRouteByLevel,
    stageReviews: {
      automatic: automaticStageReviews,
      captainRecorded: outcomes.filter((outcome) => outcome.stage && outcome.stage !== "final").length,
      byStage: Object.fromEntries(["plan", "execution", "audit", "final"].map((stage) => [stage, outcomes.filter((outcome) => (outcome.stage ?? "final") === stage).length]))
    },
    auditMetrics,
    failureMemory,
    evidencePolicy: {
      minimumSamples: 3,
      qualityGate: "Task completion and accepted outcomes take precedence over throughput.",
      throughputWeight: 0.2,
      routeQualityGate: { completionRate: 0.75, acceptanceRate: 0.75, averageQuality: 7 },
      note: "Compare routes within the same task level. Completion, captain acceptance, tests, and quality gate first; known cost, latency, and TPS are tie-breakers. Sparse evidence is descriptive and policy changes remain proposal-first."
    }
  };
}

async function writeJson(path, value) {
  await mkdir(dirname(path), { recursive: true });
  const temporary = `${path}.${randomUUID()}.tmp`;
  await writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 });
  await rename(temporary, path);
  await chmod(path, 0o600);
}

async function normalizeProposalExpiry(proposal, file) {
  const createdAt = Date.parse(proposal.createdAt);
  const fallbackExpiry = Number.isFinite(createdAt) ? createdAt + PROPOSAL_TTL_DAYS * 86400000 : Date.now();
  proposal.expiresAt ??= new Date(fallbackExpiry).toISOString();
  if (proposal.status === "proposed" && Date.parse(proposal.expiresAt) < Date.now()) {
    proposal.status = "expired";
    proposal.expiredAt = new Date().toISOString();
    await writeJson(file, proposal);
  }
  return proposal;
}

export async function createProposal(input, paths = evolutionPaths()) {
  validatePolicyPatch(input.policyPatch ?? {});
  const reasoningCompatibility = validateReasoningPolicyPatch(input.policyPatch ?? {});
  await ensureEvolutionStore(paths);
  const fingerprint = hash(stableJson(input.policyPatch ?? {}));
  const existing = (await listProposals(paths)).find((proposal) =>
    proposal.fingerprint === fingerprint && ["proposed", "approved", "applied"].includes(proposal.status)
  );
  if (existing) return { ...existing, deduplicated: true };
  const proposal = {
    id: id(),
    createdAt: new Date().toISOString(),
    expiresAt: new Date(Date.now() + PROPOSAL_TTL_DAYS * 86400000).toISOString(),
    status: "proposed",
    requiresApproval: true,
    targetFile: "~/.codex-moa/evolution-policy.json",
    title: input.title,
    problem: input.problem,
    evidence: input.evidence ?? [],
    policyPatch: input.policyPatch,
    reasoningCompatibility,
    fingerprint,
    expectedBenefit: input.expectedBenefit ?? null,
    risks: input.risks ?? [],
    evaluationPlan: input.evaluationPlan ?? [
      "Inspect proposal diff and evidence.",
      "Run npm test.",
      "Compare task outcomes before and after applying the policy."
    ],
    rollbackPlan: input.rollbackPlan ?? "Restore the backed-up config/evolution.json and mark the proposal rolled_back.",
    approvalCommand: `APPROVE ${"{id}"}`,
    applyCommand: `APPLY ${"{id}"}`
  };
  proposal.approvalCommand = `APPROVE ${proposal.id}`;
  proposal.applyCommand = `APPLY ${proposal.id}`;
  await writeJson(join(paths.proposals, `${proposal.id}.json`), proposal);
  return proposal;
}

export async function listProposals(paths = evolutionPaths()) {
  await ensureEvolutionStore(paths);
  const files = [];
  try {
    const { readdir } = await import("node:fs/promises");
    for (const file of await readdir(paths.proposals)) if (file.endsWith(".json")) files.push(join(paths.proposals, file));
  } catch {}
  const proposals = [];
  for (const file of files) {
    try {
      proposals.push(await normalizeProposalExpiry(JSON.parse(await readFile(file, "utf8")), file));
    } catch {}
  }
  return proposals.sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));
}

export async function getProposal(proposalId, paths = evolutionPaths()) {
  const safeId = validateProposalId(proposalId);
  const file = join(paths.proposals, `${safeId}.json`);
  return normalizeProposalExpiry(JSON.parse(await readFile(file, "utf8")), file);
}

async function saveProposal(proposal, paths = evolutionPaths()) {
  await writeJson(join(paths.proposals, `${proposal.id}.json`), proposal);
}

export async function updateProposalStatus(proposalId, status, confirmation, expectedConfirmation, paths = evolutionPaths()) {
  const proposal = await getProposal(proposalId, paths);
  if (confirmation !== expectedConfirmation) throw new Error(`Confirmation mismatch. Expected: ${expectedConfirmation}`);
  if (proposal.status === status) return proposal;
  if (!["approved", "rejected"].includes(status)) throw new Error(`Unsupported proposal status transition: ${status}`);
  if (proposal.status !== "proposed") throw new Error(`Proposal ${proposalId} is ${proposal.status}; expected proposed`);
  proposal.status = status;
  proposal[`${status}At`] = new Date().toISOString();
  await saveProposal(proposal, paths);
  return proposal;
}

export async function proposeFromEvidence(paths = evolutionPaths(), policyFile = null) {
  const analysis = await analyzeEvolution(paths);
  const policy = policyFile ? JSON.parse(await readFile(policyFile, "utf8")) : loadEvolutionPolicy();
  const proposals = [];
  if (analysis.auditWarnings > 0 && policy.audit?.avoidCaptainFamily !== true) {
    proposals.push(await createProposal({
      title: "Enable captain-family-aware audit routing",
      problem: `${analysis.auditWarnings} audit warning(s) were observed in recent tasks.`,
      evidence: [`auditWarnings=${analysis.auditWarnings}`],
      policyPatch: { audit: { avoidCaptainFamily: true } },
      expectedBenefit: "Reduce same-family audit bias and improve heterogeneous validation.",
      risks: ["May require changing an automatically selected audit seat.", "Explicit user assignments remain unchanged."]
    }, paths));
  }
  const deepTimeouts = Object.values(analysis.seats ?? {}).reduce((sum, seat) => sum + (seat.timedOut ?? 0), 0);
  if (deepTimeouts >= 3) {
    proposals.push(await createProposal({
      title: "Increase deep-seat timeout budget",
      problem: `${deepTimeouts} external seat timeout(s) were observed.`,
      evidence: [`timeouts=${deepTimeouts}`],
      policyPatch: { timeouts: { deepMs: 1500000 } },
      expectedBenefit: "Reduce avoidable failures on long-running deep tasks.",
      risks: ["Higher wall-clock latency.", "More quota consumption before timeout."]
    }, paths));
  }
  if (proposals.length === 0) {
    return {
      analysis,
      proposals: [],
      message: "Insufficient evidence for a policy evolution proposal. Record more task outcomes first."
    };
  }
  return { analysis, proposals };
}

export async function applyProposal(proposalId, confirmation, paths = evolutionPaths(), target = policyPath()) {
  const proposal = await getProposal(proposalId, paths);
  if (proposal.status !== "approved") throw new Error(`Proposal ${proposalId} must be approved first`);
  if (confirmation !== `APPLY ${proposalId}`) throw new Error(`Confirmation mismatch. Expected: APPLY ${proposalId}`);
  let current = {};
  let hadTarget = true;
  try {
    current = JSON.parse(await readFile(target, "utf8"));
  } catch {
    hadTarget = false;
  }
  validatePolicyPatch(proposal.policyPatch ?? {});
  proposal.reasoningCompatibility = validateReasoningPolicyPatch(proposal.policyPatch ?? {});
  const next = deepMerge(current, proposal.policyPatch ?? {});
  const backupDir = join(paths.backups, proposalId);
  await mkdir(backupDir, { recursive: true });
  const backupFile = join(backupDir, "evolution-policy.json");
  if (hadTarget) {
    await copyFile(target, backupFile);
    await chmod(backupFile, 0o600);
  } else {
    await writeFile(backupFile, "{}\n", { mode: 0o600 });
  }
  await writeJson(target, next);
  proposal.status = "applied";
  proposal.appliedAt = new Date().toISOString();
  proposal.backupFile = backupFile;
  proposal.hadTarget = hadTarget;
  proposal.beforeHash = hash(JSON.stringify(current));
  proposal.afterHash = hash(JSON.stringify(next));
  await saveProposal(proposal, paths);
  await recordEvolutionEvent({ type: "proposal_applied", proposalId, title: proposal.title, policyPatch: proposal.policyPatch }, paths);
  return proposal;
}

export async function rollbackProposal(proposalId, confirmation, paths = evolutionPaths(), target = policyPath()) {
  const proposal = await getProposal(proposalId, paths);
  if (proposal.status !== "applied") throw new Error(`Proposal ${proposalId} is not applied`);
  if (confirmation !== `ROLLBACK ${proposalId}`) throw new Error(`Confirmation mismatch. Expected: ROLLBACK ${proposalId}`);
  if (proposal.hadTarget === false) {
    const { unlink } = await import("node:fs/promises");
    await unlink(target).catch(() => {});
  } else {
    await copyFile(proposal.backupFile, target);
  }
  proposal.status = "rolled_back";
  proposal.rolledBackAt = new Date().toISOString();
  await saveProposal(proposal, paths);
  await recordEvolutionEvent({ type: "proposal_rolled_back", proposalId, title: proposal.title }, paths);
  return proposal;
}
