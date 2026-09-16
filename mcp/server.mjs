#!/usr/bin/env node
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import * as z from "zod/v4";
import { runAudit, runMoA } from "../src/orchestrator.mjs";
import { doctor } from "../src/lib/doctor.mjs";
import { loadModels, loadPricing, loadSchedule, pluginRoot } from "../src/lib/config.mjs";
import { redactText, redactValue } from "../src/lib/redact.mjs";
import { listModels } from "../src/lib/models.mjs";
import { modelQuota, readQuotaSnapshot, refreshQuota } from "../src/lib/quota.mjs";
import { bindModelsToCcSwitch, ccSwitchSkillStatus, ccswitchReasoningAudit, ccswitchRoutingAudit, readCcSwitchSnapshot } from "../src/lib/ccswitch.mjs";
import { auditConflict, resolveCaptain } from "../src/lib/captain.mjs";
import { analyzeEvolution, applyProposal, createProposal, getProposal, listProposals, proposeFromEvidence, recordOutcome, rollbackProposal, updateProposalStatus } from "../src/lib/evolution.mjs";
import { buildMemoryPack, distillMemory, listMemories, loadMemory, remember } from "../src/lib/memory.mjs";
import { listSeats, readSeatRegistry, seatRegistryPath } from "../src/lib/seat-registry.mjs";
import { cancelAcpSeats, listAcpSeats } from "../src/lib/acp-seat.mjs";
import { buildContextPack, renderContextPack } from "../src/lib/context-pack.mjs";
import { getScheduleState } from "../src/lib/scheduler.mjs";
import { listControlRequests, readControlStore, requestCancellation } from "../src/lib/control-store.mjs";
import { buildStatusSummary } from "../src/lib/status-summary.mjs";
import { routingExperimentStatus } from "../src/lib/routing-experiment.mjs";
import { acknowledgeJobNotification, listJobs, notifyJobCompletion, pauseJob, publicJob, readJob, requestJobCancellation, resumeJob, startJob, steerJob, waitForJob } from "../src/lib/jobs.mjs";
import { assertInteractiveRun, backgroundJobHandoff, JOB_WAIT_LIMIT_MS } from "../src/lib/interactive-run.mjs";
import { createTaskId } from "../src/lib/blackboard.mjs";
import { applyPatch, checkPatch, inspectWorktree, listWorktrees, pruneWorktrees, removeWorktree, revertPatch } from "../src/lib/worktree.mjs";
import { applyRetention, planRetention } from "../src/lib/retention.mjs";
import { readPatchMetrics, recordPatchEvent, summarizePatchMetrics } from "../src/lib/patch-metrics.mjs";
import { providerCircuitStatus, readProviderState, recoverProviders } from "../src/lib/provider-state.mjs";
import { readMoAMode, resolveMoAMode, setMoAMode } from "../src/lib/moa-mode.mjs";
import { loadEffectiveModels } from "../src/lib/effective-models.mjs";
import { capabilityMatrix, liveCapabilityProbe } from "../src/lib/capability-probe.mjs";
import { captainAllocation, readCaptainUsage, writeCaptainUsage } from "../src/lib/captain-usage.mjs";
import { readCostLedger, summarizeCostLedger } from "../src/lib/cost-ledger.mjs";
import { readAuditMetrics, recordAuditAdjudication, summarizeAuditMetrics } from "../src/lib/audit-metrics.mjs";
import { applyFailureAvoidance, failureGuardFor, readFailureMemory, summarizeFailureMemory } from "../src/lib/failure-memory.mjs";
import { reconcileAuditPairing } from "../src/lib/provider-health.mjs";

