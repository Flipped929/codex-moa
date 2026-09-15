import test from "node:test";
import assert from "node:assert/strict";
import { auditConflict, resolveCaptain } from "../src/lib/captain.mjs";

const models = {
  models: {
    "kimi-k3": { id: "kimi-k3", family: "moonshot", harness: "kimi" },
    "GLM-5.3": { id: "GLM-5.3", family: "zhipu", harness: "zcode" },
    "DeepSeek-flash": { id: "DeepSeek-flash", family: "deepseek", harness: "dsh" }
  },
  aliases: {
    "kimi-k3": "kimi-k3",
    "glm-5.3": "GLM-5.3",
    "deepseek-flash": "DeepSeek-flash"
  },
  tiers: {},
  seats: {}
};

test("detects same-family audit conflict", () => {
  const conflicts = auditConflict(
    { family: "deepseek" },
    [{ model: "DeepSeek-flash", role: "auditor" }],
    models
  );
  assert.equal(conflicts.length, 1);
  assert.equal(conflicts[0].reason, "same-family-audit");
});

test("allows cross-family audit", () => {
  const conflicts = auditConflict(
    { family: "deepseek" },
    [{ model: "GLM-5.3", role: "auditor" }],
    models
  );
  assert.deepEqual(conflicts, []);
});

test("keeps the active Codex thread opaque when captainModel is not supplied", async () => {
  const captain = await resolveCaptain({
    ccswitchSnapshot: {
      available: true,
      currentProviders: {
        codex: { id: "codex-official", name: "OpenAI Official", appType: "codex", models: ["gpt-stale-global"] }
      }
    }
  });

  assert.equal(captain.model, "codex-selected");
  assert.equal(captain.source, "active-codex-thread");
  assert.equal(captain.family, "unknown");
  assert.equal(captain.provider.name, "OpenAI Official");
});

test("uses an explicitly reported page model for captain metadata", async () => {
  const captain = await resolveCaptain({
    captainModel: "gpt-6-astra",
    ccswitchSnapshot: { available: true, currentProviders: { codex: null } }
  });

  assert.equal(captain.model, "gpt-6-astra");
  assert.equal(captain.source, "explicit");
  assert.equal(captain.family, "openai");
});
