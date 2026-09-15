const LONG_TASK_RE = /(\bssh\b|remote host|remote server|benchmark|load test|stress test|soak test|model loading|multi[- ]stage|end[- ]to[- ]end|远程|压测|基准|模型加载|多阶段|全链路)/i;

export const INTERACTIVE_LIMIT_MS = 60_000;

export function backgroundRequirement(input = {}) {
  const reasons = [];
  if (Number(input.timeoutMs ?? 0) > INTERACTIVE_LIMIT_MS) reasons.push(`timeoutMs exceeds ${INTERACTIVE_LIMIT_MS}`);
  if (input.allowWrite === true) reasons.push("write-enabled execution");
  if (LONG_TASK_RE.test(String(input.task ?? ""))) reasons.push("task is likely long-running or remote");
  if ((input.assignments ?? input.seats ?? []).some((seat) => seat?.runtime === "acp")) reasons.push("persistent ACP runtime");
  return reasons.length > 0 ? {
    code: "BACKGROUND_REQUIRED",
    message: "This run must use moa_start so the Codex turn stays steerable.",
    suggestedTool: "moa_start",
    interactiveLimitMs: INTERACTIVE_LIMIT_MS,
    reasons
  } : null;
}

export function assertInteractiveRun(input = {}) {
  const requirement = backgroundRequirement(input);
  if (!requirement) return input;
  const error = new Error();
  Object.assign(error, requirement);
  error.message = `[${requirement.code}] ${requirement.message} Reasons: ${requirement.reasons.join(", ")}. Suggested tool: ${requirement.suggestedTool}.`;
  throw error;
}
