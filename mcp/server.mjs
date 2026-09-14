#!/usr/bin/env node
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import * as z from "zod/v4";
import { runAudit, runMoA } from "../src/orchestrator.mjs";
import { doctor } from "../src/lib/doctor.mjs";
import { loadModels, loadSchedule, pluginRoot } from "../src/lib/config.mjs";
import { redactText } from "../src/lib/redact.mjs";
import { listModels } from "../src/lib/models.mjs";
import { modelQuota, readQuotaSnapshot, refreshQuota } from "../src/lib/quota.mjs";
import { bindModelsToCcSwitch, ccSwitchSkillStatus, ccswitchReasoningAudit, ccswitchRoutingAudit, readCcSwitchSnapshot } from "../src/lib/ccswitch.mjs";
import { auditConflict, resolveCaptain } from "../src/lib/captain.mjs";
import { analyzeEvolution, createProposal, getProposal, listProposals, proposeFromEvidence, recordOutcome } from "../src/lib/evolution.mjs";
import { buildMemoryPack, distillMemory, listMemories, loadMemory, remember } from "../src/lib/memory.mjs";
import { listSeats, readSeatRegistry, seatRegistryPath } from "../src/lib/seat-registry.mjs";
import { cancelAcpSeats, listAcpSeats } from "../src/lib/acp-seat.mjs";
import { buildContextPack, renderContextPack } from "../src/lib/context-pack.mjs";
import { getScheduleState } from "../src/lib/scheduler.mjs";
import { listControlRequests, readControlStore, requestCancellation } from "../src/lib/control-store.mjs";
import { buildStatusSummary } from "../src/lib/status-summary.mjs";
import { routingExperimentStatus } from "../src/lib/routing-experiment.mjs";
import { listJobs, publicJob, readJob, requestJobCancellation, startJob, waitForJob } from "../src/lib/jobs.mjs";
import { createTaskId } from "../src/lib/blackboard.mjs";
import { applyPatch, checkPatch, inspectWorktree, listWorktrees, pruneWorktrees, removeWorktree, revertPatch } from "../src/lib/worktree.mjs";
import { applyRetention, planRetention } from "../src/lib/retention.mjs";
import { readPatchMetrics, recordPatchEvent, summarizePatchMetrics } from "../src/lib/patch-metrics.mjs";
import { providerCircuitStatus, readProviderState, recoverProviders } from "../src/lib/provider-state.mjs";

const MODEL_IDS = ["kimi-k3", "kimi-2.8", "GLM-5.3", "GLM-5.3-flash", "DeepSeek-flash"];
const modelSchema = z.enum(MODEL_IDS);
const roleSchema = z.enum(["executor", "architect", "reviewer", "auditor", "vision", "researcher"]);
const reasoningEffortSchema = z.enum(["off", "low", "medium", "high", "xhigh", "max"]);
const budgetSchema = z.object({
  enforce: z.boolean().optional(),
  maxTokens: z.number().int().positive().optional(),
  maxEstimatedUsd: z.number().nonnegative().optional(),
  maxDurationMs: z.number().int().positive().optional(),
  maxContextUsed: z.number().int().positive().optional()
}).optional();
const assignmentSchema = z.object({
  model: modelSchema,
  role: roleSchema.optional().default("executor"),
  mode: z.enum(["plan", "edit", "build"]).optional(),
  runtime: z.enum(["cli", "acp"]).optional().default("cli"),
  reasoningEffort: reasoningEffortSchema.optional(),
  contextBudget: z.number().int().positive().optional(),
  outputBudget: z.number().int().positive().optional(),
  limitMode: z.enum(["balanced", "max"]).optional().default("balanced"),
  continuityKey: z.string().optional(),
  cwd: z.string().optional(),
  autoApprove: z.boolean().optional(),
  maxTurns: z.number().int().positive().optional(),
  allowedTools: z.string().optional(),
  disallowedTools: z.string().optional(),
  profile: z.string().optional(),
  env: z.record(z.string(), z.string()).optional()
});

