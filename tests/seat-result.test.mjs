import test from "node:test";
import assert from "node:assert/strict";
import { buildRepairContext, extractJsonObject, hasBlockingAudit, normalizeSeatResult, parseAuditResult, parseExecutionResult } from "../src/lib/seat-result.mjs";

test("extracts JSON from fenced and prefixed auditor responses", () => {
  const fenced = 'Result follows:\n```json\n{"verdict":"warn","findings":[]}\n```\n';
  assert.equal(extractJsonObject(fenced).verdict, "warn");
  assert.equal(extractJsonObject('prefix {"verdict":"pass"} suffix').verdict, "pass");
});

test("normalizes auditor findings and reports parse errors", () => {
  const audit = parseAuditResult(JSON.stringify({
    verdict: "block",
    findings: [{ severity: "P0", file: "src/a.js", line: 4, claim: "bug", evidence: "test fails", recommendation: "fix", confidence: 0.9 }],
    missing_evidence: ["runtime proof"],
    verified_commands: ["npm test"]
  }));
  assert.equal(audit.verdict, "block");
  assert.equal(audit.findings[0].severity, "P0");
  assert.equal(audit.missingEvidence[0], "runtime proof");
  assert.equal(parseAuditResult("free text").parseError !== null, true);
});

test("normalizes execution results and builds repair context", () => {
  const execution = parseExecutionResult(JSON.stringify({ status: "done", summary: "fixed", claims: [{ file: "a", evidence: "b" }] }));
  assert.equal(execution.status, "done");
  assert.equal(execution.claims.length, 1);
  const result = {
    seat: "auditor",
    role: "auditor",
    status: "done",
    structured: parseAuditResult(JSON.stringify({ verdict: "block", findings: [{ severity: "P1", file: "src/a.js", line: 2, claim: "missing test", evidence: "no test", recommendation: "add test" }] }))
  };
  assert.equal(hasBlockingAudit([result]), true);
  assert.match(buildRepairContext([result]), /add test/);
  assert.equal(normalizeSeatResult({ summary: '{"status":"done"}', status: "done" }, { role: "executor" }).status, "done");
});
