import { commandParts, createResult, resolveCwd } from "./base.mjs";
import { runCommand } from "../lib/process.mjs";
import { extractOutput, extractSessionId, extractUsage } from "../lib/parser.mjs";

export async function runKimiSeat({ seat, prompt, config, timeoutMs, allowWrite = false, onActivity }) {
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
  // Kimi Code rejects --prompt together with --plan. Prompt mode is already
  // non-interactive, so enforce read-only work through the task contract and
  // reserve --yolo for explicitly approved isolated writes.
  if (!planOnly) args.push("--yolo");
  for (const skillPath of seat.skillPaths ?? []) args.push("--skills-dir", skillPath);

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
    stripSecretEnv: config.safety?.stripSecretEnv !== false,
    onStdoutChunk: (chunk) => onActivity?.({ stream: "stdout", bytes: chunk.length }),
    onStderrChunk: (chunk) => onActivity?.({ stream: "stderr", bytes: chunk.length })
  });
  const text = extractOutput(run.stdout);
  const sessionId = extractSessionId(run.stdout) ?? seat.continuitySessionId ?? null;
  const usage = extractUsage(run.stdout);
  return createResult({
    seat,
    run,
    text,
    artifactPath: null,
    extra: { modelSelection: "cli-flag", selectedModel: seat.providerModel ?? seat.model, reasoningEffort: seat.reasoningEffort, reasoningSelection: "env:KIMI_MODEL_THINKING_EFFORT", sessionId, usage, loadedSkills: seat.skillPaths ?? [], continuitySupport: "cli-session-resume" }
  });
}
