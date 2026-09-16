export function navigatorReview({ plan, results, auditWarnings = [], quota = [], allowWrite = false }) {
  const findings = [];
  const shadows = (results ?? []).filter((result) => result.auditMode === "shadow");
  const failed = (results ?? []).filter((result) => result.auditMode !== "shadow" && result.status !== "done");
  const timedOut = (results ?? []).filter((result) => result.auditMode !== "shadow" && result.timedOut);
  const executors = (results ?? []).filter((result) => ["executor", "architect"].includes(result.role));
  const missingDiff = allowWrite ? executors.filter((result) => !result.diffPath) : [];
  const partialWrites = (results ?? []).filter((result) => result.partialWrite === true);
  const conflictWrites = (results ?? []).filter((result) => result.worktreeState?.hasConflicts === true);
  const auditBlocks = (results ?? []).filter((result) => result.auditMode !== "shadow" && result.structured?.kind === "audit" && result.structured.verdict === "block");
  const auditParseErrors = (results ?? []).filter((result) => result.auditMode !== "shadow" && result.structured?.parseError);
  const lowQuota = (quota ?? []).filter((item) => item.quota?.window?.remainingPercent !== null && item.quota?.window?.remainingPercent !== undefined && item.quota.window.remainingPercent < 5);
  for (const result of failed) findings.push({ severity: "P1", type: "seat-failed", seat: result.seat, message: result.error || "seat failed" });
  for (const result of timedOut) findings.push({ severity: "P1", type: "seat-timeout", seat: result.seat, message: `timed out after ${result.durationMs}ms` });
  for (const result of missingDiff) findings.push({ severity: "P2", type: "missing-diff", seat: result.seat, message: "write-capable seat produced no captured diff" });
  for (const warning of auditWarnings) findings.push({ severity: "P2", type: "audit-heterogeneity", message: warning.message });
  for (const result of partialWrites) findings.push({ severity: "P1", type: "partial-write", seat: result.seat, message: `seat left changes after ${result.status}` });
  for (const result of conflictWrites) findings.push({ severity: "P0", type: "worktree-conflict-markers", seat: result.seat, message: "seat left conflict markers in its worktree" });
  for (const result of auditBlocks) findings.push({ severity: "P0", type: "audit-block", seat: result.seat, message: "auditor returned block" });
  for (const result of auditParseErrors) findings.push({ severity: "P2", type: "audit-parse-error", seat: result.seat, message: result.structured.parseError });
  for (const result of shadows.filter((item) => item.status !== "done")) findings.push({ severity: "P2", type: "shadow-audit-failed", seat: result.seat, message: result.error || "shadow audit failed; gating result is unaffected" });
  for (const result of shadows.filter((item) => item.structured?.verdict === "block")) findings.push({ severity: "P2", type: "shadow-audit-block", seat: result.seat, message: "shadow auditor returned block; captain adjudication is required" });
  for (const result of results ?? []) {
    if (result.auditMode === "shadow") continue;
    for (const finding of result.structured?.findings ?? []) {
      if (!["P0", "P1"].includes(finding.severity)) continue;
      findings.push({
        severity: finding.severity,
        type: "audit-finding",
        seat: result.seat,
        file: finding.file,
        line: finding.line,
        message: finding.claim,
        evidence: finding.evidence
      });
    }
  }
  for (const item of lowQuota) findings.push({ severity: "P2", type: "low-quota", model: item.model, message: `remaining quota ${item.quota.window.remainingPercent}%` });
  const verdict = findings.some((item) => item.severity === "P0") ? "block"
    : findings.some((item) => item.severity === "P1") ? "warn"
      : findings.length ? "warn" : "pass";
  return {
    verdict,
    level: plan?.level ?? null,
    findings,
    checks: {
      seatFailures: failed.length,
      timeouts: timedOut.length,
      missingDiffs: missingDiff.length,
      partialWrites: partialWrites.length,
      conflictWrites: conflictWrites.length,
      auditBlocks: auditBlocks.length,
      auditParseErrors: auditParseErrors.length,
      auditWarnings: auditWarnings.length,
      shadowAudits: shadows.length,
      shadowFailures: shadows.filter((result) => result.status !== "done").length,
      lowQuotaModels: lowQuota.length
    }
  };
}
