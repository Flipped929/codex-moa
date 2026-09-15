import test from "node:test";
import assert from "node:assert/strict";
import { buildEnv, runCommand } from "../src/lib/process.mjs";

test("runs commands without a shell", async () => {
  const result = await runCommand({
    command: process.execPath,
    args: ["-e", "process.stdout.write('ok')"],
    timeoutMs: 5000
  });
  assert.equal(result.ok, true);
  assert.equal(result.stdout, "ok");
});

test("strips secrets from inherited and caller-supplied environment", () => {
  const previous = process.env.TEST_API_KEY;
  process.env.TEST_API_KEY = "inherited-secret";
  try {
    const env = buildEnv({ OTHER_TOKEN: "extra-secret", SAFE_VALUE: "ok" }, true);
    assert.equal(env.TEST_API_KEY, undefined);
    assert.equal(env.OTHER_TOKEN, undefined);
    assert.equal(env.SAFE_VALUE, "ok");
  } finally {
    if (previous === undefined) delete process.env.TEST_API_KEY;
    else process.env.TEST_API_KEY = previous;
  }
});
