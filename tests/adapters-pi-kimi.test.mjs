import test from "node:test";
import assert from "node:assert/strict";
import { resolve } from "node:path";
import { runKimiSeat } from "../src/adapters/kimi.mjs";
import { runPiSeat } from "../src/adapters/pi.mjs";

const fixture = resolve("tests/fixtures/echo-args.mjs");
const baseConfig = {
  defaultCwd: process.cwd(),
  pi: { syncCcSwitchProviders: false },
  commands: {
    kimi: { command: process.execPath, args: [fixture] },
    pi: { command: process.execPath, args: [fixture] }
  },
  safety: { stripSecretEnv: true }
};

test("Kimi prompt mode never combines --prompt with --plan", async () => {
  const result = await runKimiSeat({
    seat: { seat: "kimi-plan", harness: "kimi", model: "kimi-k3", providerModel: "kimi-code/k3", mode: "plan", role: "architect" },
    prompt: "inspect only",
    config: baseConfig,
    timeoutMs: 5000,
    allowWrite: false
  });
  const args = JSON.parse(result.summary);
  assert.ok(args.includes("-p"));
  assert.equal(args.includes("--plan"), false);
  assert.equal(args.includes("--yolo"), false);
  assert.equal(result.status, "done");
});

test("Pi uses the Kimi Coding provider, read-only tools, and explicit skills", async () => {
  const result = await runPiSeat({
    seat: {
      seat: "pi-kimi",
      harness: "pi",
      model: "kimi-k3",
      pi: { provider: "cc-switch-kimi-for-coding", model: "k3" },
      mode: "plan",
      role: "architect",
      skillPaths: ["/tmp/example-skill"]
    },
    prompt: "inspect only",
    config: baseConfig,
    timeoutMs: 5000,
    allowWrite: false
  });
  const args = JSON.parse(result.summary);
  assert.deepEqual(args.slice(args.indexOf("--provider"), args.indexOf("--provider") + 4), ["--provider", "cc-switch-kimi-for-coding", "--model", "k3"]);
  assert.equal(args[args.indexOf("--tools") + 1], "read,grep,find,ls");
  assert.equal(args[args.indexOf("--skill") + 1], "/tmp/example-skill");
  assert.equal(result.status, "done");
});

test("Pi reports a model-level JSONL error even when the CLI exits zero", async () => {
  const result = await runPiSeat({
    seat: {
      seat: "pi-error",
      harness: "pi",
      model: "GLM-5.3-flash",
      pi: { provider: "cc-switch-zhipu-glm", model: "glm-5.3-flash" },
      mode: "plan",
      role: "reviewer"
    },
    prompt: "inspect only",
    config: {
      ...baseConfig,
      commands: { ...baseConfig.commands, pi: { command: process.execPath, args: [resolve("tests/fixtures/pi-jsonl-error.mjs")] } }
    },
    timeoutMs: 5000,
    allowWrite: false
  });
  assert.equal(result.status, "failed");
  assert.match(result.stderr, /401: authentication failed/);
  assert.equal(result.summary, "");
});

test("Pi passes image attachments as separate file arguments", async () => {
  const result = await runPiSeat({
    seat: {
      seat: "pi-image",
      harness: "pi",
      model: "kimi-k3",
      pi: { provider: "cc-switch-kimi-for-coding", model: "k3" },
      mode: "plan",
      role: "vision",
      attachments: ["/tmp/example.png"]
    },
    prompt: "inspect image",
    config: baseConfig,
    timeoutMs: 5000,
    allowWrite: false
  });
  const args = JSON.parse(result.summary);
  assert.ok(args.includes("@/tmp/example.png"));
  assert.equal(args.at(-1), "inspect image");
});
