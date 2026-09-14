import { commandParts, createResult, resolveCwd } from "./base.mjs";
import { runCommand } from "../lib/process.mjs";
import { extractOutput, extractSessionId, extractUsage } from "../lib/parser.mjs";
import { syncZCodeSelection, withZCodeLock } from "../lib/zcode-model.mjs";
import { prepareZCodeHome } from "../lib/zcode-home.mjs";

const SAFE_MODES = new Set(["plan", "edit", "build"]);

export async function runZCodeSeat({ seat, prompt, config, timeoutMs, allowWrite = false }) {
  const cwd = resolveCwd(seat.cwd, config.defaultCwd);
  const { command, args: baseArgs } = commandParts(config.commands.zcode);
  let mode = SAFE_MODES.has(seat.mode) ? seat.mode : "plan";
  if (!allowWrite || !seat.autoApprove) mode = "plan";

  return withZCodeLock(async () => {
    const zcodeHome = await prepareZCodeHome(config);
    const selection = await syncZCodeSelection({
      model: seat.providerModel ?? seat.model,
      reasoningEffort: seat.reasoningEffort,
      contextBudget: seat.contextBudget,
      outputBudget: seat.outputBudget,
      config: { ...config, zcode: { ...(config.zcode ?? {}), cliConfig: zcodeHome.cliConfigPath } }
    });

    const args = [
      ...baseArgs,
      "--cwd",
      cwd,
      "--mode",
      mode,
      "--prompt",
      prompt,
      "--no-color",
      "--json"
    ];
    if (seat.disallowedTools) args.push("--disallowed-tools", seat.disallowedTools);
    if (seat.continuitySessionId) args.push("--resume", seat.continuitySessionId);

    const run = await runCommand({
      command,
      args,
      cwd,
      timeoutMs,
      env: { HOME: zcodeHome.home },
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
      extra: {
        modelSelection: "zcode-cli-config",
        selectedProvider: selection.providerId,
        selectedModel: selection.modelKey,
        selectedModelRef: selection.modelRef,
        reasoningEffort: selection.reasoningEffort,
        reasoningSelection: "zcode-cli-config",
        contextBudget: selection.contextBudget,
        outputBudget: selection.outputBudget,
        usage,
        sessionId: sessionId ?? null,
        continuitySupport: "zcode-cli-resume"
      }
    });
  });
}