function pluginManifest() {
  try {
    return JSON.parse(readFileSync(resolve(pluginRoot, ".codex-plugin", "plugin.json"), "utf8"));
  } catch {
    return { name: "codex-moa", version: "unknown" };
  }
}

function compatibilityReport() {
  const manifest = pluginManifest();
  return {
    plugin: manifest.name ?? "codex-moa",
    pluginVersion: manifest.version ?? "unknown",
    nodeVersion: process.version,
    platform: process.platform,
    arch: process.arch,
    transport: "stdio",
    mcpTransport: "newline-delimited JSON-RPC",
    codexInternalApisUsed: false,
    pluginRoot,
    pid: process.pid
  };
}

process.on("uncaughtException", (error) => {
  console.error(`[codex-moa] uncaught exception: ${redactText(error?.stack ?? String(error))}`);
  process.exit(1);
});
process.on("unhandledRejection", (error) => {
  console.error(`[codex-moa] unhandled rejection: ${redactText(error?.stack ?? String(error))}`);
  process.exit(1);
});

if (process.argv.includes("--health")) {
  process.stdout.write(`${JSON.stringify(compatibilityReport(), null, 2)}\n`);
  process.exit(0);
}

const server = new McpServer({
  name: "codex-moa",
  version: pluginManifest().version ?? "0.12.0"
});

function textResult(value) {
  return {
    content: [{ type: "text", text: JSON.stringify(value, null, 2) }]
  };
}

function errorResult(error) {
  return {
    isError: true,
    content: [{ type: "text", text: error?.stack ?? String(error) }]
  };
}

server.registerTool("moa_compat", {
  title: "Codex MOA Compatibility",
  description: "Return upgrade-safety and runtime compatibility information without loading external agents.",
  inputSchema: {}
}, async () => {
  try {
    return textResult(compatibilityReport());
  } catch (error) {
    return errorResult(error);
  }
});

server.registerTool("moa_evolve", {
  title: "Codex MOA Evolution",
  description: "Propose, inspect, approve, apply, or roll back policy evolution. Applying always requires explicit confirmation.",
  inputSchema: {
    action: z.enum(["status", "record", "propose", "list", "get"]),
    taskId: z.string().optional(),
    accepted: z.boolean().optional(),
    testsPassed: z.boolean().optional(),
    quality: z.number().min(0).max(10).optional(),
    notes: z.string().optional(),
    proposalId: z.string().optional(),
    draft: z.object({
      title: z.string(),
      problem: z.string(),
      evidence: z.array(z.string()).optional(),
      policyPatch: z.any(),
      expectedBenefit: z.string().optional(),
      risks: z.array(z.string()).optional(),
      evaluationPlan: z.array(z.string()).optional(),
      rollbackPlan: z.string().optional()
    }).optional()
  }
}, async (input) => {
  try {
    if (input.action === "status") {
      return textResult({ analysis: await analyzeEvolution(), proposals: await listProposals() });
    }
    if (input.action === "record") {
      if (!input.taskId) throw new Error("taskId is required for record");
      return textResult(await recordOutcome({
        taskId: input.taskId,
        accepted: input.accepted,
        testsPassed: input.testsPassed,
        quality: input.quality,
        notes: input.notes
      }));
    }
    if (input.action === "propose") {
      if (input.draft) return textResult(await createProposal(input.draft));
      return textResult(await proposeFromEvidence());
    }
    if (input.action === "list") return textResult(await listProposals());
    if (input.action === "get") {
      if (!input.proposalId) throw new Error("proposalId is required for get");
      return textResult(await getProposal(input.proposalId));
    }
    throw new Error(`Unsupported evolution action: ${input.action}. Approval and application are terminal-only.`);
  } catch (error) {
    return errorResult(error);
  }
});

