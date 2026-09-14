import { loadConfig } from "./config.mjs";
import { runAcpAdapter } from "../adapters/acp.mjs";
import { stopAcpSeats } from "./acp-seat.mjs";

const HARNESSES = ["kimi", "dsh", "zcode"];
const SEATS = {
  kimi: { seat: "acp-smoke-kimi", harness: "kimi", model: "kimi-2.8", providerModel: "kimi-code/kimi-for-coding", reasoningEffort: "high" },
  dsh: { seat: "acp-smoke-dsh", harness: "dsh", model: "DeepSeek-flash", providerModel: "deepseek-flash", reasoningEffort: "high" },
  zcode: { seat: "acp-smoke-zcode", harness: "zcode", model: "GLM-5.3-flash", providerModel: "GLM-5.3-Flash", reasoningEffort: "low", contextBudget: 131072, outputBudget: 16384 }
};

function classifyFailure(message) {
  if (/auth|login|unauthorized|credential/i.test(message)) return "auth_required";
  if (/captcha|provider|business|model request|turn failed|quota|rate limit|balance/i.test(message)) return "provider_error";
  return "failed";
}

export async function smokeAcpHarness({ harness, config = loadConfig(), timeoutMs = 180000, prompt = "Reply with exactly ACP_SMOKE_OK and nothing else.", cwd = process.cwd() }) {
  const base = SEATS[harness];
  if (!base) throw new Error(`Unknown ACP harness: ${harness}`);
  const seat = { ...base, role: "executor", mode: "plan", runtime: "acp", cwd, autoApprove: false };
  const startedAt = Date.now();
  try {
    const result = await runAcpAdapter({ seat, prompt, config, timeoutMs, allowWrite: false });
    const text = String(result.summary ?? "").trim();
    const passed = result.status === "done" && text.includes("ACP_SMOKE_OK");
    return {
      harness,
      status: passed ? "pass" : classifyFailure(`${result.stderr ?? ""}\n${text}`),
      transportOk: result.sessionId !== null || result.stopReason !== null,
      durationMs: Date.now() - startedAt,
      sessionId: result.sessionId ?? null,
      stopReason: result.stopReason ?? null,
      usage: result.usage ?? null,
      text,
      error: result.stderr || null
    };
  } catch (error) {
    return {
      harness,
      status: classifyFailure(error?.message ?? String(error)),
      transportOk: false,
      durationMs: Date.now() - startedAt,
      sessionId: null,
      stopReason: null,
      usage: null,
      text: "",
      error: error?.message ?? String(error)
    };
  } finally {
    await stopAcpSeats();
  }
}

export async function smokeAcpHarnesses({ harnesses = HARNESSES, config = loadConfig(), timeoutMs = 180000, prompt, cwd = process.cwd() } = {}) {
  const requested = harnesses.includes("all") ? HARNESSES : harnesses;
  const results = [];
  for (const harness of requested) {
    results.push(await smokeAcpHarness({ harness, config, timeoutMs, prompt, cwd }));
  }
  return {
    ok: results.every((result) => result.status === "pass"),
    results
  };
}

export { HARNESSES };
