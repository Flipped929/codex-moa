import { commandParts, createResult, resolveCwd } from "./base.mjs";
import { runCommand } from "../lib/process.mjs";
import { extractOutput, extractUsage } from "../lib/parser.mjs";
import { prepareDshHome } from "../lib/dsh-home.mjs";

export async function runDshSeat({ seat, prompt, config, timeoutMs, allowWrite = false, onActivity }) {
  const cwd = resolveCwd(seat.cwd, config.defaultCwd);
  const { command, args: baseArgs } = commandParts(config.commands.dsh);
  const tier = seat.modelTier === "deep" ? "deep" : "fast";
  const profile = seat.profile ?? config.profiles?.dsh?.[tier] ?? "headless";
  const args = [...baseArgs, "--profile", profile, prompt];
  const permissionMode = allowWrite && seat.autoApprove && seat.mode !== "plan" ? "workspace-write" : "read-only";
  const dshHome = await prepareDshHome(seat.reasoningEffort ?? null, {
    outputBudget: seat.outputBudget,
    provider: seat.dsh?.provider,
    model: seat.dsh?.model
  });

  const run = await runCommand({
    command,
    args,
    cwd,
    timeoutMs,
    env: {
      DSH_HOME: dshHome.home,
      DSH_PERMISSION_MODE: permissionMode,
      ...(seat.env ?? {})
    },
    stripSecretEnv: config.safety?.stripSecretEnv !== false,
    onStdoutChunk: (chunk) => onActivity?.({ stream: "stdout", bytes: chunk.length }),
    onStderrChunk: (chunk) => onActivity?.({ stream: "stderr", bytes: chunk.length })
  });
  const text = extractOutput(run.stdout);
  const usage = extractUsage(run.stdout);
  return createResult({
    seat,
    run,
    text,
    artifactPath: null,
    extra: { modelSelection: "dsh-home:agent-default-model", selectedProvider: dshHome.provider, selectedModel: dshHome.model ?? seat.providerModel, profile, reasoningEffort: dshHome.effort, reasoningSelection: dshHome.effort ? "dsh-home:settings" : "dsh-home:source-default", contextBudget: seat.contextBudget, outputBudget: dshHome.outputBudget, sessionId: null, usage, continuitySupport: "headless-profile-only" }
  });
}
