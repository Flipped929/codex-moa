import { spawn } from "node:child_process";

const SECRET_ENV_RE = /(^|[_-])(API[_-]?KEY|TOKEN|SECRET|PASSWORD|CREDENTIALS?|AUTH|AUTHORIZATION)([_-]|$)/i;
export function buildEnv(extra = {}, stripSecretEnv = true, allowSecretExtraEnv = false) {
  const base = stripSecretEnv
    ? Object.fromEntries(Object.entries(process.env).filter(([key]) => !SECRET_ENV_RE.test(key)))
    : { ...process.env };
  const safeExtra = stripSecretEnv && !allowSecretExtraEnv
    ? Object.fromEntries(Object.entries(extra).filter(([key]) => !SECRET_ENV_RE.test(key)))
    : extra;
  return { ...base, ...safeExtra };
}

function killTree(child, signal = "SIGTERM") {
  if (!child?.pid) return;
  try {
    if (process.platform !== "win32") process.kill(-child.pid, signal);
    else child.kill(signal);
  } catch {
    try { child.kill(signal); } catch {}
  }
}

export function runCommand({
  command,
  args = [],
  cwd,
  input,
  env = {},
  timeoutMs = 300000,
  maxOutputBytes = 8 * 1024 * 1024,
  stripSecretEnv = true,
  allowSecretExtraEnv = false,
  signal,
  onSpawn,
  onStdoutChunk,
  onStderrChunk
}) {
  return new Promise((resolve) => {
    const startedAt = Date.now();
    let stdout = "";
    let stderr = "";
    let timedOut = false;
    let settled = false;
    let child;
    try {
      child = spawn(command, args, {
        cwd,
        env: buildEnv(env, stripSecretEnv, allowSecretExtraEnv),
        detached: process.platform !== "win32",
        shell: false,
        stdio: ["pipe", "pipe", "pipe"]
      });
      onSpawn?.(child);
    } catch (error) {
      return resolve({
        ok: false,
        code: null,
        signal: null,
        stdout,
        stderr: String(error?.message ?? error),
        timedOut: false,
        durationMs: Date.now() - startedAt
      });
    }

    const append = (target, chunk) => {
      const next = target + chunk.toString("utf8");
      return Buffer.byteLength(next, "utf8") <= maxOutputBytes ? next : next.slice(0, maxOutputBytes);
    };

    child.stdout.on("data", (chunk) => { stdout = append(stdout, chunk); onStdoutChunk?.(chunk); });
    child.stderr.on("data", (chunk) => { stderr = append(stderr, chunk); onStderrChunk?.(chunk); });
    let aborted = false;
    const abort = () => {
      aborted = true;
      killTree(child, "SIGTERM");
      setTimeout(() => killTree(child, "SIGKILL"), 3000).unref?.();
    };
    if (signal?.aborted) abort();
    else signal?.addEventListener?.("abort", abort, { once: true });
    child.on("error", (error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      signal?.removeEventListener?.("abort", abort);
      resolve({ ok: false, code: null, signal: null, stdout, stderr: String(error?.message ?? error), timedOut, durationMs: Date.now() - startedAt });
    });

    const timer = setTimeout(() => {
      timedOut = true;
      killTree(child, "SIGTERM");
      setTimeout(() => killTree(child, "SIGKILL"), 3000).unref?.();
    }, Math.max(1, timeoutMs));

    child.on("close", (code, signal) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      signal?.removeEventListener?.("abort", abort);
      resolve({ ok: code === 0 && !timedOut && !aborted, code, signal, stdout, stderr: aborted ? [stderr, "Process cancelled"].filter(Boolean).join("\n") : stderr, timedOut, aborted, durationMs: Date.now() - startedAt });
    });

    if (input !== undefined) child.stdin.end(String(input));
    else child.stdin.end();
  });
}
