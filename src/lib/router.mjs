import { loadEvolutionPolicy, loadSchedule } from "./config.mjs";
import { loadEffectiveModels } from "./effective-models.mjs";
import { getScheduleState, recommendedTier } from "./scheduler.mjs";
import { createExplicitSeat, listModels, resolveModel, resolveSeatModel } from "./models.mjs";
import { effortForTask, resolveReasoningEffort } from "./reasoning.mjs"; // effortForTask retained as explicit-use util
import { budgetForTask } from "./limits.mjs";
import { buildTaskGraph } from "./task-graph.mjs";
import { applyRoleDefaults, loadRoles } from "./roles.mjs";

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
  if (!explicitAssignments && !explicitSeats && orchestrationMode === "force" && level === "L0") level = "L1";
  if (!explicitAssignments && orchestrationMode !== "off" && (mode === "audit" || mode === "review")) level = level === "L3" ? "L3" : "L2";

  let plannedSeats;
  if (explicitAssignments) {
    plannedSeats = explicitAssignments.map((assignment, index) => applyRoleDefaults(createExplicitSeat(assignment, index, models), roles));
  } else {
    let seatNames;
    if (level === "L0") seatNames = [];
    else if (level === "L1") seatNames = ["zcode-executor-fast"];
    else if (level === "L2") seatNames = ["zcode-executor-deep", "dsh-auditor-fast"];
    else seatNames = ["zcode-executor-deep", "kimi-architect", "dsh-auditor-deep"];
    if (vision && !seatNames.includes("kimi-vision")) seatNames.push("kimi-vision");
    if (level === "L2" && mode === "review" && policy.routing?.preferFastForMediumReview && seatNames[0] === "zcode-executor-deep") {
      seatNames[0] = "zcode-executor-fast";
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
      seat.harness = "dsh";
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
          seat.harness = keepHarness ? seat.harness : replacement.harness;
          seat.modelTier = replacement.tier;
          seat.evolutionAdjusted = true;
        }
      }
    }
  }

  for (const seat of plannedSeats) {
    // 2026-09-15 用户裁决：codex-moa 不再自动指定思考等级，交给模型/harness 默认值。
    // 仅当用户显式传入（seat.reasoningEffort / input.reasoningEffort）时才生效。
    const requested = seat.reasoningEffort ?? input.reasoningEffort ?? null;
    seat.reasoningRequested = requested;
    if (requested) {
      seat.reasoningEffort = resolveReasoningEffort(seat.model, requested, models);
      seat.reasoningSource = "explicit";
      seat.reasoningRationale = "explicit reasoningEffort";
    } else {
      delete seat.reasoningEffort;
      seat.reasoningSource = "model-default";
      seat.reasoningRationale = "hands-off: model/harness default";
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
      `orchestration mode: ${orchestrationMode}`,
      `${plannedSeats.length} external seat(s)`,
      plannedSeats.some((seat) => seat.model) ? `models: ${plannedSeats.map((seat) => seat.model).join(", ")}` : "no external model",
      scheduleState.glmNightCampaignActive ? "GLM night campaign active" : "GLM night campaign inactive",
      scheduleState.deepSeekOffPeak ? "DeepSeek off-peak" : "DeepSeek peak"
    ]
  };
}
