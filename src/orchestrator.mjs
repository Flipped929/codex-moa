import { join } from "node:path";
import { loadConfig, loadEvolutionPolicy, loadPricing, loadSchedule } from "./lib/config.mjs";
import { loadEffectiveModels } from "./lib/effective-models.mjs";
import { createWorkspace, writeJson, writeText, appendEvent } from "./lib/blackboard.mjs";
import { redactText } from "./lib/redact.mjs";
import { truncateMiddle } from "./lib/parser.mjs";
import { planMoA } from "./lib/router.mjs";
import { depletedModels, providerForModel, quotaForSeats, readQuotaSnapshot, refreshQuota } from "./lib/quota.mjs";
import { auditConflict, resolveCaptain } from "./lib/captain.mjs";
import { recordEvolutionEvent } from "./lib/evolution.mjs";
import { clearContinuityEntry, continuityEntry, makeContinuityKey, mergeContinuityStore, readContinuityStore, setContinuityEntry } from "./lib/continuity.mjs";
import { isPersistentRuntime } from "./lib/runtime-contract.mjs";
import { buildMemoryPack, loadMemory, recordEpisode } from "./lib/memory.mjs";
import { listSeats, readSeatRegistry, seatRegistryPath, upsertSeatAtomic } from "./lib/seat-registry.mjs";
import { captureWorktreeDiff, createWorktree, inspectWorktree, removeWorktree, writeDiffArtifact } from "./lib/worktree.mjs";
import { buildContextPack, renderContextPack } from "./lib/context-pack.mjs";
import { navigatorReview } from "./lib/navigator.mjs";
import { buildRepairContext, hasBlockingAudit, normalizeSeatResult } from "./lib/seat-result.mjs";
import { applyProviderHealthRouting, reconcileAuditPairing, summarizeProviderHealth } from "./lib/provider-health.mjs";
import { readProviderState, recordProviderOutcome } from "./lib/provider-state.mjs";
import { accumulateBudget, budgetSummary, evaluateBudget, newBudgetTotals, normalizeBudgetPolicy } from "./lib/budget.mjs";
import { getAdapter } from "./adapters/index.mjs";
import { runAcpAdapter } from "./adapters/acp.mjs";
import { checkpointPath, checkpointResultMap, completedSeatIds, createCheckpoint, mergeCheckpointIntoSeats, readCheckpoint, updateCheckpointNode, writeCheckpoint } from "./lib/task-checkpoint.mjs";
import { makeCostEntry, readCostLedger, recordCostEntry, summarizeCostLedger } from "./lib/cost-ledger.mjs";
import { captainAllocation, readCaptainUsage } from "./lib/captain-usage.mjs";
import { auditMetricsPath, outputTps, recordAuditRun } from "./lib/audit-metrics.mjs";
import { evaluateRoutingRollback, readRoutingExperimentState, recordRoutingOutcome, routingExperimentDefinition, selectRoutingVariant } from "./lib/routing-experiment.mjs";
import { resolveMoAMode } from "./lib/moa-mode.mjs";
import { resolveSkillPaths } from "./lib/skill-broker.mjs";
import { applyFailureAvoidance, failureGuardFor, failureMemoryPath, readFailureMemory, recordSeatFailure, recordSeatRecovery, summarizeFailureMemory } from "./lib/failure-memory.mjs";

function auditorPrompt({ task, diff, files, context }) {
  return [
    "You are the independent DeepSeekHarness audit seat in a Codex-orchestrated MoA run.",
    `Goal: ${task}`,
    diff ? `Diff:\n${diff}` : "Diff: inspect the current working directory and determine relevant changes.",
    files?.length ? `Focus files:\n${files.map((file) => `- ${file}`).join("\n")}` : "Focus files: determine from the task.",
    context ? `Additional context:\n${context}` : "",
    "",
    "Rules:",
    "1. Inspect actual files and run only read-only verification commands.",
    "2. Do not modify files.",
    "3. Every finding must include concrete evidence.",
    "4. If evidence is missing, put it in missing_evidence instead of inventing a finding.",
    "",
    "Return JSON only, with no surrounding prose. Use this shape:",
    JSON.stringify({
      verdict: "pass | warn | block",
      findings: [{ severity: "P0 | P1 | P2", file: "path", line: 1, claim: "text", evidence: "text", recommendation: "text", confidence: 0.0 }],
      missing_evidence: [],
      verified_commands: []
    }, null, 2)
  ].filter(Boolean).join("\n");
}

function executorPrompt({ seat, task, context }) {
  return [
    `You are the ${seat.seat} seat in a Codex-orchestrated MoA run.`,
    `Role: ${seat.role}`,
    `Requested model: ${seat.model}`,
    `Requested mode: ${seat.mode}`,
    seat.role === "auditor" ? "You are an auditor. Do not modify files." : "Work only inside the provided working directory.",
    `Task:\n${task}`,
    context ? `Context:\n${context}` : "",
    "",
    "Return JSON only, with no surrounding prose. Use this shape:",
    JSON.stringify({
      status: "done | failed | blocked",
      summary: "text",
      claims: [{ claim: "text", evidence: "text", file: "path", line: 1 }],
      tests: [{ command: "text", status: "passed | failed | skipped", result: "text" }],
      blockers: ["text"],
      uncertainty: ["text"]
    }, null, 2),
    "Do not claim success without evidence."
  ].filter(Boolean).join("\n");
}

function promptForSeat(seat, input) {
  if (seat.role === "auditor") return auditorPrompt(input);
  if (seat.role === "vision") {
    return `${executorPrompt({ seat, ...input })}\n\nPay special attention to visual assets, screenshots, UI behavior, and multimodal evidence.`;
  }
  return executorPrompt({ seat, ...input });
}