server.registerTool("moa_memory", {
  title: "Codex MOA Memory",
  description: "Load or update durable task memory that survives context compaction.",
  inputSchema: {
    action: z.enum(["load", "remember", "list", "distill"]),
    memoryKey: z.string().optional(),
    cwd: z.string().optional(),
    kind: z.enum(["decision", "fact", "file", "test", "failed_attempt", "open_question"]).optional(),
    text: z.string().optional(),
    evidence: z.string().optional(),
    path: z.string().optional(),
    status: z.string().optional()
  }
}, async (input) => {
  try {
    if (input.action === "list") return textResult(await listMemories());
    if (!input.memoryKey) throw new Error("memoryKey is required");
    if (input.action === "load") {
      const memory = await loadMemory({ key: input.memoryKey, cwd: input.cwd ?? process.cwd() });
      return textResult({ ...memory, pack: buildMemoryPack(memory) });
    }
    if (input.action === "distill") {
      const memory = await distillMemory({ key: input.memoryKey, cwd: input.cwd ?? process.cwd() });
      return textResult({ key: memory.key, path: memory.path, distilledAt: memory.distilledAt, stats: memory.stats });
    }
    if (!input.kind || !input.text) throw new Error("kind and text are required for remember");
    const memory = await remember({
      key: input.memoryKey,
      cwd: input.cwd ?? process.cwd(),
      kind: input.kind,
      text: input.text,
      evidence: input.evidence,
      path: input.path,
      status: input.status
    });
    return textResult({ key: memory.key, path: memory.path, updatedAt: memory.updatedAt });
  } catch (error) {
    return errorResult(error);
  }
});

server.registerTool("moa_seats", {
  title: "Codex MOA Seats",
  description: "List persisted runtime seat state, models, status, worktrees, and continuity session ids.",
  inputSchema: {
    taskId: z.string().optional()
  }
}, async ({ taskId }) => {
  try {
    const registry = readSeatRegistry();
    const seats = listSeats(registry).filter((seat) => !taskId || seat.taskId === taskId);
    const controlStore = await readControlStore();
    return textResult({
      registry: seatRegistryPath(),
      seats,
      acpProcesses: listAcpSeats(),
      controlRequests: listControlRequests(controlStore).slice(0, 20)
    });
  } catch (error) {
    return errorResult(error);
  }
});

server.registerTool("moa_health", {
  title: "Codex MOA Health",
  description: "Summarize provider health, cost ledger, seats, worktrees, memory, Navigator, and checkpoints.",
  inputSchema: {
    recentHours: z.number().positive().max(720).optional().default(24),
    probeProviders: z.boolean().optional().default(false)
  }
}, async ({ recentHours, probeProviders }) => {
  try {
    const recovery = probeProviders ? await recoverProviders() : null;
    const summary = await buildStatusSummary({ recentHours });
    return textResult({ ...summary, providerRecovery: recovery, acpProcesses: listAcpSeats(), routingExperiments: await routingExperimentStatus() });
  } catch (error) {
    return errorResult(error);
  }
});

server.registerTool("moa_interrupt", {
  title: "Codex MOA Interrupt",
  description: "Inspect or cancel active ACP/ZCode seats. Cancellation requests are persisted for dashboard/control-plane clients.",
  inputSchema: {
    action: z.enum(["status", "cancel"]),
    taskId: z.string().optional(),
    seat: z.string().optional(),
    key: z.string().optional(),
    reason: z.string().optional()
  }
}, async (input) => {
  try {
    if (input.action === "status") {
      const controlStore = await readControlStore();
      return textResult({ seats: listAcpSeats(), requests: listControlRequests(controlStore).slice(0, 50) });
    }
    if (!input.taskId && !input.seat && !input.key) throw new Error("taskId, seat, or key is required for cancel");
    const direct = await cancelAcpSeats({ taskId: input.taskId, seat: input.seat, key: input.key });
    const request = direct.some((item) => item.cancelled)
      ? null
      : await requestCancellation({ taskId: input.taskId, seat: input.seat, key: input.key, reason: input.reason });
    return textResult({ direct, queued: request, seats: listAcpSeats() });
  } catch (error) {
    return errorResult(error);
  }
});

