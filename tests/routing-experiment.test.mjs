import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { evaluateRoutingRollback, readRoutingExperimentState, recordRoutingOutcome, routingExperimentDefinition, selectRoutingVariant } from "../src/lib/routing-experiment.mjs";

const definition = {
  id: "medium-review-tier",
  enabled: true,
  minSamples: 2,
  rollbackMargin: 0.1,
  control: { weight: 50, policyOverrides: { preferFastForMediumReview: true } },
  challenger: { weight: 50, policyOverrides: { preferFastForMediumReview: false } }
};
const policy = { routing: { preferFastForMediumReview: true, experiment: definition } };

test("selects a stable route and applies variant policy", () => {
  const control = selectRoutingVariant({ policy, task: "review parser", cwd: "/repo", forceVariant: "control" });
  const challenger = selectRoutingVariant({ policy, task: "review parser", cwd: "/repo", forceVariant: "challenger" });
  assert.equal(control.variant, "control");
  assert.equal(control.policy.routing.preferFastForMediumReview, true);
  assert.equal(challenger.variant, "challenger");
  assert.equal(challenger.policy.routing.preferFastForMediumReview, false);
});

test("automatically rolls back a challenger with a lower success rate", async () => {
  const root = await mkdtemp(join(tmpdir(), "codex-moa-routing-"));
  const path = join(root, "routing.json");
  const previous = process.env.CODEX_MOA_ROUTING_EXPERIMENT_PATH;
  process.env.CODEX_MOA_ROUTING_EXPERIMENT_PATH = path;
  const route = selectRoutingVariant({ policy, task: "review parser", cwd: "/repo", forceVariant: "challenger" });
  try {
    await recordRoutingOutcome({ ...route, variant: "control" }, { taskId: "c1", results: [{ status: "done" }] });
    await recordRoutingOutcome({ ...route, variant: "control" }, { taskId: "c2", results: [{ status: "done" }] });
    await recordRoutingOutcome({ ...route, variant: "challenger" }, { taskId: "x1", results: [{ status: "error" }] });
    await recordRoutingOutcome({ ...route, variant: "challenger" }, { taskId: "x2", results: [{ status: "error" }] });
    const rollback = await evaluateRoutingRollback(route, routingExperimentDefinition(policy));
    assert.equal(rollback.rolledBack, true);
    const pinned = selectRoutingVariant({ policy, task: "review parser", cwd: "/repo", state: await readRoutingExperimentState(path) });
    assert.equal(pinned.variant, "control");
    assert.match(pinned.rationale, /pinned to control/);
  } finally {
    if (previous === undefined) delete process.env.CODEX_MOA_ROUTING_EXPERIMENT_PATH;
    else process.env.CODEX_MOA_ROUTING_EXPERIMENT_PATH = previous;
  }
});
