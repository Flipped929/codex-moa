import { loadEvolutionPolicy, loadSchedule } from "./config.mjs";
import { loadEffectiveModels } from "./effective-models.mjs";
import { getScheduleState, recommendedTier } from "./scheduler.mjs";
import { createExplicitSeat, listModels, resolveModel, resolveSeatModel } from "./models.mjs";
import { effortForTask, resolveReasoningEffort } from "./reasoning.mjs"; // effortForTask retained as explicit-use util
import { budgetForTask } from "./limits.mjs";
import { buildTaskGraph } from "./task-graph.mjs";
import { applyRoleDefaults, loadRoles } from "./roles.mjs";
import { createHash } from "node:crypto";

const HIGH_RISK_RE = /(security|auth|crypto|migration|architecture|payment|credential|deploy|rollback|数据库|架构|安全|支付|迁移|密钥)/i;
const COMPLEX_RE = /(refactor|implement|fix|debug|test|migrate|performance|并发|重构|实现|修复|调试|测试|性能)/i;
const SIMPLE_RE = /^(explain|summarize|format|what is|how do i|解释|总结|格式化|是什么|怎么写)/i;

function normalizeSeats(seats) {
  if (!seats) return null;
  if (!Array.isArray(seats)) throw new Error("seats must be an array");
  return seats.map((item) => typeof item === "string" ? { seat: item } : item);
}

function normalizeAssignments(assignments) {
  if (!assignments) return null;
  if (!Array.isArray(assignments) || assignments.length === 0) throw new Error("assignments must be a non-empty array");
  return assignments;
}

function weeklyRemaining(snapshot, provider) {
  const source = snapshot?.providers?.[provider];
  if (source?.status !== "ok") return null;
  const weekly = (source.windows ?? []).find((window) => window.kind === "weekly");
  const value = Number(weekly?.remainingPercent);
  return Number.isFinite(value) ? value : null;
}

function balanceSubscriptionExecutor(seats, { input, models, policy, scheduleState, quotaSnapshot }) {
  if (input.assignments?.length || input.seats?.length || input.stakes === "high") return null;
  if (policy.routing?.balanceSubscriptions === false) return null;
  const kimiRemaining = weeklyRemaining(quotaSnapshot, "kimi");
  const zaiRemaining = weeklyRemaining(quotaSnapshot, "zai");
  if (kimiRemaining === null || zaiRemaining === null) return null;
  const threshold = Number(policy.routing?.subscriptionBalanceThreshold ?? 10);
  const gap = kimiRemaining - zaiRemaining;
  const targetFamily = scheduleState.glmNightCampaignActive ? "zhipu"
    : gap >= threshold ? "moonshot"
      : gap <= -threshold ? "zhipu"
        : null;
  if (!targetFamily) return null;
  const seat = seats.find((item) => item.role === "executor");
  if (!seat) return null;
  const current = resolveModel(seat.model, models);
  if (current.family === targetFamily && !(targetFamily === "moonshot" && seat.harness !== "pi")) return null;
  const selector = targetFamily === "moonshot"
    ? (seat.modelTier === "deep" ? "kimi-k3" : "kimi-2.8")
    : (seat.modelTier === "deep" ? "GLM-5.3" : "GLM-5.3-flash");
  const replacement = resolveModel(selector, models);
  const harness = "pi";
  if (!(replacement.supportedHarnesses ?? [replacement.harness]).includes(harness)) return null;
  const previous = { model: seat.model, harness: seat.harness };
  seat.originalModel = seat.model;
  seat.model = replacement.id;
  seat.providerModel = replacement.providerModel;
  seat.dsh = replacement.dsh;
  seat.pi = replacement.pi;
  seat.harness = harness;
  seat.modelTier = replacement.tier;
  seat.quotaBalanced = true;
  seat.quotaRationale = `subscription burn gap ${Math.abs(gap).toFixed(1)}pp; prefer the less-used ${targetFamily === "moonshot" ? "Kimi" : "GLM"} subscription through Pi`;
  return { seat: seat.seat, from: previous, to: { model: seat.model, harness }, kimiRemaining, zaiRemaining, gap };
}