server.registerTool("moa_worktrees", {
  title: "Codex MOA Worktrees",
  description: "Inspect, patch, clean, or prune isolated Git worktrees.",
  inputSchema: {
    action: z.enum(["list", "inspect", "check_patch", "apply_patch", "revert_patch", "remove", "prune"]),
    cwd: z.string().optional(),
    path: z.string().optional(),
    patchPath: z.string().optional(),
    taskId: z.string().optional(),
    seat: z.string().optional(),
    model: modelSchema.optional(),
    baseCommit: z.string().optional(),
    resultStatus: z.enum(["done", "failed", "error", "cancelled"]).optional().default("done"),
    allowWrite: z.boolean().optional().default(false),
    force: z.boolean().optional().default(false),
    threeWay: z.boolean().optional().default(false),
    dryRun: z.boolean().optional().default(true),
    expire: z.string().optional()
  }
}, async (input) => {
  try {
    if (input.action === "list") {
      if (!input.cwd) throw new Error("cwd is required for list");
      return textResult({ worktrees: await listWorktrees(input.cwd) });
    }
    if (input.action === "inspect") {
      if (!input.path) throw new Error("path is required for inspect");
      return textResult(await inspectWorktree(input.path, { baseCommit: input.baseCommit, resultStatus: input.resultStatus }));
    }
    if (input.action === "check_patch") {
      if (!input.cwd || !input.patchPath) throw new Error("cwd and patchPath are required");
      const startedAt = Date.now();
      const result = await checkPatch({ cwd: input.cwd, patchPath: input.patchPath });
      await recordPatchEvent({ ...input, path: input.patchPath, action: "check", ok: result.ok, durationMs: Date.now() - startedAt, error: result.error });
      return textResult(result);
    }
    if (input.action === "prune") {
      if (!input.cwd) throw new Error("cwd is required for prune");
      if (input.dryRun === false && !input.allowWrite) throw new Error("allowWrite=true is required for a real prune");
      return textResult(await pruneWorktrees(input.cwd, { dryRun: input.dryRun, expire: input.expire }));
    }
    if (!input.allowWrite) throw new Error("allowWrite=true is required for this worktree mutation");
    if (input.action === "apply_patch") {
      if (!input.cwd || !input.patchPath) throw new Error("cwd and patchPath are required");
      const startedAt = Date.now();
      const result = await applyPatch({ cwd: input.cwd, patchPath: input.patchPath, threeWay: input.threeWay });
      await recordPatchEvent({ ...input, path: input.patchPath, action: "apply", ok: result.ok, durationMs: Date.now() - startedAt, error: result.error });
      return textResult(result);
    }
    if (input.action === "revert_patch") {
      if (!input.cwd || !input.patchPath) throw new Error("cwd and patchPath are required");
      const startedAt = Date.now();
      const result = await revertPatch({ cwd: input.cwd, patchPath: input.patchPath });
      await recordPatchEvent({ ...input, path: input.patchPath, action: "revert", ok: result.ok, durationMs: Date.now() - startedAt, error: result.error });
      return textResult(result);
    }
    if (input.action === "remove") {
      if (!input.path) throw new Error("path is required for remove");
      return textResult(await removeWorktree(input.path, { repo: input.cwd ?? null, force: input.force }));
    }
    throw new Error(`Unsupported worktree action: ${input.action}`);
  } catch (error) {
    return errorResult(error);
  }
});

server.registerTool("moa_patch_metrics", {
  title: "Codex MOA Patch Metrics",
  description: "Summarize patch check, apply, revert, conflict, and acceptance metrics.",
  inputSchema: {
    limit: z.number().int().positive().max(50000).optional().default(10000)
  }
}, async ({ limit }) => {
  try {
    return textResult(summarizePatchMetrics(await readPatchMetrics(undefined, limit)));
  } catch (error) {
    return errorResult(error);
  }
});

