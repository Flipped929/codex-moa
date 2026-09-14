import test from "node:test";
import assert from "node:assert/strict";
import { runCommand } from "../src/lib/process.mjs";

test("runs commands without a shell", async () => {
  const result = await runCommand({
    command: process.execPath,
    args: ["-e", "process.stdout.write('ok')"],
    timeoutMs: 5000
  });
  assert.equal(result.ok, true);
  assert.equal(result.stdout, "ok");
});