function compactResult(result, maxOutputChars) {
  return {
    seat: result.seat,
    harness: result.harness,
    requestedModel: result.requestedModel,
    selectedModel: result.selectedModel ?? result.requestedModel,
    modelSelection: result.modelSelection ?? "unknown",
    reasoningEffort: result.reasoningEffort ?? null,
    reasoningSelection: result.reasoningSelection ?? null,
    sessionId: result.sessionId ?? null,
    usage: result.usage ?? null,
    stopReason: result.stopReason ?? null,
    continuitySupport: result.continuitySupport ?? null,
    selectedProvider: result.selectedProvider ?? null,
    loadedSkills: result.loadedSkills ?? [],
    role: result.role,
    auditMode: result.auditMode ?? null,
    blocking: result.blocking !== false,
    pairedExecutor: result.pairedExecutor ?? null,
    mode: result.mode,
    status: result.status,
    exitCode: result.exitCode,
    timedOut: result.timedOut,
    durationMs: result.durationMs,
    worktree: result.worktree ?? null,
    worktreeState: result.worktreeState ?? null,
    partialWrite: result.partialWrite === true,
    structured: result.structured ?? null,
    round: result.round ?? 1,
    diffPath: result.diffPath ?? null,
    diffBytes: result.diffBytes ?? null,
    artifactPath: result.artifactPath,
    summary: truncateMiddle(redactText(result.summary), maxOutputChars),
    error: result.stderr ? truncateMiddle(redactText(result.stderr), Math.min(maxOutputChars, 4000)) : null
  };
}

function sanitizeInput(input) {
  return {
    task: input.task,
    cwd: input.cwd,
    mode: input.mode ?? "implement",
    stakes: input.stakes ?? "medium",
    vision: input.vision === true,
    allowWrite: input.allowWrite === true,
    continuityKey: input.continuityKey ?? null,
    memoryKey: input.memoryKey ?? null,
    worktree: input.worktree !== false,
    resume: input.resume === true
  };
}

function resultFailure(seat, error) {
  return {
    seat: seat.seat,
    harness: seat.harness,
    requestedModel: seat.model,
    role: seat.role,
    auditMode: seat.auditMode ?? null,
    blocking: seat.blocking !== false,
    pairedExecutor: seat.pairedExecutor ?? null,
    mode: seat.mode,
    status: "error",
    timedOut: false,
    durationMs: null,
    summary: "",
    error: redactText(error?.message ?? String(error))
  };
}

async function updateRegistrySeat(taskId, seat, patch) {
  await upsertSeatAtomic(seatRegistryPath(), `${taskId}:${seat.seat}`, {
    taskId,
    seat: seat.seat,
    harness: seat.harness,
    model: seat.model,
    role: seat.role,
    runtime: seat.runtime ?? "cli",
    runtimeMode: seat.runtimeMode ?? null,
    runtimeTransport: seat.runtimeTransport ?? null,
    controlCapability: seat.controlCapability ?? "boundary",
    reasoningEffort: seat.reasoningEffort,
    contextBudget: seat.contextBudget,
    outputBudget: seat.outputBudget,
    cwd: seat.cwd,
    originalCwd: seat.originalCwd ?? null,
    worktree: seat.worktree?.path ?? seat.worktree ?? null,
    ...patch
  });
}

function graphNodeMap(plan) {
  return new Map((plan.graph?.nodes ?? []).map((node) => [node.id, node]));
}

function allNodesDone(plan, checkpoint) {
  return (plan.graph?.nodes ?? []).every((node) => {
    const status = checkpoint.nodes?.[node.id]?.status;
    return status === "done" || (node.auditMode === "shadow" && ["failed", "error", "cancelled", "blocked"].includes(status));
  });
}

function stagePhase(seats = []) {
  const roles = new Set(seats.map((seat) => seat.role));
  if ([...roles].every((role) => ["architect", "researcher", "vision"].includes(role))) return "planning";
  if (roles.has("executor")) return "execution";
  if ([...roles].every((role) => ["auditor", "reviewer"].includes(role))) return "verification";
  return "mixed";
}

export function assertIsolatedExternalWrites({ allowWrite, worktree, seats }) {
  if (!allowWrite) return;
  if (worktree === false) {
    throw new Error("External writes require an isolated git worktree; worktree=false is not allowed with allowWrite=true.");
  }
  const unsafe = (seats ?? []).filter((seat) => seat.role === "executor" && !seat.worktree?.path);
  if (unsafe.length > 0) {
    throw new Error(`External writes require isolated git worktrees. No worktree was created for: ${unsafe.map((seat) => seat.seat).join(", ")}`);
  }
}