function routePerformanceSignals(seats, routes = {}) {
  const eligibleTps = Object.values(routes)
    .filter((route) => route?.sampleSufficient === true && Number(route?.successRate) >= 0.75)
    .map((route) => Number(route.outputTps))
    .filter(Number.isFinite);
  const maxTps = Math.max(0, ...eligibleTps);
  const candidates = seats.map((seat) => {
    const key = `${seat.model}@${seat.harness}`;
    const observed = routes[key] ?? null;
    const eligible = observed?.sampleSufficient === true && Number(observed?.successRate) >= 0.75;
    const tpsIndex = eligible && maxTps > 0 ? Math.min(1, Number(observed.outputTps) / maxTps) : null;
    return {
      seat: seat.seat,
      route: key,
      runs: observed?.runs ?? 0,
      successRate: observed?.successRate ?? null,
      outputTps: observed?.outputTps ?? null,
      sampleSufficient: observed?.sampleSufficient === true,
      eligibleForAutomaticPreference: eligible,
      routingScore: eligible ? 0.8 * Number(observed.successRate) + 0.2 * (tpsIndex ?? 0) : null
    };
  });
  return {
    minimumSamples: 3,
    qualityGate: 0.75,
    weighting: { taskCompletion: 0.8, tps: 0.2 },
    note: "TPS is only a tie-breaker after the completion-quality gate; sparse samples are descriptive only.",
    routes: candidates
  };
}

function applyModelToSeat(seat, model, harness = model.harness) {
  seat.model = model.id;
  seat.providerModel = model.providerModel;
  seat.dsh = model.dsh;
  seat.pi = model.pi;
  seat.claude = model.claude;
  seat.codex = model.codex;
  seat.harness = harness;
  seat.modelTier = model.tier;
  seat.family = model.family;
  return seat;
}

function stablePercent(...parts) {
  return createHash("sha256").update(parts.join("\n")).digest()[0] / 255;
}

function deepSeekHarness(model, input, policy) {
  const configured = policy.audit?.deepSeekHarnessExperiment?.weights ?? { codex: 60, pi: 25, dsh: 15 };
  const supported = new Set(model.supportedHarnesses ?? [model.harness]);
  const entries = Object.entries(configured)
    .filter(([harness, weight]) => supported.has(harness) && Number(weight) > 0)
    .map(([harness, weight]) => ({ harness, weight: Number(weight) }));
  if (entries.length === 0) return model.harness;
  const total = entries.reduce((sum, item) => sum + item.weight, 0);
  let bucket = stablePercent(input.task, input.cwd ?? "", "deepseek-harness") * total;
  for (const item of entries) {
    bucket -= item.weight;
    if (bucket < 0) return item.harness;
  }
  return entries.at(-1).harness;
}

