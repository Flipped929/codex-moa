function normalizeKey(value) {
  return String(value ?? "").trim().toLowerCase();
}

export function listModels(modelsConfig) {
  return Object.values(modelsConfig.models ?? {}).map((model) => ({ ...model }));
}

export function resolveModel(selector, modelsConfig) {
  const key = normalizeKey(selector);
  const aliases = new Map(Object.entries(modelsConfig.aliases ?? {}).map(([alias, id]) => [normalizeKey(alias), id]));
  const id = aliases.get(key) ?? Object.keys(modelsConfig.models ?? {}).find((candidate) => normalizeKey(candidate) === key);
  if (!id) {
    const available = Object.keys(modelsConfig.models ?? {}).join(", ");
    throw new Error(`Unknown model "${selector}". Available models: ${available}`);
  }
  const model = modelsConfig.models[id];
  if (!model) throw new Error(`Model alias "${selector}" points to missing model "${id}"`);
  return { ...model };
}

export function resolveSeatModel(seat, modelsConfig) {
  const tier = seat.modelTier ?? "fast";
  const selector = seat.model ?? modelsConfig.tiers?.[tier]?.[seat.harness];
  if (!selector) throw new Error(`No model configured for harness=${seat.harness} tier=${tier}`);
  return resolveModel(selector, modelsConfig);
}

export function createExplicitSeat(assignment, index, modelsConfig) {
  if (!assignment?.model) throw new Error(`assignments[${index}].model is required`);
  const model = resolveModel(assignment.model, modelsConfig);
  const role = assignment.role ?? "executor";
  const harness = assignment.harness ?? model.harness;
  const supportedHarnesses = model.supportedHarnesses ?? [model.harness];
  if (!supportedHarnesses.includes(harness)) {
    throw new Error(`Model ${model.id} does not support harness=${harness}. Supported: ${supportedHarnesses.join(", ")}`);
  }
  const defaultMode = role === "auditor" || role === "reviewer" || role === "architect" || role === "vision" ? "plan" : "edit";
  return {
    seat: assignment.seat ?? `explicit-${model.id}-${index + 1}`,
    harness,
    model: model.id,
    providerModel: model.providerModel,
    dsh: model.dsh,
    modelTier: model.tier,
    role,
    mode: assignment.mode ?? defaultMode,
    runtime: assignment.runtime,
    reasoningEffort: assignment.reasoningEffort,
    reasoningSource: assignment.reasoningEffort ? "explicit" : undefined,
    cwd: assignment.cwd,
    autoApprove: assignment.autoApprove,
    maxTurns: assignment.maxTurns,
    allowedTools: assignment.allowedTools,
    disallowedTools: assignment.disallowedTools,
    profile: assignment.profile,
    env: assignment.env
  };
}
