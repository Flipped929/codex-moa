import test from "node:test";
import assert from "node:assert/strict";
import { applyRuntimeResolution, resolveSeatRuntime, runtimeCapabilities } from "../src/lib/runtime-contract.mjs";

test("maps every Harness to a persistent control transport", () => {
  const expected = {
    kimi: "native-acp",
    dsh: "native-acp",
    zcode: "zcode-app-server",
    pi: "pi-rpc",
    claude: "claude-stream-resume",
    codex: "codex-exec-resume"
  };
  for (const [harness, transport] of Object.entries(expected)) {
    assert.equal(resolveSeatRuntime({ harness, runtime: "persistent" }).transport, transport);
    assert.equal(runtimeCapabilities(harness).persistent, true);
  }
});

test("keeps legacy acp as an alias for the persistent contract", () => {
  const seat = { harness: "pi", runtime: "acp" };
  const resolved = applyRuntimeResolution(seat);
  assert.equal(resolved.mode, "persistent");
  assert.equal(seat.runtimeTransport, "pi-rpc");
  assert.equal(seat.controlCapability, "boundary");
  assert.equal(resolved.capabilities.protocolSteer, true);
});
