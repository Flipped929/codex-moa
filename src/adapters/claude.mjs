import { commandParts, createResult, resolveCwd } from "./base.mjs";
import { runCommand } from "../lib/process.mjs";
import { extractClaudeOutput, extractSessionId, extractUsage } from "../lib/parser.mjs";
import { prepareClaudeHome } from "../lib/cli-homes.mjs";
import { randomUUID } from "node:crypto";

export async function runClaudeSeat({ seat, prompt, config, timeoutMs, allowWrite = false, signal, onActivity }) {
  const cwd = resolveCwd(seat.cwd, config.defaultCwd);
  const { command, args: baseArgs } = commandParts(config.commands.claude);
  const provider = seat.claude?.provider;
  const model = seat.claude?.model ?? seat.providerModel ?? seat.model;
  if (!provider) throw new Error(`Claude Code provider is not configured for model ${seat.model}`);
  const runtime = await prepareClaudeHome(config, provider, seat.skillPaths ?? []);
  const writeEnabled = allowWrite && seat.autoApprove && seat.mode !== "plan";
  const args = [
    ...baseArgs,
    "--bare",
    "--settings", runtime.settingsPath,
    "--strict-mcp-config",
    "--model", model,
    "--effort", seat.reasoningEffort ?? "high",
    "--print",
    "--output-format", "stream-json",
    "--verbose",
    "--permission-prompts", "none",
    "--permission-mode", writeEnabled ? "acceptEdits" : "plan",
    "--add-dir", cwd
  ];
  if (!writeEnabled) args.push("--restricted", "--tools", "Read,Grep,Glob");
  if (seat.maxTurns) args.push("--max-turns", String(seat.maxTurns));
  const persistent = seat.runtimeMode === "persistent" || seat.runtime === "acp" || seat.runtime === "persistent";
  const requestedSessionId = seat.continuitySessionId ?? (persistent ? randomUUID() : null);
  if (seat.continuitySessionId) args.push("--resume", seat.continuitySessionId);
  else if (requestedSessionId) args.push("--session-id", requestedSessionId);
  else args.push("--no-session-persistence");
  for (const skillPath of runtime.projectedSkills) args.push("--add-dir", skillPath);
  args.push(prompt);

  const run = await runCommand({
    command,
    args,
    cwd,
    timeoutMs,
    env: { CLAUDE_CONFIG_DIR: runtime.home },
    stripSecretEnv: config.safety?.stripSecretEnv !== false,
    signal,
    onStdoutChunk: (chunk) => onActivity?.({ stream: "stdout", bytes: chunk.length }),
    onStderrChunk: (chunk) => onActivity?.({ stream: "stderr", bytes: chunk.length })
  });
  const text = extractClaudeOutput(run.stdout);
  const sessionId = extractSessionId(run.stdout) ?? requestedSessionId;
  return createResult({
    seat,
    run,
    text,
    artifactPath: null,
    extra: {
      modelSelection: "claude-cli-flag",
      selectedProvider: provider,
      selectedModel: model,
      reasoningEffort: seat.reasoningEffort ?? "high",
      reasoningSelection: "claude-cli-flag",
      providerConfigSource: "cc-switch-isolated-projection",
      loadedSkills: seat.skillPaths ?? [],
      sessionId,
      usage: extractUsage(run.stdout),
      continuitySupport: "claude-resume"
    }
  });
}