function configureAutomaticAudits(seats, { input, models, policy, level, scheduleState, quotaSnapshot, roles }) {
  if (input.assignments?.length || input.seats?.length) return { enabled: false, reason: "explicit routing" };
  const executor = seats.find((seat) => seat.role === "executor");
  const gate = seats.find((seat) => seat.role === "auditor");
  if (!executor || !gate) return { enabled: false, reason: "no automatic executor/auditor pair" };
  const executorModel = resolveModel(executor.model, models);
  const tier = level === "L3" ? "deep" : "fast";
  const kimi = tier === "deep" ? "kimi-k3" : "kimi-2.8";
  const glm = tier === "deep" ? "GLM-5.3" : "GLM-5.3-flash";
  let candidates = executorModel.family === "zhipu" ? [kimi, "DeepSeek-flash"]
    : executorModel.family === "moonshot" ? [glm, "DeepSeek-flash"]
      : weeklyRemaining(quotaSnapshot, "kimi") >= weeklyRemaining(quotaSnapshot, "zai") ? [kimi, glm] : [glm, kimi];
  if (policy.audit?.avoidCaptainFamily && input.captain?.family) {
    candidates = candidates.sort((a, b) => {
      const af = resolveModel(a, models).family === input.captain.family ? 1 : 0;
      const bf = resolveModel(b, models).family === input.captain.family ? 1 : 0;
      return af - bf;
    });
  }
  const gateModel = candidates.map((id) => {
    try { return resolveModel(id, models); } catch { return null; }
  }).find((model) => model && model.family !== executorModel.family);
  if (!gateModel) return { enabled: false, reason: "no cross-family gate model" };
  const gateHarness = gateModel.family === "deepseek" ? deepSeekHarness(gateModel, input, policy) : "pi";
  gate.seat = "cross-family-auditor-gate";
  gate.auditMode = "gate";
  gate.blocking = true;
  gate.pairedExecutor = executor.seat;
  applyModelToSeat(gate, gateModel, gateHarness);

  const peakRate = Number(policy.audit?.deepSeekShadow?.l2PeakRate ?? 0.25);
  const offPeakRate = Number(policy.audit?.deepSeekShadow?.l2OffPeakRate ?? 0.4);
  const sampleRate = level === "L3" ? Number(policy.audit?.deepSeekShadow?.l3Rate ?? 1) : scheduleState.deepSeekOffPeak ? offPeakRate : peakRate;
  const sampled = executorModel.family !== "deepseek" && gateModel.family !== "deepseek"
    && stablePercent(input.task, input.cwd ?? "", "deepseek-shadow") < sampleRate;
  let shadow = null;
  if (sampled) {
    try {
      const model = resolveModel("DeepSeek-flash", models);
      const harness = deepSeekHarness(model, input, policy);
      shadow = applyRoleDefaults(applyModelToSeat({
        seat: "deepseek-auditor-shadow",
        role: "auditor",
        mode: "plan",
        runtime: "cli",
        auditMode: "shadow",
        blocking: false,
        pairedExecutor: executor.seat,
        harnessExperiment: policy.audit?.deepSeekHarnessExperiment?.id ?? "deepseek-audit-harness-v1"
      }, model, harness), roles);
      seats.push(shadow);
    } catch {}
  }
  return {
    enabled: true,
    executor: { seat: executor.seat, model: executor.model, harness: executor.harness, family: executorModel.family },
    gate: { seat: gate.seat, model: gate.model, harness: gate.harness, family: gateModel.family },
    shadow: shadow ? { seat: shadow.seat, model: shadow.model, harness: shadow.harness, family: "deepseek" } : null,
    shadowSampleRate: sampleRate,
    shadowSampled: Boolean(shadow),
    parallel: true
  };
}

