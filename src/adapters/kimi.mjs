import { commandParts, createResult, resolveCwd } from "./base.mjs";
import { runCommand } from "../lib/process.mjs";
import { extractOutput, extractSessionId, extractUsage } from "../lib/parser.mjs";

export async function runKimiSeat({ seat, prompt, config, timeoutMs, allowWrite = false }) {
  const cwd = resolveCwd(seat.cwd, config.defaultCwd);
  const { command, args: baseArgs } = commandParts(config.commands.kimi);
  const args = [
    ...baseArgs,
    "-p",
    prompt,
    "-m",
    seat.providerModel ?? seat.model,
    "--output-format",
    "stream-json",
    "--add-dir",
    cwd
  ];
  const planOnly = seat.mode === "plan" || !allowWrite || !seat.autoApprove;
  if (seat.continuitySessionId) args.push("--session", seat.continuitySessionId);
  if (planOnly) args.push("--plan");
  else args.push("--yolo");

  const run = await runCommand({
    command,
    args,
    cwd,
    timeoutMs,
    env: {
      ...(seat.reasoningEffort ? { KIMI_MODEL_THINKING_EFFORT: seat.reasoningEffort } : {}),
      ...(seat.contextBudget ? { KIMI_MODEL_MAX_CONTEXT_SIZE: String(seat.contextBudget) } : {}),
      ...(seat.outputBudget ? {
        KIMI_MODEL_MAX_OUTPUT_SIZE: String(seat.outputBudget),
        KIMI_MODEL_MAX_COMPLETION_TOKENS: String(seat.outputBudget)
      } : {})
    },
    stripSecretEnv: config.safety?.stripSecretEnv !== false
  });
  const text = extractOutput(run.stdout);
  const sessionId = extractSessionId(run.stdout) ?? seat.continuitySessionId ?? null;
  const usage = extractUsage(run.stdout);
  return createResult({
    seat,
    run,
    text,
    artifactPath: null,
    extra: { modelSelection: "cli-flag", selectedModel: seat.providerModel ?? seat.model, reasoningEffort: seat.reasoningEffort, reasoningSelection: "env:KIMI_MODEL_THINKING_EFFORT", sessionId, usage, continuitySupport: "cli-session-resume" }
  });
}
