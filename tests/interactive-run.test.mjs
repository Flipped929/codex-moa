import test from "node:test";
import assert from "node:assert/strict";
import { assertInteractiveRun, backgroundJobHandoff, backgroundRequirement, JOB_WAIT_LIMIT_MS } from "../src/lib/interactive-run.mjs";

test("requires background jobs for long, writable, ACP, and remote work", () => {
  assert.equal(backgroundRequirement({ task: "small explanation", timeoutMs: 60000 }), null);
  assert.equal(backgroundRequirement({ task: "SSH benchmark", timeoutMs: 1000 }).code, "BACKGROUND_REQUIRED");
  assert.equal(backgroundRequirement({ task: "edit", allowWrite: true }).suggestedTool, "moa_start");
  assert.throws(() => assertInteractiveRun({ task: "continue", assignments: [{ runtime: "acp" }] }), /BACKGROUND_REQUIRED/);
});

test("background job handoff tells the captain to yield while work is active", () => {
  const active = backgroundJobHandoff({ jobId: "job-test", status: "running" }, { event: "started" });
  assert.equal(active.captainShouldYield, true);
  assert.equal(active.maxWaitMs, JOB_WAIT_LIMIT_MS);
  assert.match(active.commands.steer, /job-test/);
  assert.equal(active.appQueueFixed, true);
  assert.match(active.limitation, /official Codex queue/i);

  const settled = backgroundJobHandoff({ jobId: "job-test", status: "completed" });
  assert.equal(settled.captainShouldYield, false);
  assert.match(settled.instruction, /artifacts/i);
});
