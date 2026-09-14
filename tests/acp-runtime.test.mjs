import test from "node:test";
import assert from "node:assert/strict";
import { resolve } from "node:path";
import { cancelAcpSeats, listAcpSeats, runAcpSeat, stopAcpSeats } from "../src/lib/acp-seat.mjs";

function config() {
  return {
    defaultCwd: process.cwd(),
    acp: { commands: { kimi: { command: process.execPath, args: [resolve("tests/fixtures/fake-acp-agent.mjs")] } } },
    commands: { kimi: { command: process.execPath, args: [] } },
    safety: { stripSecretEnv: false }
  };
}

function seat(name) {
  return { seat: name, taskId: "acp-test", harness: "kimi", model: "kimi-2.8", providerModel: "kimi-code/kimi-for-coding", role: "executor", mode: "plan", runtime: "acp", cwd: process.cwd(), autoApprove: false };
}

test("runs an ACP prompt and extracts usage", async () => {
  try {
    const result = await runAcpSeat({ seat: seat("fake-normal"), prompt: "hello", config: config(), timeoutMs: 5000, allowWrite: false });
    assert.equal(result.text, "FAKE_ACP_OK");
    assert.equal(result.stopReason, "end_turn");
    assert.equal(result.usage.totalTokens, 7);
    assert.equal(result.usage.contextUsed, 1234);
    assert.equal(result.usage.contextWindow, 10000);
  } finally {
    await stopAcpSeats();
  }
});

test("cancels an in-flight ACP prompt", async () => {
  const previous = process.env.FAKE_ACP_HANG;
  process.env.FAKE_ACP_HANG = "1";
  const cfg = config();
  try {
    const running = runAcpSeat({ seat: seat("fake-cancel"), prompt: "wait", config: cfg, timeoutMs: 10000, allowWrite: false });
    for (let attempt = 0; attempt < 40; attempt += 1) {
      if (listAcpSeats().some((entry) => entry.taskId === "acp-test" && entry.seat === "fake-cancel" && entry.sessionId)) break;
      await new Promise((resolveDelay) => setTimeout(resolveDelay, 25));
    }
    const cancelled = await cancelAcpSeats({ taskId: "acp-test", seat: "fake-cancel" });
    assert.equal(cancelled[0].cancelled, true);
    const result = await running;
    assert.equal(result.stopReason, "cancelled");
    assert.match(result.text, /CANCELLED/);
  } finally {
    if (previous === undefined) delete process.env.FAKE_ACP_HANG;
    else process.env.FAKE_ACP_HANG = previous;
    await stopAcpSeats();
  }
});