export function planMoA(input = {}, deps = {}) {
  const { task, stakes = "medium", mode = "implement", vision = false } = input;
  if (!task || typeof task !== "string") throw new Error("task is required");
  const models = deps.models ?? loadEffectiveModels();
  const schedule = deps.schedule ?? loadSchedule();
  const policy = deps.policy ?? loadEvolutionPolicy();
  const roles = deps.roles ?? loadRoles();
  const scheduleState = deps.scheduleState ?? getScheduleState(new Date(), schedule);
  const explicitAssignments = normalizeAssignments(input.assignments);
  const explicitSeats = normalizeSeats(input.seats);
  const orchestrationMode = input.orchestrationMode ?? "auto";
  if (!["off", "auto", "force"].includes(orchestrationMode)) throw new Error(`Invalid orchestrationMode: ${orchestrationMode}`);

  let level = "L1";
  if (explicitAssignments) level = "explicit";
  else if (!explicitSeats && orchestrationMode === "off") level = "L0";
  else if (stakes === "high" || HIGH_RISK_RE.test(task)) level = "L3";
  else if (stakes === "medium" || COMPLEX_RE.test(task)) level = "L2";
  else if (SIMPLE_RE.test(task)) level = "L0";
  const classifiedLevel = level;
  const delegateSimpleForOpenAiCaptain = !explicitAssignments
    && !explicitSeats
    && orchestrationMode === "auto"
    && level === "L0"
    && policy.routing?.delegateSimpleForOpenAiCaptain !== false
    && input.captain?.family === "openai";
  if (delegateSimpleForOpenAiCaptain) level = "L1";
  if (!explicitAssignments && !explicitSeats && orchestrationMode === "force" && level === "L0") level = "L1";
  if (!explicitAssignments && orchestrationMode !== "off" && (mode === "audit" || mode === "review")) level = level === "L3" ? "L3" : "L2";

  let plannedSeats;
  if (explicitAssignments) {
    plannedSeats = explicitAssignments.map((assignment, index) => applyRoleDefaults(createExplicitSeat(assignment, index, models), roles));
  } else {
    let seatNames;
    if (level === "L0") seatNames = [];
    else if (level === "L1") seatNames = ["pi-executor-fast"];
    else if (level === "L2") seatNames = ["pi-glm-executor-deep", "dsh-auditor-fast"];
    else seatNames = ["pi-glm-executor-deep", "kimi-architect", "dsh-auditor-deep"];
    if (vision && !seatNames.includes("kimi-vision")) seatNames.push("kimi-vision");
    if (level === "L2" && mode === "review" && policy.routing?.preferFastForMediumReview && seatNames[0] === "pi-glm-executor-deep") {
      seatNames[0] = "pi-glm-executor-fast";
    }

    const requestedSeats = explicitSeats ?? seatNames.map((seat) => ({ seat }));
    plannedSeats = requestedSeats.map((item) => {
      const definition = models.seats[item.seat];
      if (!definition) throw new Error(`Unknown seat: ${item.seat}`);
      const modelTier = item.modelTier ?? definition.modelTier ?? recommendedTier({ stakes, scheduleState });
      const resolved = resolveSeatModel({ ...definition, ...item, modelTier }, models);
      return applyRoleDefaults({
        ...definition,
        ...item,
        seat: item.seat,
        model: resolved.id,
        providerModel: resolved.providerModel,
        dsh: resolved.dsh,
        pi: resolved.pi,
        family: resolved.family,
        modelTier,
        harness: item.harness ?? definition.harness ?? resolved.harness
      }, roles);
    });
  }

  if (!explicitAssignments && !explicitSeats && !scheduleState.deepSeekOffPeak && stakes !== "high") {
    for (const seat of plannedSeats) {
      if (seat.harness !== "dsh" || seat.model !== "DeepSeek-flash") continue;
      const preferred = input.captain?.family === "zhipu" ? "kimi-2.8" : "GLM-5.3-flash";
      const replacement = resolveModel(preferred, models);
      seat.originalModel = seat.model;
      seat.model = replacement.id;
      seat.providerModel = replacement.providerModel;
      seat.dsh = replacement.dsh;
      seat.modelTier = replacement.tier;
      seat.harness = replacement.harness;
      seat.scheduleAdjusted = true;
      seat.scheduleRationale = "DeepSeek peak pricing; keep the DeepSeekHarness agent and use a lower-cost provider model";
    }
  }

  if (!explicitAssignments && !explicitSeats && input.captain?.family && policy.audit?.avoidCaptainFamily) {
    const preferred = policy.audit.preferredByCaptainFamily?.[input.captain.family] ?? [];
    for (const seat of plannedSeats) {
      if (seat.role !== "auditor") continue;
      const current = resolveModel(seat.model, models);
      if (current.family === input.captain.family) {
        const replacement = preferred.map((selector) => {
          try { return resolveModel(selector, models); } catch { return null; }
        }).find((model) => model && model.family !== input.captain.family);
        if (replacement) {
          const keepHarness = (replacement.supportedHarnesses ?? [replacement.harness]).includes(seat.harness);
          seat.originalModel = seat.model;
          seat.model = replacement.id;
          seat.providerModel = replacement.providerModel;
          seat.dsh = replacement.dsh;
          seat.pi = replacement.pi;
          seat.harness = seat.scheduleAdjusted && keepHarness ? seat.harness : replacement.harness;
          seat.modelTier = replacement.tier;
          seat.evolutionAdjusted = true;
        }
      }
    }
  }

  const quotaBalancing = balanceSubscriptionExecutor(plannedSeats, {
    input,
    models,
    policy,
    scheduleState,
    quotaSnapshot: deps.quotaSnapshot
  });
  const auditStrategy = configureAutomaticAudits(plannedSeats, {
    input,
    models,
    policy,
    level,
    scheduleState,
    quotaSnapshot: deps.quotaSnapshot,
    roles
  });
  const performanceSignals = routePerformanceSignals(plannedSeats, deps.routePerformance);

  for (const seat of plannedSeats) {
    const requested = seat.reasoningEffort ?? input.reasoningEffort ?? null;
    seat.reasoningRequested = requested;
    if (requested) {
      seat.reasoningEffort = resolveReasoningEffort(seat.model, requested, models);
      seat.reasoningSource = "explicit";
      seat.reasoningRationale = "explicit reasoningEffort";
    } else if ((policy.reasoning?.mode ?? "task-aware") === "task-aware") {
      const selected = effortForTask({
        selector: seat.model,
        modelsConfig: models,
        level,
        role: seat.role,
        stakes,
        policy
      });
      seat.reasoningEffort = resolveReasoningEffort(seat.model, selected.effort, models);
      seat.reasoningSource = selected.source;
      seat.reasoningRationale = `${selected.rationale}; requested=${selected.effort}; effective=${seat.reasoningEffort}`;
    } else {
      delete seat.reasoningEffort;
      seat.reasoningSource = "model-default";
      seat.reasoningRationale = "provider-default mode";
    }
    const limits = budgetForTask({
      selector: seat.model,
      level,
      role: seat.role,
      stakes,
      requestedContext: seat.contextBudget,
      requestedOutput: seat.outputBudget,
      limitMode: seat.limitMode ?? input.limitMode
    }, models);
    seat.contextWindow = limits.contextWindow;
    seat.maxOutputTokens = limits.maxOutputTokens;
    seat.contextBudget = limits.contextBudget;
    seat.outputBudget = limits.outputBudget;
    seat.limitSource = limits.source;
  }

  return {
    level,
    orchestrationMode,
    captain: input.captain ?? null,
    evolutionPolicy: policy,
    mode,
    stakes,
    vision,
    schedule: scheduleState,
    routingExperiment: input.routingExperiment ? {
      enabled: input.routingExperiment.enabled === true,
      id: input.routingExperiment.id ?? null,
      variant: input.routingExperiment.variant ?? "control",
      bucket: input.routingExperiment.bucket ?? null,
      forced: input.routingExperiment.forced === true,
      rationale: input.routingExperiment.rationale ?? null
    } : null,
    quotaBalancing,
    auditStrategy,
    captainDelegation: {
      simpleDelegated: delegateSimpleForOpenAiCaptain,
      classifiedLevel,
      effectiveLevel: level,
      rationale: delegateSimpleForOpenAiCaptain
        ? "Confirmed OpenAI/GPT captain keeps planning, verification, integration, and final answer while a fast external seat handles routine execution."
        : null
    },
    captainAllocation: deps.captainAllocation ?? { active: false, reason: "captain usage was not supplied" },
    performanceSignals,
    seats: plannedSeats,
    graph: buildTaskGraph(plannedSeats),
    roles: [...roles.values()].map((role) => ({ name: role.name, description: role.description, defaults: role.defaults, origin: role.origin })),
    availableModels: listModels(models).map((item) => ({ id: item.id, harness: item.harness, tier: item.tier })),
    budget: {
      maxSeats: plannedSeats.length,
      maxRounds: level === "L2" || level === "L3" ? 2 : 1,
      defaultTimeoutMs: level === "L3" ? Number(policy.timeouts?.deepMs ?? 1200000) : Number(policy.timeouts?.fastMs ?? 900000)
    },
    rationale: [
      `classified as ${level}`,
      delegateSimpleForOpenAiCaptain ? "GPT captain delegated routine execution and retained quality control" : null,
      `orchestration mode: ${orchestrationMode}`,
      `${plannedSeats.length} external seat(s)`,
      plannedSeats.some((seat) => seat.model) ? `models: ${plannedSeats.map((seat) => seat.model).join(", ")}` : "no external model",
      scheduleState.glmNightCampaignActive ? "GLM night campaign active" : "GLM night campaign inactive",
      scheduleState.deepSeekOffPeak ? "DeepSeek off-peak" : "DeepSeek peak",
      deps.captainAllocation?.active ? `GPT quota tier ${deps.captainAllocation.tier}; external target ${deps.captainAllocation.externalTargetPercent}%` : "captain quota allocation inactive"
    ].filter(Boolean)
  };
}
