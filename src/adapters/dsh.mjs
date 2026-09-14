import { commandParts, createResult, resolveCwd } from "./base.mjs";
import { runCommand } from "../lib/process.mjs";
import { extractOutput, extractUsage } from "../lib/parser.mjs";
import { prepareDshHome } from "../lib/dsh-home.mjs";

export async function runDshSeat({ seat, prompt, config, timeoutMs, allowWrite = false }) {
  if (seat.model !== "DeepSeek-flash") throw new Error(`DSH adapter only supports DeepSeek-flash, received ${seat.model}`);
  const cwd = resolveCwd(seat.cwd, config.defaultCwd);
  const { command, args: baseArgs } = commandParts(config.commands.dsh);
  const tier = seat.modelTier === "deep" ? "deep" : "fast";
  const profile = seat.profile ?? config.profiles?.dsh?.[tier] ?? "headless";
  const args = [...baseArgs, "--profile", profile, prompt];
  const permissionMode = allowWrite && seat.mode !== "plan" ? "workspace-write" : "read-only";
  const dshHome = await prepareDshHome(seat.reasoningEffort ?? "high", { outputBudget: seat.outputBudget });

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
    stripSecretEnv: config.safety?.stripSecretEnv !== false
  });
  const text = extractOutput(run.stdout);
  const usage = extractUsage(run.stdout);
  return createResult({
    seat,
    run,
    text,
    artifactPath: null,
    extra: { modelSelection: "profile-default", selectedModel: seat.providerModel ?? "deepseek-flash", profile, reasoningEffort: dshHome.effort, reasoningSelection: "dsh-home:settings", contextBudget: seat.contextBudget, outputBudget: dshHome.outputBudget, sessionId: null, usage, continuitySupport: "headless-profile-only" }
  });
}
