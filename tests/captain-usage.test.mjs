import test from "node:test";
import assert from "node:assert/strict";
import { captainAllocation, normalizeCaptainUsage } from "../src/lib/captain-usage.mjs";

test("normalizes GPT usage and selects a quota-aware delegation tier", () => {
  const usage = normalizeCaptainUsage({ limits: [{ limitId: "codex", usedPercent: 31, windowDurationMins: 10080 }] });
  assert.equal(usage.limits[0].remainingPercent, 69);
  const allocation = captainAllocation({ family: "unknown", provider: { name: "OpenAI Official" } }, usage);
  assert.equal(allocation.tier, "balanced");
  assert.equal(allocation.externalTargetPercent, 55);
});

test("does not apply GPT quota policy to a non-OpenAI captain", () => {
  const usage = normalizeCaptainUsage({ limits: [{ limitId: "codex", usedPercent: 95 }] });
  assert.equal(captainAllocation({ family: "moonshot" }, usage).active, false);
});

test("protects scarce GPT quota without replacing the captain", () => {
  const usage = normalizeCaptainUsage({ limits: [{ limitId: "codex", usedPercent: 82 }] });
  const allocation = captainAllocation({ family: "openai" }, usage);
  assert.equal(allocation.tier, "protect");
  assert.equal(allocation.captainTargetPercent, 15);
  assert.equal(allocation.coreOwnershipMutable, false);
  assert.match(allocation.qualityFloor, /must not transfer L3 core/);
});
