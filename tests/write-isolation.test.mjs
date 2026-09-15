import test from "node:test";
import assert from "node:assert/strict";
import { assertIsolatedExternalWrites } from "../src/orchestrator.mjs";

test("external writes require managed isolated worktrees", () => {
  assert.throws(() => assertIsolatedExternalWrites({
    allowWrite: true,
    worktree: false,
    seats: [{ seat: "executor", role: "executor" }]
  }), /isolated git worktree/);
  assert.throws(() => assertIsolatedExternalWrites({
    allowWrite: true,
    worktree: true,
    seats: [{ seat: "executor", role: "executor" }]
  }), /No worktree was created/);
  assert.doesNotThrow(() => assertIsolatedExternalWrites({
    allowWrite: true,
    worktree: true,
    seats: [{ seat: "executor", role: "executor", worktree: { path: "/managed/worktree" } }]
  }));
});
