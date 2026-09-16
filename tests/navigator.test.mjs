import test from "node:test";
import assert from "node:assert/strict";
import { navigatorReview } from "../src/lib/navigator.mjs";

test("navigator warns on failed seats and missing diffs", () => {
  const review = navigatorReview({
    plan: { level: "L2" },
    results: [
      { seat: "executor", role: "executor", status: "done", diffPath: null },
      { seat: "auditor", role: "auditor", status: "failed", error: "timeout" }
    ],
    auditWarnings: [{ message: "same family" }],
    quota: [],
    allowWrite: true
  });
  assert.equal(review.verdict, "warn");
  assert.ok(review.findings.some((item) => item.type === "missing-diff"));
  assert.ok(review.findings.some((item) => item.type === "seat-failed"));
});

test("navigator does not require a diff from read-only executors", () => {
  const review = navigatorReview({
    plan: { level: "L1" },
    results: [{ seat: "executor", role: "executor", status: "done", diffPath: null }],
    allowWrite: false
  });
  assert.equal(review.verdict, "pass");
  assert.equal(review.checks.missingDiffs, 0);
});

test("navigator blocks conflict markers and warns on partial writes", () => {
  const review = navigatorReview({
    plan: { level: "L2" },
    results: [
      { seat: "executor", role: "executor", status: "failed", artifactPath: "x", partialWrite: true },
      { seat: "reviewer", role: "reviewer", status: "done", artifactPath: "x", worktreeState: { hasConflicts: true } }
    ],
    auditWarnings: [],
    quota: []
  });
  assert.equal(review.verdict, "block");
  assert.ok(review.findings.some((item) => item.type === "partial-write"));
  assert.ok(review.findings.some((item) => item.type === "worktree-conflict-markers"));
});

test("shadow audit failure is observable but non-gating", () => {
  const review = navigatorReview({
    plan: { level: "L2" },
    results: [
      { seat: "executor", role: "executor", status: "done" },
      { seat: "gate", role: "auditor", auditMode: "gate", status: "done", structured: { kind: "audit", verdict: "pass", findings: [] } },
      { seat: "shadow", role: "auditor", auditMode: "shadow", status: "failed", error: "timeout" }
    ]
  });
  assert.equal(review.verdict, "warn");
  assert.equal(review.checks.seatFailures, 0);
  assert.equal(review.checks.shadowFailures, 1);
  assert.ok(review.findings.some((item) => item.type === "shadow-audit-failed"));
});
