import { commandParts, createResult, resolveCwd } from "./base.mjs";
import { runCommand } from "../lib/process.mjs";
import { extractPiError, extractPiOutput, extractPiUsage, extractSessionId } from "../lib/parser.mjs";
import { preparePiHome } from "../lib/pi-home.mjs";

const READ_ONLY_TOOLS = "read,grep,find,ls";
const WRITE_TOOLS = "read,bash,edit,write,grep,find,ls";

export async function runPiSeat({ seat, prompt, config, timeoutMs, allowWrite = false, signal }) {
  const cwd = resolveCwd(seat.cwd, config.defaultCwd);
  const { command, args: baseArgs } = commandParts(config.commands.pi);
  const provider = seat.pi?.provider;
  const model = seat.pi?.model ?? seat.providerModel ?? seat.model;
  if (!provider) throw new Error(`Pi provider is not configured for model ${seat.model}`);
  const piHome = config.pi?.syncCcSwitchProviders === false ? null : await preparePiHome(config);
  if (piHome && !piHome.providerIds.includes(provider)) {
    throw new Error(`CC Switch Pi provider is not configured: ${provider}`);
  }

  const writeEnabled = allowWrite && seat.autoApprove && seat.mode !== "plan";
  const args = [
    ...baseArgs,
    "--provider",
    provider,
    "--model",
    model,
    "--mode",
    "json",
    "--print",
    "--tools",
    writeEnabled ? WRITE_TOOLS : READ_ONLY_TOOLS,
    "--approve"
  ];
  if (seat.reasoningEffort) args.push("--thinking", seat.reasoningEffort);
  if (seat.continuitySessionId) args.push("--session-id", seat.continuitySessionId);
  else args.push("--no-session");
  for (const skillPath of seat.skillPaths ?? []) args.push("--skill", skillPath);
  args.push("--");
  for (const attachment of seat.attachments ?? []) args.push(`@${attachment}`);
  args.push(prompt);

  const run = await runCommand({
    command,
    args,
    cwd,
    timeoutMs,
    env: piHome ? { PI_CODING_AGENT_DIR: piHome.home } : {},
    stripSecretEnv: config.safety?.stripSecretEnv !== false,
    signal
  });
  const text = extractPiOutput(run.stdout);
  const piError = extractPiError(run.stdout);
  const sessionId = extractSessionId(run.stdout) ?? seat.continuitySessionId ?? null;
  const usage = extractPiUsage(run.stdout);
  return createResult({
    seat,
    run: piError ? { ...run, ok: false, stderr: [run.stderr, piError].filter(Boolean).join("\n") } : run,
    text,
    artifactPath: null,
    extra: {
      modelSelection: "pi-provider-model",
      selectedProvider: provider,
      selectedModel: model,
      reasoningEffort: seat.reasoningEffort ?? null,
      reasoningSelection: seat.reasoningEffort ? "pi-cli-flag" : "provider-default",
      loadedSkills: seat.skillPaths ?? [],
      providerConfigSource: piHome ? "cc-switch-isolated-projection" : "pi-default-home",
      sessionId,
      usage,
      continuitySupport: "pi-session-id"
    }
  });
}