server.registerTool("moa_retention", {
  title: "Codex MOA Retention",
  description: "Plan or apply retention/compaction for blackboard, jobs, worktrees, cost ledger, and routing history.",
  inputSchema: {
    action: z.enum(["plan", "apply"]),
    allowWrite: z.boolean().optional().default(false),
    dryRun: z.boolean().optional().default(true)
  }
}, async ({ action, allowWrite, dryRun }) => {
  try {
    if (action === "plan") return textResult({ plan: await planRetention() });
    if (!allowWrite) throw new Error("allowWrite=true is required to apply retention");
    return textResult(await applyRetention({ dryRun }));
  } catch (error) {
    return errorResult(error);
  }
});

server.registerTool("moa_context", {
  title: "Codex MOA Context Pack",
  description: "Build a repository context pack from task keywords without loading the whole repository.",
  inputSchema: {
    task: z.string().min(1),
    cwd: z.string().min(1),
    maxFiles: z.number().int().positive().optional().default(20),
    maxTotalTokens: z.number().int().positive().optional().default(32000)
  }
}, async (input) => {
  try {
    const pack = await buildContextPack(input);
    return textResult({ ...pack, rendered: renderContextPack(pack) });
  } catch (error) {
    return errorResult(error);
  }
});

server.registerTool("moa_doctor", {
  title: "Codex MOA Doctor",
  description: "Check KimiCode, ZCode, DeepSeekHarness, and plugin dependencies.",
  inputSchema: {}
}, async () => {
  try {
    return textResult(await doctor());
  } catch (error) {
    return errorResult(error);
  }
});

server.registerTool("moa_ccswitch", {
  title: "Codex MOA CC Switch",
  description: "Read cc-switch provider, model, and Skill management metadata without modifying the cc-switch database.",
  inputSchema: {}
}, async () => {
  try {
    const models = loadModels();
    const snapshot = await readCcSwitchSnapshot();
    return textResult({
      available: snapshot.available,
      settings: snapshot.settings,
      currentProviders: snapshot.currentProviders,
      providers: snapshot.providers,
      skillsCount: snapshot.skills?.length ?? 0,
      codexMoaSkill: ccSwitchSkillStatus(snapshot, "codex-moa"),
      reasoningAudit: ccswitchReasoningAudit(snapshot, models),
      routingAudit: ccswitchRoutingAudit(snapshot, models),
      modelBindings: bindModelsToCcSwitch(snapshot, models)
    });
  } catch (error) {
    return errorResult(error);
  }
});

server.registerTool("moa_captain", {
  title: "Codex MOA Captain",
  description: "Resolve the current Codex captain model without changing it.",
  inputSchema: {
    captainModel: z.string().optional()
  }
}, async ({ captainModel }) => {
  try {
    return textResult(await resolveCaptain({ captainModel }));
  } catch (error) {
    return errorResult(error);
  }
});

server.registerTool("moa_provider_recovery", {
  title: "Codex MOA Provider Recovery",
  description: "Inspect provider circuit state or probe half-open providers for automatic recovery.",
  inputSchema: {
    action: z.enum(["status", "probe"]),
    providers: z.array(z.enum(["kimi", "zai", "deepseek"])).optional(),
    force: z.boolean().optional().default(false)
  }
}, async ({ action, providers, force }) => {
  try {
    if (action === "status") {
      const state = await readProviderState();
      const ids = providers ?? ["kimi", "zai", "deepseek"];
      return textResult({ providers: Object.fromEntries(ids.map((id) => [id, providerCircuitStatus(state, id)])) });
    }
    return textResult(await recoverProviders({ providers: providers ?? ["kimi", "zai", "deepseek"], force }));
  } catch (error) {
    return errorResult(error);
  }
});

