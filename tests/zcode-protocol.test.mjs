import test from "node:test";
import assert from "node:assert/strict";
import { resolve } from "node:path";
import { ZCodeSeat } from "../src/lib/acp-seat.mjs";

function makeSeat() {
  return new ZCodeSeat({
    key: "zcode-test",
    taskId: "zcode-test",
    seat: "zcode-test",
    model: "GLM-5.3-flash",
    command: process.execPath,
    args: [resolve("tests/fixtures/fake-zcode-server.mjs")],
    cwd: process.cwd(),
    writeAllowed: false,
    selection: { providerId: "fake", modelKey: "fake-model" }
  });
}

test("bridges ZCode Protocol prompt and usage into the ACP seat contract", async () => {
  const seat = makeSeat();
  try {
    const result = await seat.prompt({ prompt: "hi" });
    assert.equal(result.sessionId, "sess_fake_zcode");
    assert.equal(result.text, "ZCODE_ACP_OK");
    assert.equal(result.stopReason, "end_turn");
    assert.equal(result.usage.totalTokens, 12);
  } finally {
    seat.stop();
  }
});

test("cancels a ZCode turn through session/stop", async () => {
  const seat = makeSeat();
  try {
    const running = seat.prompt({ prompt: "long task" });
    for (let attempt = 0; attempt < 40 && !seat.sessionId; attempt += 1) await new Promise((resolveDelay) => setTimeout(resolveDelay, 10));
    await seat.cancel();
    const result = await running;
    assert.equal(result.stopReason, "cancelled");
  } finally {
    seat.stop();
  }
});
