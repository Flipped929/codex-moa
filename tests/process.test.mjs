import test from "node:test";
import assert from "node:assert/strict";
import { buildEnv, runCommand } from "../src/lib/process.mjs";

test("runs commands without a shell", async () => {
  const activity = [];
  const result = await runCommand({
    command: process.execPath,
    args: ["-e", "process.stdout.write('ok')"],
    timeoutMs: 5000,
    onStdoutChunk: (chunk) => activity.push(chunk.toString("utf8"))
  });
  assert.equal(result.ok, true);
  assert.equal(result.stdout, "ok");
  assert.deepEqual(activity, ["ok"]);
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

test("preserves Git author identity while stripping exact auth fields", () => {
  const env = buildEnv({
    GIT_AUTHOR_NAME: "Codex MOA",
    GIT_AUTHOR_EMAIL: "codex-moa@localhost",
    GIT_COMMITTER_NAME: "Codex MOA",
    AUTH_TOKEN: "secret",
    HTTP_AUTHORIZATION: "secret"
  }, true);
  assert.equal(env.GIT_AUTHOR_NAME, "Codex MOA");
  assert.equal(env.GIT_AUTHOR_EMAIL, "codex-moa@localhost");
  assert.equal(env.GIT_COMMITTER_NAME, "Codex MOA");
  assert.equal(env.AUTH_TOKEN, undefined);
  assert.equal(env.HTTP_AUTHORIZATION, undefined);
});