server.registerTool("moa_plan", {
  title: "Plan Codex MOA",
  description: "Classify a task and choose external agent seats without running them.",
  inputSchema: {
    task: z.string().min(1).describe("Task goal and acceptance criteria."),
    captainModel: z.string().optional().describe("Codex main model currently selected by the user."),
    continuityKey: z.string().optional(),
    memoryKey: z.string().optional(),
    stakes: z.enum(["low", "medium", "high"]).optional().default("medium"),
    mode: z.enum(["implement", "review", "audit", "research"]).optional().default("implement"),
    vision: z.boolean().optional().default(false),
    seats: z.array(z.object({
      seat: z.string(),
      model: modelSchema.optional(),
      modelTier: z.enum(["fast", "deep"]).optional(),
      runtime: z.enum(["cli", "acp"]).optional().default("cli"),
      reasoningEffort: reasoningEffortSchema.optional(),
      contextBudget: z.number().int().positive().optional(),
      outputBudget: z.number().int().positive().optional(),
      limitMode: z.enum(["balanced", "max"]).optional().default("balanced"),
      continuityKey: z.string().optional(),
      cwd: z.string().optional(),
      mode: z.enum(["plan", "edit", "build"]).optional()
    })).optional(),
    assignments: z.array(assignmentSchema).optional()
  }
}, async (input) => {
  try {
    const { planMoA } = await import("../src/lib/router.mjs");
    const captain = await resolveCaptain({ captainModel: input.captainModel });
    const plan = planMoA({ ...input, captain });
    const models = loadModels();
    const auditWarnings = auditConflict(captain, plan.seats, models);
    const snapshot = await readQuotaSnapshot();
    const result = {
      ...plan,
      captain,
      auditWarnings: auditWarnings.map((item) => ({
        type: item.reason,
        model: item.model.id,
        captainFamily: captain.family,
        message: `Audit seat ${item.assignment.model} shares the captain family ${captain.family}.`
      }))
    };
    return textResult(snapshot ? { ...result, quota: plan.seats.map((seat) => ({ seat: seat.seat, model: seat.model, quota: modelQuota(seat.model, snapshot, models) })) } : result);
  } catch (error) {
    return errorResult(error);
  }
});

server.registerTool("moa_start", {
  title: "Start Codex MOA Job",
  description: "Start a persisted background MoA run and return immediately with a job handle.",
  inputSchema: {
    task: z.string().min(1),
    cwd: z.string().min(1),
    taskId: z.string().optional(),
    resume: z.boolean().optional().default(false),
    routingExperiment: z.boolean().optional().default(true),
    captainModel: z.string().optional(),
    continuityKey: z.string().optional(),
    memoryKey: z.string().optional(),
    stakes: z.enum(["low", "medium", "high"]).optional().default("medium"),
    mode: z.enum(["implement", "review", "audit", "research"]).optional().default("implement"),
    vision: z.boolean().optional().default(false),
    allowWrite: z.boolean().optional().default(false),
    respectQuota: z.boolean().optional().default(true),
    allowDepleted: z.boolean().optional().default(false),
    respectHealth: z.boolean().optional().default(true),
    allowUnhealthy: z.boolean().optional().default(false),
    diff: z.string().optional(),
    files: z.array(z.string()).optional(),
    context: z.string().optional(),
    timeoutMs: z.number().int().positive().optional(),
    budget: budgetSchema,
    strictHeterogeneousAudit: z.boolean().optional().default(false),
    seats: z.array(z.object({
      seat: z.string(),
      model: modelSchema.optional(),
      modelTier: z.enum(["fast", "deep"]).optional(),
      runtime: z.enum(["cli", "acp"]).optional().default("cli"),
      reasoningEffort: reasoningEffortSchema.optional(),
      contextBudget: z.number().int().positive().optional(),
      outputBudget: z.number().int().positive().optional(),
      limitMode: z.enum(["balanced", "max"]).optional().default("balanced"),
      continuityKey: z.string().optional(),
      cwd: z.string().optional(),
      mode: z.enum(["plan", "edit", "build"]).optional(),
      autoApprove: z.boolean().optional(),
      profile: z.string().optional(),
      maxTurns: z.number().int().positive().optional(),
      allowedTools: z.string().optional(),
      disallowedTools: z.string().optional(),
      env: z.record(z.string(), z.string()).optional()
    })).optional(),
    assignments: z.array(assignmentSchema).optional()
  }
}, async (input) => {
  try {
    const taskId = input.taskId ?? createTaskId("moa-job");
    return textResult(publicJob(await startJob({ input: { ...input, taskId }, taskId })));
  } catch (error) {
    return errorResult(error);
  }
});

