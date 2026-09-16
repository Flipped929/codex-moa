import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { runClaudeSeat } from "../src/adapters/claude.mjs";
import { runCodexSeat } from "../src/adapters/codex.mjs";

const fixture = resolve("tests/fixtures/echo-args.mjs");

async function testConfig() {
  const root = await mkdtemp(join(tmpdir(), "codex-moa-cli-adapters-"));
  await writeFile(join(root, "settings.json"), "{}\n");
  await writeFile(join(root, "config.toml"), "model = \"test\"\n");
  return {
    defaultCwd: process.cwd(),
    commands: {
      claude: { command: process.execPath, args: [fixture] },
      codex: { command: process.execPath, args: [fixture] }
    },
    claude: { headlessHome: root, syncCcSwitchProviders: false },
    codex: { headlessHome: root, syncCcSwitchProviders: false },
    safety: { stripSecretEnv: true }
  };
}

test("Claude Code adapter uses isolated settings and read-only controls", async () => {
  const result = await runClaudeSeat({
    seat: {
      seat: "claude-kimi",
      harness: "claude",
      model: "kimi-k3",
      claude: { provider: "kimi", model: "k3[1M]" },
      role: "reviewer",
      mode: "plan",
      reasoningEffort: "high"
    },
    prompt: "inspect only",
    config: await testConfig(),
    timeoutMs: 5000,
    allowWrite: false
  });
  const args = JSON.parse(result.summary);
  assert.equal(args[args.indexOf("--model") + 1], "k3[1M]");
  assert.ok(args.includes("--restricted"));
  assert.equal(args[args.indexOf("--permission-mode") + 1], "plan");
  assert.equal(result.providerConfigSource, "cc-switch-isolated-projection");
});

test("Codex CLI adapter uses isolated CODEX_HOME and a read-only sandbox", async () => {
  const result = await runCodexSeat({
    seat: {
      seat: "codex-deepseek",
      harness: "codex",
      model: "DeepSeek-flash",
      codex: { provider: "deepseek", model: "deepseek-flash" },
      role: "auditor",
      mode: "plan",
      reasoningEffort: "max"
    },
    prompt: "inspect only",
    config: await testConfig(),
    timeoutMs: 5000,
    allowWrite: false
  });
  const args = JSON.parse(result.summary);
  assert.ok(args.indexOf("--ask-for-approval") < args.indexOf("exec"));
  assert.equal(args[args.indexOf("--model") + 1], "deepseek-flash");
  assert.equal(args[args.indexOf("--sandbox") + 1], "read-only");
  assert.equal(args[args.indexOf("--ask-for-approval") + 1], "never");
});
