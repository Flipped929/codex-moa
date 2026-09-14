import { existsSync, statSync } from "node:fs";
import { resolve } from "node:path";

export function resolveCwd(cwd, fallback) {
  const value = resolve(cwd || fallback || process.cwd());
  if (!existsSync(value) || !statSync(value).isDirectory()) throw new Error(`Working directory does not exist: ${value}`);
  return value;
}

export function commandParts(commandConfig) {
  if (!commandConfig) throw new Error("Missing command configuration");
  if (typeof commandConfig === "string") return { command: commandConfig, args: [] };
  if (!commandConfig.command) throw new Error("Command configuration requires a command");
  return { command: commandConfig.command, args: [...(commandConfig.args ?? [])] };
}

export function createResult({ seat, run, text, artifactPath, extra = {} }) {
  return {
    seat: seat.seat,
    harness: seat.harness,
    requestedModel: seat.model,
    role: seat.role,
    mode: seat.mode,
    status: run.ok && text ? "done" : "failed",
    exitCode: run.code,
    signal: run.signal,
    timedOut: run.timedOut,
    durationMs: run.durationMs,
    summary: text,
    stderr: run.stderr,
    artifactPath,
    ...extra
  };
}