server.registerTool("moa_job_status", {
  title: "Codex MOA Job Status",
  description: "Read one persisted background job or list recent jobs.",
  inputSchema: {
    jobId: z.string().optional(),
    limit: z.number().int().positive().max(200).optional().default(50)
  }
}, async ({ jobId, limit }) => {
  try {
    if (!jobId) return textResult({ jobs: await listJobs(limit) });
    const job = await readJob(jobId);
    if (!job) throw new Error(`Job not found: ${jobId}`);
    return textResult(publicJob(job));
  } catch (error) {
    return errorResult(error);
  }
});

server.registerTool("moa_job_wait", {
  title: "Wait for Codex MOA Job",
  description: "Wait for a background job to reach a terminal state.",
  inputSchema: {
    jobId: z.string(),
    timeoutMs: z.number().int().positive().max(300000).optional().default(30000)
  }
}, async ({ jobId, timeoutMs }) => {
  try {
    return textResult(await waitForJob(jobId, timeoutMs));
  } catch (error) {
    return errorResult(error);
  }
});

server.registerTool("moa_job_cancel", {
  title: "Cancel Codex MOA Job",
  description: "Request graceful cancellation of a background job and its active ACP/ZCode seats.",
  inputSchema: {
    jobId: z.string(),
    reason: z.string().optional().default("operator request")
  }
}, async ({ jobId, reason }) => {
  try {
    return textResult(await requestJobCancellation(jobId, reason));
  } catch (error) {
    return errorResult(error);
  }
});

server.registerTool("moa_run", {
  title: "Run Codex MOA",
  description: "Run selected external agent seats and store results in the MOA blackboard. Writes are disabled by default.",
  inputSchema: {
    task: z.string().min(1),
    cwd: z.string().min(1),
    taskId: z.string().optional(),
    resume: z.boolean().optional().default(false),
    routingExperiment: z.boolean().optional().default(true),
    captainModel: z.string().optional().describe("Codex main model currently selected by the user."),
    continuityKey: z.string().optional(),
    memoryKey: z.string().optional(),
    stakes: z.enum(["low", "medium", "high"]).optional().default("medium"),
    mode: z.enum(["implement", "review", "audit", "research"]).optional().default("implement"),
    vision: z.boolean().optional().default(false),
    allowWrite: z.boolean().optional().default(false),
    diff: z.string().optional(),
    files: z.array(z.string()).optional(),
    context: z.string().optional(),
    timeoutMs: z.number().int().positive().optional(),
    budget: budgetSchema,
    strictHeterogeneousAudit: z.boolean().optional().default(false),
    seats: z.array(z.object({
      seat: z.string(),
      model: modelSchema.optional(),
      modelTier: z.enum(["fast", "deep"]).optional(),
      runtime: z.enum(["cli", "acp"]).optional().default("cli"),
      reasoningEffort: reasoningEffortSchema.optional(),
      contextBudget: z.number().int().positive().optional(),
      outputBudget: z.number().int().positive().optional(),
      limitMode: z.enum(["balanced", "max"]).optional().default("balanced"),
      continuityKey: z.string().optional(),
      cwd: z.string().optional(),
      mode: z.enum(["plan", "edit", "build"]).optional(),
      autoApprove: z.boolean().optional(),
      profile: z.string().optional(),
      maxTurns: z.number().int().positive().optional(),
      allowedTools: z.string().optional(),
      disallowedTools: z.string().optional(),
      env: z.record(z.string(), z.string()).optional()
    })).optional(),
    assignments: z.array(assignmentSchema).optional()
  }
}, async (input) => {
  try {
    return textResult(await runMoA(input));
  } catch (error) {
    return errorResult(error);
  }
});