export async function runMoA(input, deps = {}) {
  const config = deps.config ?? loadConfig();
  const models = deps.models ?? loadEffectiveModels();
  const schedule = deps.schedule ?? loadSchedule();
  const pricing = deps.pricing ?? loadPricing();
  const adapterFor = deps.adapterFor ?? ((seat) => isPersistentRuntime(seat) ? runAcpAdapter : getAdapter(seat.harness));
  const createWorktreeFn = deps.createWorktree ?? createWorktree;
  const captureDiff = deps.captureWorktreeDiff ?? captureWorktreeDiff;
  const captain = await resolveCaptain({ captainModel: input.captainModel });
  const orchestration = await resolveMoAMode(input.orchestrationMode);
  const workspace = createWorkspace(config.blackboardDir, input.taskId);
  const manifestPath = join(workspace.dirs.root, "manifest.json");
  const eventsPath = join(workspace.dirs.root, "events.jsonl");
  const checkpointFile = checkpointPath(workspace.dirs.root);

  let checkpoint = input.resume ? await readCheckpoint(workspace.dirs.root) : null;
  if (input.resume && !checkpoint) throw new Error(`No resumable checkpoint found for task ${workspace.taskId}`);
  if (checkpoint && checkpoint.goal !== input.task) {
    throw new Error(`Checkpoint ${workspace.taskId} belongs to a different task. Start a new taskId or use the original task text.`);
  }
  const hadCheckpoint = Boolean(checkpoint);

  const policy = deps.policy ?? loadEvolutionPolicy();
  const ledger = await readCostLedger();
  const captainUsage = input.captainUsage ?? await readCaptainUsage();
  const allocation = captainAllocation(captain, captainUsage);
  let quotaSnapshot = input.quotaSnapshot ?? (input.respectQuota !== false ? await readQuotaSnapshot(config) : null);
  const quotaMaxAgeMs = Number(config.quota?.maxAgeMs ?? 300000);
  const quotaStale = !quotaSnapshot?.updatedAt || Date.now() - Date.parse(quotaSnapshot.updatedAt) > quotaMaxAgeMs;
  if (input.respectQuota !== false && config.quota?.refreshOnRun !== false && quotaStale) {
    quotaSnapshot = await refreshQuota(config);
  }
  const experimentEligible = input.routingExperiment !== false
    && !input.assignments?.length
    && !input.seats?.length
    && input.mode === "review"
    && input.stakes !== "high";
  const experimentState = experimentEligible ? await readRoutingExperimentState() : { experiments: {} };
  const route = experimentEligible ? selectRoutingVariant({
    policy,
    task: input.task,
    cwd: input.cwd,
    state: experimentState,
    forceVariant: checkpoint?.plan?.routingExperiment?.variant ?? null
  }) : { enabled: false, id: null, variant: "control", policy, rationale: "routing experiment not eligible" };
  const plan = planMoA({ ...input, captain, orchestrationMode: orchestration.mode, routingExperiment: route }, {
    models,
    schedule,
    policy: route.policy ?? policy,
    quotaSnapshot,
    captainAllocation: allocation,
    routePerformance: summarizeCostLedger(ledger).routes
  });
  if (plan.executionPolicy?.dispatchBlocked) {
    const error = new Error(`[${plan.executionPolicy.blockCode}] ${plan.executionPolicy.instruction} Remove external executor/build assignments, or explicitly select executionOwner=hybrid for bounded modules or executionOwner=external only when the user requested external core execution.`);
    error.code = plan.executionPolicy.blockCode;
    error.executionPolicy = plan.executionPolicy;
    throw error;
  }
  let healthRouting = null;
  let providerHealth = null;
  if (input.respectHealth !== false && !input.assignments?.length && !input.seats?.length) {
    const healthSnapshot = quotaSnapshot;
    if (healthSnapshot) {
      providerHealth = summarizeProviderHealth({
        snapshot: healthSnapshot,
        ledger,
        lowThreshold: policy.routing?.quotaLowThreshold ?? 10,
        circuitState: await readProviderState(),
        config
      });
      healthRouting = applyProviderHealthRouting(plan.seats, {
        health: providerHealth,
        modelsConfig: models,
        captain,
        allowUnhealthy: input.allowUnhealthy === true
      });
      if (healthRouting.blocked.length > 0) {
        throw new Error(`Refusing to dispatch unhealthy provider(s): ${healthRouting.blocked.map((item) => `${item.model}(${item.provider}:${item.status})`).join(", ")}. Configure a healthy provider or set allowUnhealthy=true.`);
      }
      healthRouting.adjustments.push(...reconcileAuditPairing(plan.seats, { health: providerHealth, modelsConfig: models, captain }));
      for (const node of plan.graph?.nodes ?? []) {
        const seat = plan.seats.find((item) => item.seat === node.id);
        if (seat) {
          node.model = seat.model;
          node.harness = seat.harness;
        }
      }
      plan.healthRouting = healthRouting;
    }
  }
  const failureSummary = summarizeFailureMemory(await readFailureMemory(), { config });
  let failureRouting = { adjustments: [], blocked: [] };
  if (!input.assignments?.length && !input.seats?.length) {
    failureRouting = applyFailureAvoidance(plan.seats, { summary: failureSummary, modelsConfig: models, captain, health: providerHealth });
    if (failureRouting.blocked.length > 0) {
      throw new Error(`Refusing to repeat guarded failed route(s): ${failureRouting.blocked.map((item) => item.route).join(", ")}. Wait for the guard to expire, repair the provider/Harness, or use an explicit assignment after review.`);
    }
    failureRouting.adjustments.push(...reconcileAuditPairing(plan.seats, {
      health: providerHealth,
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
  }
  if (checkpoint) {
    const knownSeats = new Set(Object.keys(checkpoint.nodes ?? {}));
    const missing = plan.seats.filter((seat) => !knownSeats.has(seat.seat)).map((seat) => seat.seat);
    if (missing.length > 0) throw new Error(`Resume plan does not match checkpoint seats. Missing: ${missing.join(", ")}`);
  }

  if (!checkpoint) checkpoint = createCheckpoint({ taskId: workspace.taskId, input, plan });
  else {
    checkpoint.plan.routingExperiment = plan.routingExperiment;
    checkpoint.resumedCount = (checkpoint.resumedCount ?? 0) + 1;
  }

  writeJson(manifestPath, {
    taskId: workspace.taskId,
    input: sanitizeInput(input),
    plan: {
      level: plan.level,
      seats: plan.seats.map((seat) => ({ seat: seat.seat, model: seat.model, harness: seat.harness, role: seat.role, runtime: seat.runtime ?? "cli", runtimeMode: seat.runtimeMode ?? null, runtimeTransport: seat.runtimeTransport ?? null, controlCapability: seat.controlCapability ?? "boundary", auditMode: seat.auditMode ?? null, pairedExecutor: seat.pairedExecutor ?? null })),
      auditStrategy: plan.auditStrategy ?? null,
      failureRouting: plan.failureRouting ?? null,
      routingExperiment: plan.routingExperiment ?? null
    },
    checkpoint: checkpointFile,
    resumed: hadCheckpoint,
    updatedAt: new Date().toISOString()
  });

  let seatInputs = plan.seats.map((seat) => ({
    ...seat,
    taskId: workspace.taskId,
    cwd: seat.cwd ?? input.cwd ?? config.defaultCwd,
    skillPaths: resolveSkillPaths([...(input.skills ?? []), ...(seat.skills ?? [])], config)
  }));
  seatInputs = mergeCheckpointIntoSeats(seatInputs, checkpoint);
  const bySeat = new Map(seatInputs.map((seat) => [seat.seat, seat]));
  const graphNodes = graphNodeMap(plan);
  const completed = completedSeatIds(checkpoint);
  const resultMap = checkpointResultMap(checkpoint);

  const allowWrite = input.allowWrite === true;
  if (allowWrite && input.worktree !== false) {
    for (const seat of seatInputs) {
      if (seat.role !== "executor" || completed.has(seat.seat)) continue;
      const worktree = await createWorktreeFn({ cwd: seat.originalCwd ?? seat.cwd, taskId: workspace.taskId, seat: seat.seat });
      if (worktree.supported) {
        seat.originalCwd ??= seat.cwd;
        seat.cwd = worktree.path;
        seat.worktree = worktree;
      }
    }
  }

  for (const seat of seatInputs) {
    const node = checkpoint.nodes?.[seat.seat];
    await updateRegistrySeat(workspace.taskId, seat, {
      status: node?.status === "done" ? "done" : "queued",
      sessionId: node?.sessionId ?? null,
      durationMs: node?.durationMs ?? null,
      diffPath: node?.diffPath ?? null,
      usage: node?.usage ?? null
    });
  }

  const continuityStore = seatInputs.some((seat) => seat.continuityKey || input.continuityKey)
    ? await readContinuityStore()
    : { version: 1, entries: {} };
  for (const seat of seatInputs) {
    if (completed.has(seat.seat)) continue;
    const group = seat.continuityKey ?? input.continuityKey;
    const key = makeContinuityKey({ group, seat: seat.seat, harness: seat.harness, model: seat.model, cwd: seat.cwd });
    const entry = continuityEntry(continuityStore, key);
    if (entry?.model && entry.model !== seat.model) {
      if (input.allowContinuityModelSwitch === true) clearContinuityEntry(continuityStore, key);
      else throw new Error(`Continuity key ${group} is bound to model ${entry.model}; requested ${seat.model}. Use allowContinuityModelSwitch=true to reset.`);
    }
    seat.continuityKeyResolved = key;
    seat.continuitySessionId = checkpoint.nodes?.[seat.seat]?.sessionId ?? entry?.sessionId ?? null;
    seat.continuityResumed = Boolean(seat.continuitySessionId);
  }

  const memoryKeySource = input.memoryKey ?? input.continuityKey ?? null;
  const memory = memoryKeySource ? await loadMemory({ key: memoryKeySource, cwd: input.cwd, title: input.task.slice(0, 80) }) : null;
  const memoryPack = memory ? buildMemoryPack(memory) : null;
  const contextPack = input.contextPack === false ? null : await buildContextPack({ cwd: input.cwd, task: input.task, maxFiles: input.maxContextFiles ?? 20 });
  const conflicts = auditConflict(captain, seatInputs, models);
  const auditWarnings = conflicts.map((item) => ({
    type: item.reason,
    model: item.model.id,
    captainFamily: captain.family,
    message: `Audit seat ${item.assignment.model} shares the captain family ${captain.family}; use a cross-family auditor for stronger independence.`
  }));
  if (auditWarnings.length > 0 && input.strictHeterogeneousAudit === true) {
    throw new Error(auditWarnings.map((warning) => warning.message).join(" "));
  }

  const quota = quotaSnapshot ? quotaForSeats(seatInputs, quotaSnapshot, models) : [];
  const quotaBySeat = new Map(quota.map((item) => [item.seat, item]));
  if (input.respectQuota !== false && quotaSnapshot) {
    const depletedAll = depletedModels(seatInputs, quotaSnapshot, models);
    for (const item of depletedAll.filter(({ assignment }) => assignment.auditMode === "shadow")) {
      item.assignment.skipDispatch = true;
      item.assignment.skipReason = `shadow provider quota depleted for ${item.assignment.model}`;
    }
    const depleted = depletedAll.filter(({ assignment }) => assignment.auditMode !== "shadow");
    if (depleted.length > 0 && !input.allowDepleted) {
      throw new Error(`Refusing to dispatch depleted model(s): ${depleted.map((item) => item.assignment.model).join(", ")}`);
    }
  }

  assertIsolatedExternalWrites({ allowWrite, worktree: input.worktree, seats: seatInputs });
  const runStartedAt = Date.now();
  const budgetPolicy = normalizeBudgetPolicy({ config, input });
  const budgetTotals = newBudgetTotals();
  const taskCostEntries = [];
  let budgetViolations = [];
  const checkBudget = () => {
    budgetViolations = evaluateBudget(budgetTotals, budgetPolicy, runStartedAt);
    return budgetViolations;
  };
  const totalNodes = plan.graph?.nodes?.length ?? 0;
  const progressCounts = () => {
    const values = Object.values(checkpoint.nodes ?? {});
    return {
      completed: values.filter((node) => node.status === "done").length,
      failed: values.filter((node) => ["failed", "error"].includes(node.status)).length,
      cancelled: values.filter((node) => node.status === "cancelled").length,
      total: totalNodes
    };
  };
  const reportProgress = async (event) => {
    try { await deps.onProgress?.({ ...event, ...progressCounts() }); } catch {}
  };
  const steeringContext = [];
  const consumeSteering = async () => {
    const messages = await deps.consumeSteering?.();
    for (const item of messages ?? []) steeringContext.push(`[${item.id}] ${item.message}`);
    if ((messages ?? []).length > 0) {
      appendEvent(eventsPath, { type: "steering_applied", messages: messages.map((item) => item.id) });
      await reportProgress({ type: "steering_applied", activeSeat: null });
    }
  };
  const runSeat = async (seat, layerIndex = 0, options = {}) => {
    const adapter = adapterFor(seat);
    const prompt = promptForSeat(seat, {
      task: input.task,
      diff: input.diff,
      files: input.files,
      context: [
        input.context,
        steeringContext.length > 0 ? `## Operator steering (newest instructions)\n${steeringContext.join("\n")}` : null,
        options.extraContext,
        contextPack ? renderContextPack(contextPack) : null,
        memoryPack ? `## Prior memory (may be stale; verify against current workspace)\n${memoryPack}` : null
      ].filter(Boolean).join("\n\n")
    });
    appendEvent(eventsPath, { type: "seat_started", seat: seat.seat, harness: seat.harness, model: seat.model, runtime: seat.runtime ?? "cli", runtimeMode: seat.runtimeMode ?? null, runtimeTransport: seat.runtimeTransport ?? null, controlCapability: seat.controlCapability ?? "boundary" });
    updateCheckpointNode(checkpoint, seat.seat, { status: "running", startedAt: new Date().toISOString(), worktreePath: seat.worktree?.path ?? null, originalCwd: seat.originalCwd ?? null });
    await writeCheckpoint(workspace.dirs.root, checkpoint);
    await reportProgress({ type: "seat_started", activeSeat: seat.seat, layer: layerIndex });
    await updateRegistrySeat(workspace.taskId, seat, { status: "running", startedAt: new Date().toISOString() });

    let result;
    try {
      result = await adapter({
        seat,
        prompt,
        config,
        timeoutMs: input.timeoutMs ?? plan.budget.defaultTimeoutMs,
        allowWrite
      });
    } catch (error) {
      result = resultFailure(seat, error);
    }
    result.round = options?.round ?? 1;
    result.auditMode = seat.auditMode ?? null;
    result.blocking = seat.blocking !== false;
    result.pairedExecutor = seat.pairedExecutor ?? null;
    result.structured = normalizeSeatResult(result, seat);

    if (seat.worktree?.path) {
      result.worktree = seat.worktree;
      const diff = await captureDiff(seat.worktree.path);
      result.diffPath = await writeDiffArtifact(workspace.dirs.root, seat.seat, diff);
      result.diffBytes = Buffer.byteLength(diff, "utf8");
      result.worktreeState = await inspectWorktree(seat.worktree.path, {
        baseCommit: seat.worktree.baseCommit ?? null,
        resultStatus: result.status,
        diff
      });
      result.partialWrite = result.worktreeState.partialWrite;
      if (config.worktrees?.cleanup === "clean_success" && result.status === "done" && result.worktreeState.clean) {
        result.worktreeCleanup = await removeWorktree(seat.worktree.path, { repo: seat.worktree.repo, force: false });
      }
    }
    await updateRegistrySeat(workspace.taskId, seat, {
      status: result.status,
      sessionId: result.sessionId ?? null,
      durationMs: result.durationMs ?? null,
      diffPath: result.diffPath ?? null,
      usage: result.usage ?? null,
      stopReason: result.stopReason ?? null,
      worktree: result.worktreeCleanup?.removed ? null : (seat.worktree?.path ?? seat.worktree ?? null),
      finishedAt: new Date().toISOString()
    });
    const resultPath = join(workspace.dirs.results, `${seat.seat}.json`);
    const textPath = join(workspace.dirs.artifacts, `${seat.seat}.md`);
    result.artifactPath = resultPath;
    writeJson(resultPath, result);
    writeText(textPath, result.summary ?? result.error ?? "");
    if (seat.continuityKeyResolved && result.sessionId) {
      setContinuityEntry(continuityStore, seat.continuityKeyResolved, {
        group: seat.continuityKey ?? input.continuityKey,
        seat: seat.seat,
        harness: seat.harness,
        model: seat.model,
        sessionId: result.sessionId,
        support: result.continuitySupport ?? "session"
      });
      await mergeContinuityStore(continuityStore);
    }
    const compact = {
      ...compactResult(result, config.maxOutputChars ?? 24000),
      continuity: seat.continuityKeyResolved ? {
        key: seat.continuityKeyResolved,
        resumed: seat.continuityResumed,
        sessionId: result.sessionId ?? seat.continuitySessionId ?? null,
        support: result.continuitySupport ?? null
      } : null
    };
    updateCheckpointNode(checkpoint, seat.seat, {
      status: result.status,
      sessionId: result.sessionId ?? null,
      durationMs: result.durationMs ?? null,
      usage: result.usage ?? null,
      stopReason: result.stopReason ?? null,
      diffPath: result.diffPath ?? null,
      worktreePath: seat.worktree?.path ?? null,
      originalCwd: seat.originalCwd ?? null,
      finishedAt: new Date().toISOString(),
      round: result.round ?? 1,
      result: compact,
      rounds: [...(checkpoint.nodes?.[seat.seat]?.rounds ?? []), { round: result.round ?? 1, at: new Date().toISOString(), status: result.status, result: compact }]
    });
    await reportProgress({ type: "seat_finished", activeSeat: null, seat: seat.seat, layer: layerIndex, status: result.status });
    appendEvent(eventsPath, {
      type: "seat_finished",
      seat: seat.seat,
      status: result.status,
      durationMs: result.durationMs,
      timedOut: result.timedOut,
      stopReason: result.stopReason ?? null,
      continuityKey: seat.continuityKeyResolved ?? null,
      continuityResumed: seat.continuityResumed
    });
    try {
      const costEntry = makeCostEntry({
        taskId: workspace.taskId,
        seat,
        result,
        quota: quotaBySeat.get(seat.seat) ?? null,
        pricing
      });
      await recordCostEntry(costEntry);
      taskCostEntries.push(costEntry);
      accumulateBudget(budgetTotals, costEntry);
    } catch {}
    if (result.status !== "done") {
      try { await recordSeatFailure({ taskId: workspace.taskId, level: plan.level, seat, result }); } catch {}
    } else {
      try { await recordSeatRecovery({ taskId: workspace.taskId, level: plan.level, seat, result }); } catch {}
    }
    if (result.status !== "cancelled" && seat.auditMode !== "shadow") {
      try {
        await recordProviderOutcome({
          provider: providerForModel(seat.model, models),
          model: seat.model,
          ok: result.status === "done",
          latencyMs: result.durationMs,
          error: result.status === "done" ? null : (result.stderr || result.summary || result.status)
        }, undefined, config);
      } catch {}
    }

    return compact;
  };

  const cancelRemaining = (reason) => {
    for (const node of plan.graph?.nodes ?? []) {
      const nodeStatus = checkpoint.nodes?.[node.id]?.status;
      if (["done", "failed", "error"].includes(nodeStatus)) continue;
      updateCheckpointNode(checkpoint, node.id, {
        status: "cancelled",
        cancelledAt: new Date().toISOString(),
        cancelReason: reason
      });
    }
  };
  const blockRemaining = (reason, details = null) => {
    for (const node of plan.graph?.nodes ?? []) {
      const nodeStatus = checkpoint.nodes?.[node.id]?.status;
      if (["done", "failed", "error", "cancelled"].includes(nodeStatus)) continue;
      updateCheckpointNode(checkpoint, node.id, {
        status: "blocked",
        blockedAt: new Date().toISOString(),
        blockReason: reason,
        budgetViolations: details
      });
    }
  };
  const dependencyContext = (seat) => {
    if (seat.role !== "auditor" && seat.role !== "reviewer") return null;
    const node = graphNodes.get(seat.seat);
    const dependencies = (node?.dependsOn ?? []).map((id) => resultMap.get(id)).filter(Boolean);
    if (dependencies.length === 0) return null;
    return [
      "## Upstream execution evidence",
      ...dependencies.flatMap((result) => [
        `### ${result.seat} (${result.requestedModel}@${result.harness})`,
        `Status: ${result.status}`,
        result.diffPath ? `Captured diff artifact: ${result.diffPath}` : "Captured diff artifact: none",
        result.summary ? `Execution summary:\n${result.summary}` : "Execution summary: none"
      ])
    ].join("\n");
  };

  const layers = plan.graph?.layers ?? [];
  for (let layerIndex = 0; layerIndex < layers.length; layerIndex += 1) {
    await consumeSteering();
    const layer = layers[layerIndex];
    if (checkBudget().length > 0) {
      blockRemaining("budget exceeded", budgetViolations);
      appendEvent(eventsPath, { type: "budget_exceeded", violations: budgetViolations, layer: layerIndex });
      break;
    }
    if (await deps.isCancelled?.()) {
      cancelRemaining("job cancellation requested");
      appendEvent(eventsPath, { type: "run_cancelled", layer: layerIndex });
      break;
    }
    const runnable = [];
    for (const seatId of layer) {
      const seat = bySeat.get(seatId);
      if (!seat) continue;
      const node = checkpoint.nodes?.[seatId];
      if (node?.status === "done") continue;
      if (seat.skipDispatch) {
        updateCheckpointNode(checkpoint, seatId, { status: "cancelled", cancelReason: seat.skipReason ?? "shadow dispatch skipped" });
        appendEvent(eventsPath, { type: "shadow_skipped", seat: seatId, reason: seat.skipReason ?? null });
        continue;
      }
      if (await deps.isCancelled?.()) {
        updateCheckpointNode(checkpoint, seatId, { status: "cancelled", cancelReason: "job cancellation requested" });
        continue;
      }
      const definition = graphNodes.get(seatId) ?? { dependsOn: [] };
      const blockedBy = definition.dependsOn.filter((dependency) => checkpoint.nodes?.[dependency]?.status !== "done");
      if (blockedBy.length > 0) {
        updateCheckpointNode(checkpoint, seatId, { status: "blocked", blockedBy });
        appendEvent(eventsPath, { type: "seat_blocked", seat: seatId, blockedBy });
        continue;
      }
      runnable.push(seat);
    }
    if (runnable.length === 0) continue;
    const stageStartedAt = new Date();
    const settled = await Promise.allSettled(runnable.map((seat) => runSeat(seat, layerIndex, { extraContext: dependencyContext(seat) })));
    settled.forEach((entry, index) => {
      const seat = runnable[index];
      if (entry.status === "fulfilled") {
        resultMap.set(seat.seat, entry.value);
      } else {
        const failure = resultFailure(seat, entry.reason);
        resultMap.set(seat.seat, failure);
        updateCheckpointNode(checkpoint, seat.seat, { status: failure.status, result: failure });
      }
    });
    const stageFinishedAt = new Date();
    const stageSeats = layer.map((seatId) => {
      const seat = bySeat.get(seatId);
      const node = checkpoint.nodes?.[seatId];
      return {
        seat: seatId,
        role: seat?.role ?? null,
        model: seat?.model ?? null,
        harness: seat?.harness ?? null,
        auditMode: seat?.auditMode ?? null,
        blocking: seat?.blocking !== false,
        status: node?.status ?? "pending",
        durationMs: node?.durationMs ?? null,
        tests: node?.result?.structured?.tests ?? []
      };
    });
    const blockingSeats = stageSeats.filter((seat) => seat.blocking !== false);
    checkpoint.stageReviews ??= [];
    checkpoint.stageReviews.push({
      layer: layerIndex,
      attempt: checkpoint.stageReviews.filter((stage) => stage.layer === layerIndex).length + 1,
      phase: stagePhase(layer.map((seatId) => bySeat.get(seatId)).filter(Boolean)),
      startedAt: stageStartedAt.toISOString(),
      finishedAt: stageFinishedAt.toISOString(),
      durationMs: stageFinishedAt.getTime() - stageStartedAt.getTime(),
      seats: stageSeats,
      blockingPassed: blockingSeats.every((seat) => seat.status === "done"),
      evidenceReadyForCaptain: true
    });
    await writeCheckpoint(workspace.dirs.root, checkpoint);
    await reportProgress({ type: "layer_finished", layer: layerIndex, activeSeat: null });
    if (checkBudget().length > 0) {
      blockRemaining("budget exceeded", budgetViolations);
      appendEvent(eventsPath, { type: "budget_exceeded", violations: budgetViolations, layer: layerIndex });
      break;
    }
  }

  let results = seatInputs.map((seat) => {
    if (resultMap.has(seat.seat)) return resultMap.get(seat.seat);
    const node = checkpoint.nodes?.[seat.seat];
    return {
      seat: seat.seat,
      harness: seat.harness,
      requestedModel: seat.model,
      role: seat.role,
      auditMode: seat.auditMode ?? null,
      blocking: seat.blocking !== false,
      pairedExecutor: seat.pairedExecutor ?? null,
      mode: seat.mode,
      status: node?.status ?? "pending",
      summary: "",
      error: node?.status === "blocked" ? `blocked by: ${(node.blockedBy ?? []).join(", ")}` : null
    };
  });

  let cancellationRequested = await deps.isCancelled?.();
  if (!cancellationRequested && checkBudget().length === 0 && (plan.budget.maxRounds ?? 1) > 1) {
    for (let round = 2; round <= plan.budget.maxRounds; round += 1) {
      if (!hasBlockingAudit(results)) break;
      if (checkBudget().length > 0) {
        blockRemaining("budget exceeded", budgetViolations);
        appendEvent(eventsPath, { type: "budget_exceeded", violations: budgetViolations, round });
        break;
      }
      const repairSeats = seatInputs.filter((seat) => seat.role === "executor");
      if (repairSeats.length === 0) break;
      const repairContext = buildRepairContext(results);
      appendEvent(eventsPath, { type: "repair_round_started", round, findings: repairContext });
      const repaired = [];
      for (const seat of repairSeats) {
        const result = await runSeat(seat, undefined, { round, extraContext: `## Required repair from previous audit\n${repairContext}` });
        resultMap.set(seat.seat, result);
        repaired.push(result);
      }
      if (repaired.some((result) => result.status !== "done")) {
        appendEvent(eventsPath, { type: "repair_round_failed", round, seats: repaired.filter((result) => result.status !== "done").map((result) => result.seat) });
        break;
      }
      const repairSummary = repaired.map((result) => `${result.seat}: ${result.summary}`).join("\n");
      const reauditSeats = seatInputs.filter((item) => ["auditor", "reviewer"].includes(item.role));
      const reauditResults = await Promise.all(reauditSeats.map((seat) => runSeat(seat, undefined, { round, extraContext: `## Required repair from previous audit\n${repairContext}\n\n## Repair results\n${repairSummary}` })));
      for (let index = 0; index < reauditSeats.length; index += 1) resultMap.set(reauditSeats[index].seat, reauditResults[index]);
      results = seatInputs.map((seat) => resultMap.get(seat.seat) ?? results.find((item) => item.seat === seat.seat));
      checkpoint.repairRounds = round - 1;
      await writeCheckpoint(workspace.dirs.root, checkpoint);
      appendEvent(eventsPath, { type: "repair_round_finished", round, blockerOpen: hasBlockingAudit(results) });
    }
  }
  if (cancellationRequested) cancelRemaining("job cancellation requested");
  const executorBySeat = new Map(seatInputs.filter((seat) => seat.role === "executor").map((seat) => [seat.seat, seat]));
  const auditDurations = results.filter((result) => result.role === "auditor").map((result) => Number(result.durationMs) || 0);
  const auditLayerMs = Math.max(0, ...auditDurations);
  const auditParallelSavedMs = Math.max(0, auditDurations.reduce((sum, value) => sum + value, 0) - auditLayerMs);
  for (const result of results.filter((item) => item.role === "auditor")) {
    const seat = bySeat.get(result.seat);
    const executor = executorBySeat.get(result.pairedExecutor) ?? seatInputs.find((item) => item.role === "executor");
    if (!seat || !executor) continue;
    const estimate = makeCostEntry({ taskId: workspace.taskId, seat, result, quota: quotaBySeat.get(seat.seat) ?? null, pricing });
    try {
      await recordAuditRun({
        taskId: workspace.taskId,
        level: plan.level,
        executorSeat: executor.seat,
        executorModel: executor.model,
        executorHarness: executor.harness,
        auditorSeat: seat.seat,
        auditorModel: seat.model,
        auditorHarness: seat.harness,
        auditMode: seat.auditMode ?? "gate",
        blocking: seat.blocking !== false,
        harnessExperiment: seat.harnessExperiment ?? null,
        status: result.status,
        timedOut: result.timedOut === true,
        verdict: result.structured?.verdict ?? null,
        findings: result.structured?.findings?.length ?? 0,
        durationMs: result.durationMs ?? null,
        outputTokens: result.usage?.outputTokens ?? null,
        outputTps: outputTps(result),
        auditLayerMs,
        auditParallelSavedMs,
        criticalPathContributor: (Number(result.durationMs) || 0) === auditLayerMs,
        estimatedUsd: estimate.estimatedUsd,
        pricingPeriod: estimate.pricingPeriod ?? null
      });
    } catch {}
  }
  checkpoint.status = cancellationRequested ? "cancelled" : allNodesDone(plan, checkpoint) ? "completed" : "partial";
  await writeCheckpoint(workspace.dirs.root, checkpoint);
  for (let index = 0; index < seatInputs.length; index += 1) {
    const seat = seatInputs[index];
    const result = results[index];
    await updateRegistrySeat(workspace.taskId, seat, {
      status: result.status,
      sessionId: result.sessionId ?? checkpoint.nodes?.[seat.seat]?.sessionId ?? null,
      durationMs: result.durationMs ?? null,
      diffPath: result.diffPath ?? null,
      usage: result.usage ?? null,
      stopReason: result.stopReason ?? null
    });
  }
  if (seatInputs.some((seat) => seat.continuityKeyResolved)) await mergeContinuityStore(continuityStore);

  let routingOutcome = null;
  let routingRollback = { rolledBack: false };
  if (plan.seats.length > 0) {
    try {
      routingOutcome = await recordRoutingOutcome(route, { taskId: workspace.taskId, results: results.filter((result) => result.auditMode !== "shadow") });
      routingRollback = await evaluateRoutingRollback(route, routingExperimentDefinition(policy));
    } catch (error) {
      routingRollback = { rolledBack: false, error: error.message };
    }
  }
  const navigator = navigatorReview({ plan, results, auditWarnings, quota, allowWrite });
  if (routingRollback.rolledBack) {
    navigator.findings.push({
      severity: "P1",
      type: "routing-rollback",
      message: routingRollback.reason,
      evidence: routingRollback.comparison
    });
    if (navigator.verdict === "pass") navigator.verdict = "warn";
  }
  writeJson(join(workspace.dirs.root, "navigator.json"), navigator);
  const resultsPath = join(workspace.dirs.root, "results.json");
  writeJson(resultsPath, results);

  if (memoryKeySource) {
    await recordEpisode({
      key: memoryKeySource,
      cwd: input.cwd,
      episode: {
        task: input.task,
        taskId: workspace.taskId,
        title: input.task.slice(0, 80),
        summary: `Level ${plan.level}; seats: ${seatInputs.map((seat) => `${seat.seat}=${seat.model}`).join(", ")}`,
        captain: captain.model,
        seats: results.map((result) => ({ seat: result.seat, model: result.requestedModel, status: result.status })),
        auditWarnings,
        navigator,
        artifacts: { root: workspace.dirs.root, results: resultsPath }
      }
    });
  }

  try {
    await recordEvolutionEvent({
      type: "task_completed",
      taskId: workspace.taskId,
      level: plan.level,
      captain,
      auditWarnings,
      quota,
      routing: { variant: route.variant, experimentId: route.id, outcome: routingOutcome, rollback: routingRollback },
      health: providerHealth ? { overall: providerHealth.overall, routing: healthRouting } : null,
      failureRouting,
      budget: { ...budgetSummary(budgetPolicy, budgetTotals, runStartedAt), exceeded: budgetViolations },
      results: results.map((result) => ({
        ...(() => {
          const planned = plan.seats.find((seat) => seat.seat === result.seat);
          return {
            reasoningEffort: result.reasoningEffort ?? planned?.reasoningEffort ?? null,
            reasoningSource: planned?.reasoningSource ?? "unknown"
          };
        })(),
        seat: result.seat,
        harness: result.harness,
        requestedModel: result.requestedModel,
        selectedModel: result.selectedModel,
        role: result.role,
        status: result.status,
        timedOut: result.timedOut,
        stopReason: result.stopReason ?? null,
        durationMs: result.durationMs,
        usage: result.usage ?? null,
        estimatedUsd: taskCostEntries.find((entry) => entry.seat === result.seat)?.estimatedUsd ?? null,
        pricingKnown: taskCostEntries.find((entry) => entry.seat === result.seat)?.pricingKnown ?? false
      })),
      stageReviews: checkpoint.stageReviews ?? []
    });
  } catch {}
  const finalFailureSummary = summarizeFailureMemory(await readFailureMemory(), { config });

  return {
    taskId: workspace.taskId,
    resumed: hadCheckpoint,
    cancelled: cancellationRequested === true,
    level: plan.level,
    orchestration,
    captain,
    auditWarnings,
    allowWrite,
    schedule: plan.schedule,
    rationale: plan.rationale,
    routingExperiment: plan.routingExperiment,
    routingOutcome,
    routingRollback,
    health: providerHealth ? { summary: providerHealth, routing: healthRouting } : null,
    failureMemory: { summary: finalFailureSummary, routing: failureRouting, path: failureMemoryPath() },
    budget: { ...budgetSummary(budgetPolicy, budgetTotals, runStartedAt), exceeded: budgetViolations },
    quota,
    navigator,
    contextPack: contextPack ? { totalTokens: contextPack.totalTokens, files: contextPack.files.map((file) => file.path) } : null,
    seats: listSeats(readSeatRegistry()).filter((seat) => seat.taskId === workspace.taskId),
    seatRegistry: seatRegistryPath(),
    memory: memory ? { key: memory.key, sourceKey: memoryKeySource, path: memory.path, pack: memoryPack } : null,
    checkpoint: {
      path: checkpointFile,
      status: checkpoint.status,
      stageReviews: checkpoint.stageReviews ?? [],
      counts: results.reduce((counts, result) => {
        counts[result.status] = (counts[result.status] ?? 0) + 1;
        return counts;
      }, {}),
      resumable: checkpoint.status !== "completed"
    },
    artifacts: {
      root: workspace.dirs.root,
      manifest: manifestPath,
      events: eventsPath,
      results: resultsPath,
      navigator: join(workspace.dirs.root, "navigator.json"),
      auditMetrics: auditMetricsPath(),
      failureMemory: failureMemoryPath()
    },
    graph: {
      layers: plan.graph?.layers ?? [],
      nodes: plan.graph?.nodes?.map((node) => ({ ...node, status: checkpoint.nodes?.[node.id]?.status ?? "pending" })) ?? []
    },
    results
  };
}

export async function runAudit(input, deps = {}) {
  const seat = input.deep ? "dsh-auditor-deep" : "dsh-auditor-fast";
  return runMoA({
    ...input,
    mode: "audit",
    stakes: input.stakes ?? (input.deep ? "high" : "medium"),
    seats: [{ seat, cwd: input.cwd, mode: "plan" }],
    allowWrite: false,
    strictHeterogeneousAudit: input.strictHeterogeneousAudit === true
  }, deps);
}