const MODEL_IDS = ["kimi-k3", "kimi-2.8", "kimi-k2.8", "GLM-5.3", "GLM-5.3-flash", "DeepSeek-flash"];
const modelSchema = z.enum(MODEL_IDS);
const orchestrationModeSchema = z.enum(["off", "auto", "force"]);
const executionOwnerSchema = z.enum(["auto", "captain", "hybrid", "external"]);
const roleSchema = z.enum(["executor", "architect", "reviewer", "auditor", "vision", "researcher"]);
const reasoningEffortSchema = z.enum(["off", "low", "medium", "high", "xhigh", "max"]);
const runtimeSchema = z.enum(["cli", "acp", "auto", "persistent", "oneshot"]);
const budgetSchema = z.object({
  enforce: z.boolean().optional(),
  maxTokens: z.number().int().positive().optional(),
  maxEstimatedUsd: z.number().nonnegative().optional(),
  maxDurationMs: z.number().int().positive().optional(),
  maxContextUsed: z.number().int().positive().optional()
}).optional();
const assignmentSchema = z.object({
  model: modelSchema,
  harness: z.enum(["kimi", "zcode", "dsh", "pi", "claude", "codex"]).optional(),
  role: roleSchema.optional().default("executor"),
  mode: z.enum(["plan", "edit", "build"]).optional(),
  runtime: runtimeSchema.optional().default("cli"),
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
  env: z.record(z.string(), z.string()).optional(),
  skills: z.array(z.string().min(1)).max(12).optional(),
  auditMode: z.enum(["gate", "shadow"]).optional(),
  blocking: z.boolean().optional()
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
    content: [{ type: "text", text: JSON.stringify(redactValue(value), null, 2) }]
  };
}

function errorResult(error) {
  return {
    isError: true,
    content: [{ type: "text", text: redactText(error?.stack ?? String(error)) }]
  };
}

server.registerTool("moa_mode", {
  title: "Codex MOA Mode",
  description: "Read or persist the orchestration mode: off keeps work in the Codex captain, auto delegates by task complexity, and force delegates even simple tasks.",
  inputSchema: {
    action: z.enum(["status", "set"]).optional().default("status"),
    mode: orchestrationModeSchema.optional()
  }
}, async ({ action, mode }) => {
  try {
    if (action === "status") return textResult(await readMoAMode());
    if (!mode) throw new Error("mode is required when action=set");
    return textResult(await setMoAMode(mode));
  } catch (error) {
    return errorResult(error);
  }
});

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
  description: "Analyze, propose, inspect, approve, apply, or roll back policy evolution. Approval and application require exact user-confirmation strings.",
  inputSchema: {
    action: z.enum(["status", "record", "optimize", "propose", "list", "get", "approve", "reject", "apply", "rollback"]),
    taskId: z.string().optional(),
    originThreadId: z.string().optional().describe("Originating Codex thread. Normally captured automatically from CODEX_THREAD_ID; set only when the host explicitly provides it."),
    accepted: z.boolean().optional(),
    testsPassed: z.boolean().optional(),
    quality: z.number().min(0).max(10).optional(),
    stage: z.enum(["plan", "execution", "audit", "final"]).optional().default("final"),
    notes: z.string().optional(),
    proposalId: z.string().optional(),
    confirmation: z.string().optional(),
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
        stage: input.stage,
        notes: input.notes
      }));
    }
    if (input.action === "optimize" || input.action === "propose") {
      if (input.draft) return textResult(await createProposal(input.draft));
      return textResult(await proposeFromEvidence());
    }
    if (input.action === "list") return textResult(await listProposals());
    if (input.action === "get") {
      if (!input.proposalId) throw new Error("proposalId is required for get");
      return textResult(await getProposal(input.proposalId));
    }
    if (["approve", "reject", "apply", "rollback"].includes(input.action) && !input.proposalId) {
      throw new Error(`proposalId is required for ${input.action}`);
    }
    if (input.action === "approve") {
      return textResult(await updateProposalStatus(input.proposalId, "approved", input.confirmation, `APPROVE ${input.proposalId}`));
    }
    if (input.action === "reject") {
      return textResult(await updateProposalStatus(input.proposalId, "rejected", input.confirmation, `REJECT ${input.proposalId}`));
    }
    if (input.action === "apply") return textResult(await applyProposal(input.proposalId, input.confirmation));
    if (input.action === "rollback") return textResult(await rollbackProposal(input.proposalId, input.confirmation));
    throw new Error(`Unsupported evolution action: ${input.action}`);
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
  description: "Plan or apply retention/compaction for blackboard, jobs, worktrees, cost ledger, audit metrics, failure memory, and routing history.",
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