server.registerTool("moa_models", {
  title: "List Codex MOA Models",
  description: "List the five canonical sub-agent models and their harness mappings.",
  inputSchema: {}
}, async () => {
  try {
    const models = loadModels();
    const snapshot = await readCcSwitchSnapshot();
    return textResult({
      models: listModels(models),
      ccswitch: snapshot.available ? {
        skill: ccSwitchSkillStatus(snapshot, "codex-moa"),
        bindings: bindModelsToCcSwitch(snapshot, models),
        reasoningAudit: ccswitchReasoningAudit(snapshot, models),
        routingAudit: ccswitchRoutingAudit(snapshot, models)
      } : { available: false }
    });
  } catch (error) {
    return errorResult(error);
  }
});

server.registerTool("moa_delegate", {
  title: "Delegate with Explicit Models",
  description: "Run sub-agents with models explicitly selected by Codex. Writes remain disabled unless allowWrite and autoApprove are both set.",
  inputSchema: {
    task: z.string().min(1),
    cwd: z.string().min(1),
    assignments: z.array(assignmentSchema).min(1),
    taskId: z.string().optional(),
    resume: z.boolean().optional().default(false),
    routingExperiment: z.boolean().optional().default(true),
    captainModel: z.string().optional(),
    allowWrite: z.boolean().optional().default(false),
    respectQuota: z.boolean().optional().default(true),
    allowDepleted: z.boolean().optional().default(false),
    respectHealth: z.boolean().optional().default(true),
    allowUnhealthy: z.boolean().optional().default(false),
    strictHeterogeneousAudit: z.boolean().optional().default(false),
    context: z.string().optional(),
    timeoutMs: z.number().int().positive().optional(),
    budget: budgetSchema
  }
}, async (input) => {
  try {
    return textResult(await runMoA({ ...input, stakes: "high", mode: "implement" }));
  } catch (error) {
    return errorResult(error);
  }
});

server.registerTool("moa_quota", {
  title: "Codex MOA Quota",
  description: "Refresh or read provider quota snapshots for KimiCode, Z.ai/GLM, and DeepSeek.",
  inputSchema: {
    refresh: z.boolean().optional().default(true)
  }
}, async ({ refresh }) => {
  try {
    const snapshot = refresh ? await refreshQuota() : await readQuotaSnapshot();
    if (!snapshot) return textResult({ status: "not_refreshed", hint: "Run moa_quota with refresh=true." });
    const models = loadModels();
    return textResult({
      updatedAt: snapshot.updatedAt,
      providers: snapshot.providers,
      models: listModels(models).map((model) => ({ id: model.id, quota: modelQuota(model.id, snapshot, models) }))
    });
  } catch (error) {
    return errorResult(error);
  }
});

server.registerTool("moa_audit", {
  title: "Audit with DeepSeekHarness",
  description: "Run a DeepSeekHarness audit seat against a diff, repository, or set of files.",
  inputSchema: {
    task: z.string().min(1),
    cwd: z.string().min(1),
    captainModel: z.string().optional(),
    continuityKey: z.string().optional(),
    allowContinuityModelSwitch: z.boolean().optional().default(false),
    diff: z.string().optional(),
    files: z.array(z.string()).optional(),
    context: z.string().optional(),
    deep: z.boolean().optional().default(false),
    timeoutMs: z.number().int().positive().optional(),
    strictHeterogeneousAudit: z.boolean().optional().default(false)
  }
}, async (input) => {
  try {
    return textResult(await runAudit(input));
  } catch (error) {
    return errorResult(error);
  }
});

server.registerTool("moa_schedule", {
  title: "Codex MOA Schedule",
  description: "Return the current GLM night campaign and DeepSeek peak/off-peak policy.",
  inputSchema: {
    at: z.string().datetime().optional()
  }
}, async ({ at }) => {
  try {
    const schedule = loadSchedule();
    const date = at ? new Date(at) : new Date();
    return textResult({ at: date.toISOString(), state: getScheduleState(date, schedule) });
  } catch (error) {
    return errorResult(error);
  }
});

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
