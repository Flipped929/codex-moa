import test from "node:test";
import assert from "node:assert/strict";
import { acpCommandFor } from "../src/lib/acp-seat.mjs";

const config = {
  commands: {
    kimi: { command: "kimi", args: [] },
    dsh: { command: "dsh", args: [] },
    zcode: { command: "node", args: ["zcode.cjs"] }
  }
};

test("resolves ACP commands for supported harnesses", () => {
  assert.deepEqual(acpCommandFor("kimi", config, { model: "kimi-k3", providerModel: "kimi-code/k3" }), {
    command: "kimi",
    args: ["-m", "kimi-code/k3", "acp"]
  });
  assert.deepEqual(acpCommandFor("dsh", config), {
    command: "dsh",
    args: ["--profile", "acp"]
  });
  assert.deepEqual(acpCommandFor("zcode", config), {
    command: "node",
    args: ["zcode.cjs", "app-server"]
  });
});
