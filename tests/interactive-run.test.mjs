import test from "node:test";
import assert from "node:assert/strict";
import { assertInteractiveRun, backgroundRequirement } from "../src/lib/interactive-run.mjs";

test("requires background jobs for long, writable, ACP, and remote work", () => {
  assert.equal(backgroundRequirement({ task: "small explanation", timeoutMs: 60000 }), null);
  assert.equal(backgroundRequirement({ task: "SSH benchmark", timeoutMs: 1000 }).code, "BACKGROUND_REQUIRED");
  assert.equal(backgroundRequirement({ task: "edit", allowWrite: true }).suggestedTool, "moa_start");
  assert.throws(() => assertInteractiveRun({ task: "continue", assignments: [{ runtime: "acp" }] }), /BACKGROUND_REQUIRED/);
});
