import { existsSync, readFileSync } from "node:fs";
import { appendFile, chmod, copyFile, mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { createHash, randomUUID } from "node:crypto";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { loadEvolutionPolicy } from "./config.mjs";

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

function hash(value) {
  return createHash("sha256").update(String(value)).digest("hex");
}

const DANGEROUS_KEYS = new Set(["__proto__", "prototype", "constructor"]);
const ALLOWED_POLICY_KEYS = new Set(["version", "audit", "routing", "timeouts"]);

export function validatePolicyPatch(patch, topLevel = true) {
  if (patch === null || typeof patch !== "object" || Array.isArray(patch)) throw new Error("policyPatch must be a JSON object");
  for (const [key, value] of Object.entries(patch)) {
    if (DANGEROUS_KEYS.has(key)) throw new Error(`Unsafe policy key: ${key}`);
    if (topLevel && !ALLOWED_POLICY_KEYS.has(key)) throw new Error(`Unsupported evolution policy key: ${key}`);
    if (value && typeof value === "object" && !Array.isArray(value)) validatePolicyPatch(value, false);
  }
  return patch;
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
  await appendFile(paths.outcomes, `${JSON.stringify({ time: new Date().toISOString(), ...outcome })}\n`, "utf8");
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
  let auditWarnings = 0;
  let timeouts = 0;
  for (const event of events) {
    if (event.type === "task_completed") {
      auditWarnings += event.auditWarnings?.length ?? 0;
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
      }
    }
  }
  const accepted = outcomes.filter((outcome) => outcome.accepted === true).length;
  const rated = outcomes.filter((outcome) => Number.isFinite(Number(outcome.quality))).length;
  const averageQuality = rated
    ? outcomes.reduce((sum, outcome) => sum + Number(outcome.quality), 0) / rated
    : null;
  return {
    sample: { events: events.length, outcomes: outcomes.length },
    auditWarnings,
    timeouts,
    accepted,
    acceptanceRate: outcomes.length ? accepted / outcomes.length : null,
    averageQuality,
    seats: seatStates,
    models
  };
}

async function writeJson(path, value) {
  await mkdir(dirname(path), { recursive: true });
  const temporary = `${path}.${randomUUID()}.tmp`;
  await writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 });
  await rename(temporary, path);
  await chmod(path, 0o600);
}

export async function createProposal(input, paths = evolutionPaths()) {
  validatePolicyPatch(input.policyPatch ?? {});
  await ensureEvolutionStore(paths);
  const proposal = {
    id: id(),
    createdAt: new Date().toISOString(),
    status: "proposed",
    requiresApproval: true,
    targetFile: "~/.codex-moa/evolution-policy.json",
    title: input.title,
    problem: input.problem,
    evidence: input.evidence ?? [],
    policyPatch: input.policyPatch,
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
    try { proposals.push(JSON.parse(await readFile(file, "utf8"))); } catch {}
  }
  return proposals.sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));
}

export async function getProposal(proposalId, paths = evolutionPaths()) {
  return JSON.parse(await readFile(join(paths.proposals, `${proposalId}.json`), "utf8"));
}

async function saveProposal(proposal, paths = evolutionPaths()) {
  await writeJson(join(paths.proposals, `${proposal.id}.json`), proposal);
}

export async function updateProposalStatus(proposalId, status, confirmation, expectedConfirmation, paths = evolutionPaths()) {
  const proposal = await getProposal(proposalId, paths);
  if (confirmation !== expectedConfirmation) throw new Error(`Confirmation mismatch. Expected: ${expectedConfirmation}`);
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
