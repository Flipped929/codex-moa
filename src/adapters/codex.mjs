import { commandParts, createResult, resolveCwd } from "./base.mjs";
import { runCommand } from "../lib/process.mjs";
import { extractCodexOutput, extractSessionId, extractUsage } from "../lib/parser.mjs";
import { prepareCodexHome } from "../lib/cli-homes.mjs";

export async function runCodexSeat({ seat, prompt, config, timeoutMs, allowWrite = false }) {
  const cwd = resolveCwd(seat.cwd, config.defaultCwd);
  const { command, args: baseArgs } = commandParts(config.commands.codex);
  const provider = seat.codex?.provider;
  const model = seat.codex?.model ?? seat.providerModel ?? seat.model;
  if (!provider) throw new Error(`Codex CLI provider is not configured for model ${seat.model}`);
  const runtime = await prepareCodexHome(config, provider, seat.skillPaths ?? []);
  const writeEnabled = allowWrite && seat.autoApprove && seat.mode !== "plan";
  const args = [
    ...baseArgs,
    "--ask-for-approval", "never",
    "exec",
    "--json",
    "--ephemeral",
    "--strict-config",
    "--model", model,
    "--sandbox", writeEnabled ? "workspace-write" : "read-only",
    "--cd", cwd,
    "--config", `model_reasoning_effort=\"${seat.reasoningEffort ?? "high"}\"`,
    "-"
  ];
  const skillNotice = runtime.projectedSkills.length > 0
    ? `\n\nOnly these explicitly selected Skills are available under CODEX_HOME/skills: ${runtime.projectedSkills.map((path) => path.split("/").pop()).join(", ")}.`
    : "";
  const run = await runCommand({
    command,
    args,
    cwd,
    input: `${prompt}${skillNotice}`,
    timeoutMs,
    env: { CODEX_HOME: runtime.home, CODEX_MOA_PROVIDER_API_KEY: runtime.providerApiKey },
    stripSecretEnv: config.safety?.stripSecretEnv !== false,
    allowSecretExtraEnv: true
  });
  const text = extractCodexOutput(run.stdout);
  return createResult({
    seat,
    run,
    text,
    artifactPath: null,
    extra: {
      modelSelection: "codex-cli-flag",
      selectedProvider: provider,
      selectedModel: model,
      reasoningEffort: seat.reasoningEffort ?? "high",
      reasoningSelection: "codex-config-override",
      providerConfigSource: "cc-switch-isolated-projection",
      loadedSkills: seat.skillPaths ?? [],
      sessionId: extractSessionId(run.stdout),
      usage: extractUsage(run.stdout),
      continuitySupport: "ephemeral"
    }
  });
}