server.registerTool("moa_capabilities", {
  title: "Codex MOA Model Capabilities",
  description: "Read the CC Switch and vendor capability matrix, or run one bounded read-only live model/Harness probe.",
  inputSchema: {
    live: z.boolean().optional().default(false),
    model: modelSchema.optional(),
    harness: z.enum(["pi", "claude", "codex"]).optional().default("pi"),
    cwd: z.string().optional(),
    reasoningEffort: reasoningEffortSchema.optional(),
    feature: z.enum(["text-tool", "image"]).optional().default("text-tool"),
    timeoutMs: z.number().int().positive().max(60000).optional().default(60000)
  }
}, async (input) => {
  try {
    if (!input.live) return textResult(await capabilityMatrix());
    if (!input.model) throw new Error("model is required for a live capability probe");
    return textResult(await liveCapabilityProbe({
      model: input.model,
      harness: input.harness,
      cwd: input.cwd ?? process.cwd(),
      reasoningEffort: input.reasoningEffort,
      feature: input.feature,
      timeoutMs: input.timeoutMs
    }));
  } catch (error) {
    return errorResult(error);
  }
});

server.registerTool("moa_doctor", {
  title: "Codex MOA Doctor",
  description: "Check Pi, Claude Code, Codex CLI, compatibility fallbacks, lifecycle policy, and plugin dependencies.",
  inputSchema: { checkLatest: z.boolean().optional().default(false) }
}, async ({ checkLatest }) => {
  try {
    return textResult(await doctor({ checkLatest }));
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

server.registerTool("moa_captain_usage", {
  title: "Codex MOA Captain Usage",
  description: "Read or update the GPT captain quota snapshot used for dynamic delegation. The Codex caller obtains current account limits and supplies only normalized percentages.",
  inputSchema: {
    action: z.enum(["read", "update"]).optional().default("read"),
    source: z.string().optional(),
    observedAt: z.string().datetime().optional(),
    planType: z.string().optional(),
    ordinaryUsageAllowed: z.boolean().optional(),
    limits: z.array(z.object({
      limitId: z.string(),
      usedPercent: z.number().min(0).max(100),
      windowDurationMins: z.number().nonnegative().optional(),
      resetsAt: z.number().nonnegative().optional()
    })).optional()
  }
}, async (input) => {
  try {
    if (input.action === "update") {
      if (!input.limits?.length) throw new Error("limits are required for action=update");
      return textResult(await writeCaptainUsage(input));
    }
    return textResult(await readCaptainUsage() ?? { status: "not_recorded" });
  } catch (error) {
    return errorResult(error);
  }
});

server.registerTool("moa_audit_metrics", {
  title: "Codex MOA Audit Metrics",
  description: "Read execution-audit pairing metrics or record captain adjudication of audit findings.",
  inputSchema: {
    action: z.enum(["status", "record"]).optional().default("status"),
    taskId: z.string().optional(),
    auditorSeat: z.string().optional(),
    acceptedFindings: z.number().int().nonnegative().optional(),
    falsePositives: z.number().int().nonnegative().optional(),
    taskAccepted: z.boolean().optional(),
    testsPassed: z.boolean().optional(),
    notes: z.string().max(2000).optional()
  }
}, async (input) => {
  try {
    if (input.action === "record") {
      if (!input.taskId || !input.auditorSeat) throw new Error("taskId and auditorSeat are required for action=record");
      return textResult(await recordAuditAdjudication(input));
    }
    return textResult(summarizeAuditMetrics(await readAuditMetrics()));
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
    orchestrationMode: orchestrationModeSchema.optional(),
    executionOwner: executionOwnerSchema.optional().default("auto").describe("Core execution ownership. L3 implementation defaults to captain; hybrid/external must reflect explicit task scoping or user intent."),
    continuityKey: z.string().optional(),
    memoryKey: z.string().optional(),
    stakes: z.enum(["low", "medium", "high"]).optional().default("medium"),
    mode: z.enum(["implement", "review", "audit", "research"]).optional().default("implement"),
    vision: z.boolean().optional().default(false),
    skills: z.array(z.string().min(1)).max(12).optional(),
    seats: z.array(z.object({
      seat: z.string(),
      model: modelSchema.optional(),
      modelTier: z.enum(["fast", "deep"]).optional(),
      runtime: runtimeSchema.optional().default("cli"),
      reasoningEffort: reasoningEffortSchema.optional(),
      contextBudget: z.number().int().positive().optional(),
      outputBudget: z.number().int().positive().optional(),
      limitMode: z.enum(["balanced", "max"]).optional().default("balanced"),
      continuityKey: z.string().optional(),
      cwd: z.string().optional(),
      mode: z.enum(["plan", "edit", "build"]).optional(),
      skills: z.array(z.string().min(1)).max(12).optional()
    })).optional(),
    assignments: z.array(assignmentSchema).optional()
  }
}, async (input) => {
  try {
    const { planMoA } = await import("../src/lib/router.mjs");
    const captain = await resolveCaptain({ captainModel: input.captainModel });
    const orchestration = await resolveMoAMode(input.orchestrationMode);
    const snapshot = await readQuotaSnapshot();
    const usage = await readCaptainUsage();
    const routePerformance = summarizeCostLedger(await readCostLedger()).routes;
    const models = loadEffectiveModels();
    const plan = planMoA({ ...input, captain, orchestrationMode: orchestration.mode }, {
      models,
      quotaSnapshot: snapshot,
      captainAllocation: captainAllocation(captain, usage),
      routePerformance
    });
    const failureSummary = summarizeFailureMemory(await readFailureMemory());
    const failureRouting = applyFailureAvoidance(plan.seats, { summary: failureSummary, modelsConfig: models, captain });
    failureRouting.adjustments.push(...reconcileAuditPairing(plan.seats, {
      modelsConfig: models,
      captain,
      routeAllowed: (model, harness) => !failureGuardFor(failureSummary, model, harness)
    }));
    for (const node of plan.graph?.nodes ?? []) {
      const seat = plan.seats.find((item) => item.seat === node.id);
      if (seat) {
        node.model = seat.model;
        node.harness = seat.harness;
      }
    }
    plan.failureRouting = failureRouting;
    const auditWarnings = auditConflict(captain, plan.seats, models);
    const result = {
      ...plan,
      orchestration,
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
  description: "Start a persisted background MoA run and return immediately with a job handle. After dispatch, return control to the user instead of keeping the Codex turn open with polling or unrelated local work.",
  inputSchema: {
    task: z.string().min(1),
    cwd: z.string().min(1),
    taskId: z.string().optional(),
    resume: z.boolean().optional().default(false),
    routingExperiment: z.boolean().optional().default(true),
    captainModel: z.string().optional(),
    orchestrationMode: orchestrationModeSchema.optional(),
    executionOwner: executionOwnerSchema.optional().default("auto"),
    continuityKey: z.string().optional(),
    memoryKey: z.string().optional(),
    stakes: z.enum(["low", "medium", "high"]).optional().default("medium"),
    mode: z.enum(["implement", "review", "audit", "research"]).optional().default("implement"),
    vision: z.boolean().optional().default(false),
    skills: z.array(z.string().min(1)).max(12).optional(),
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
      runtime: runtimeSchema.optional().default("cli"),
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
      env: z.record(z.string(), z.string()).optional(),
      skills: z.array(z.string().min(1)).max(12).optional()
    })).optional(),
    assignments: z.array(assignmentSchema).optional()
  }
}, async (input) => {
  try {
    const taskId = input.taskId ?? createTaskId("moa-job");
    const job = publicJob(await startJob({ input: { ...input, taskId }, taskId }));
    return textResult({
      ...job,
      kind: "job",
      canSteer: true,
      nextPollAfterMs: 5000,
      interaction: backgroundJobHandoff(job, { event: "started" })
    });
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
    const visible = publicJob(job);
    return textResult({ ...visible, interaction: backgroundJobHandoff(visible, { event: "status" }) });
  } catch (error) {
    return errorResult(error);
  }
});

server.registerTool("moa_job_wait", {
  title: "Wait for Codex MOA Job",
  description: "Wait once for at most ten seconds for a background job to settle. If it remains active, return control to the user; do not loop in the same Codex turn.",
  inputSchema: {
    jobId: z.string(),
    timeoutMs: z.number().int().positive().max(JOB_WAIT_LIMIT_MS).optional().default(5000)
  }
}, async ({ jobId, timeoutMs }) => {
  try {
    const result = await waitForJob(jobId, timeoutMs);
    return textResult({ ...result, interaction: backgroundJobHandoff(result.job, { event: "wait" }) });
  } catch (error) {
    return errorResult(error);
  }
});

server.registerTool("moa_job_notify", {
  title: "Retry Codex MOA Job Notification",
  description: "Retry the durable completion notification to the originating Codex thread. Uses the official Codex queue command and records whether the daemon accepted it.",
  inputSchema: {
    jobId: z.string(),
    force: z.boolean().optional().default(false)
  }
}, async ({ jobId, force }) => {
  try {
    const job = await notifyJobCompletion(jobId, { force });
    return textResult({ ...job, interaction: backgroundJobHandoff(job, { event: "notified" }) });
  } catch (error) {
    return errorResult(error);
  }
});

server.registerTool("moa_job_ack", {
  title: "Acknowledge Codex MOA Job Notification",
  description: "Mark a terminal background-job completion notice as handled after the captain has inspected its evidence and continued the workflow.",
  inputSchema: { jobId: z.string() }
}, async ({ jobId }) => {
  try {
    const job = await acknowledgeJobNotification(jobId);
    return textResult({ ...job, interaction: backgroundJobHandoff(job, { event: "acknowledged" }) });
  } catch (error) {
    return errorResult(error);
  }
});

server.registerTool("moa_job_steer", {
  title: "Steer Codex MOA Job",
  description: "Persist an operator message for delivery at the next safe DAG boundary.",
  inputSchema: { jobId: z.string(), message: z.string().min(1) }
}, async ({ jobId, message }) => {
  try {
    const result = await steerJob(jobId, message);
    return textResult({ ...result, interaction: backgroundJobHandoff(result.job, { event: "steered" }) });
  } catch (error) { return errorResult(error); }
});

server.registerTool("moa_job_pause", {
  title: "Pause Codex MOA Job",
  description: "Request a safe pause and stop the active external seat. The checkpoint can be resumed later.",
  inputSchema: { jobId: z.string(), reason: z.string().optional().default("operator request") }
}, async ({ jobId, reason }) => {
  try { return textResult(await pauseJob(jobId, reason)); } catch (error) { return errorResult(error); }
});

server.registerTool("moa_job_resume", {
  title: "Resume Codex MOA Job",
  description: "Resume a paused background job from its checkpoint.",
  inputSchema: { jobId: z.string() }
}, async ({ jobId }) => {
  try { return textResult(publicJob(await resumeJob(jobId))); } catch (error) { return errorResult(error); }
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
    orchestrationMode: orchestrationModeSchema.optional(),
    executionOwner: executionOwnerSchema.optional().default("auto"),
    continuityKey: z.string().optional(),
    memoryKey: z.string().optional(),
    stakes: z.enum(["low", "medium", "high"]).optional().default("medium"),
    mode: z.enum(["implement", "review", "audit", "research"]).optional().default("implement"),
    vision: z.boolean().optional().default(false),
    skills: z.array(z.string().min(1)).max(12).optional(),
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
      runtime: runtimeSchema.optional().default("cli"),
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
      env: z.record(z.string(), z.string()).optional(),
      skills: z.array(z.string().min(1)).max(12).optional()
    })).optional(),
    assignments: z.array(assignmentSchema).optional()
  }
}, async (input) => {
  try {
    assertInteractiveRun(input);
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
    const models = loadEffectiveModels();
    const snapshot = await readCcSwitchSnapshot();
    return textResult({
      models: listModels(models),
      reasoningSources: models.reasoningSources ?? {},
      metadataSources: models.metadataSources ?? {},
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
    orchestrationMode: orchestrationModeSchema.optional(),
    executionOwner: executionOwnerSchema.optional().default("auto"),
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
    assertInteractiveRun(input);
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
    const pricing = loadPricing();
    const date = at ? new Date(at) : new Date();
    const state = getScheduleState(date, schedule);
    return textResult({
      at: date.toISOString(),
      state,
      pricing: {
        currency: pricing.currency,
        deepSeekFlash: {
          billing: pricing.models?.["DeepSeek-flash"]?.billing ?? null,
          period: state.deepSeekPricing,
          activeRates: pricing.models?.["DeepSeek-flash"]?.rates?.[state.deepSeekPricing] ?? null,
          verifiedAt: pricing.models?.["DeepSeek-flash"]?.verifiedAt ?? null
        }
      }
    });
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
