import { runAcpSeat } from "../lib/acp-seat.mjs";
import { createResult } from "./base.mjs";

export async function runAcpAdapter({ seat, prompt, config, timeoutMs, allowWrite = false }) {
  const startedAt = Date.now();
  const result = await runAcpSeat({ seat, prompt, config, timeoutMs, allowWrite });
  const status = result.stopReason === "cancelled" ? "cancelled"
    : result.stopReason === "error" ? "failed"
      : result.text ? "done" : "failed";
  return createResult({
    seat,
    run: {
      ok: status === "done",
      code: status === "done" ? 0 : 1,
      signal: null,
      stdout: "",
      stderr: status === "done" ? "" : (result.text || result.stopReason || "ACP seat did not produce output"),
      timedOut: false,
      durationMs: Date.now() - startedAt
    },
    text: result.text,
    artifactPath: null,
    extra: {
      status,
      sessionId: result.sessionId,
      continuitySupport: "acp-process",
      stopReason: result.stopReason,
      usage: result.usage ?? null,
      modelSelection: "acp-session",
      reasoningEffort: seat.reasoningEffort,
      reasoningSelection: "acp-session-config"
    }
  });
}
