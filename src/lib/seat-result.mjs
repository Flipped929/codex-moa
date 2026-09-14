const SEVERITIES = new Set(["P0", "P1", "P2"]);

function findBalancedJsonObject(text) {
  const source = String(text ?? "");
  const start = source.indexOf("{");
  if (start < 0) return null;
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let index = start; index < source.length; index += 1) {
    const char = source[index];
    if (inString) {
      if (escaped) escaped = false;
      else if (char === "\\") escaped = true;
      else if (char === '"') inString = false;
      continue;
    }
    if (char === '"') {
      inString = true;
      continue;
    }
    if (char === "{") depth += 1;
    else if (char === "}") {
      depth -= 1;
      if (depth === 0) {
        const candidate = source.slice(start, index + 1);
        try {
          const parsed = JSON.parse(candidate);
          return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : null;
        } catch {
          return null;
        }
      }
    }
  }
  return null;
}

export function extractJsonObject(text) {
  const source = String(text ?? "").trim();
  if (!source) return null;
  if (source.startsWith("{") || source.startsWith("```")) {
    const fenced = source.match(/```(?:json)?\s*([\s\S]*?)```/i);
    const candidate = fenced?.[1]?.trim() ?? source;
    try {
      const parsed = JSON.parse(candidate);
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) return parsed;
    } catch {}
  }
  return findBalancedJsonObject(source);
}

function asArray(value) {
  return Array.isArray(value) ? value : [];
}

function normalizeFinding(finding, index) {
  const source = finding && typeof finding === "object" ? finding : { claim: String(finding ?? "") };
  const severity = SEVERITIES.has(String(source.severity ?? "").toUpperCase()) ? String(source.severity).toUpperCase() : "P2";
  return {
    id: source.id ?? `finding-${index + 1}`,
    severity,
    file: source.file ?? null,
    line: Number.isFinite(Number(source.line)) ? Number(source.line) : null,
    claim: String(source.claim ?? source.message ?? "").trim(),
    evidence: String(source.evidence ?? "").trim(),
    recommendation: String(source.recommendation ?? "").trim(),
    confidence: Number.isFinite(Number(source.confidence)) ? Number(source.confidence) : null
  };
}

export function parseAuditResult(text) {
  const parsed = extractJsonObject(text);
  if (!parsed) {
    return {
      kind: "audit",
      verdict: null,
      findings: [],
      missingEvidence: [],
      verifiedCommands: [],
      parseError: text ? "Auditor response did not contain a valid JSON object" : "Auditor response was empty"
    };
  }
  const verdict = ["pass", "warn", "block"].includes(String(parsed.verdict ?? "").toLowerCase())
    ? String(parsed.verdict).toLowerCase()
    : null;
  return {
    kind: "audit",
    verdict,
    findings: asArray(parsed.findings).map(normalizeFinding),
    missingEvidence: asArray(parsed.missing_evidence ?? parsed.missingEvidence).map(String),
    verifiedCommands: asArray(parsed.verified_commands ?? parsed.verifiedCommands).map(String),
    parseError: verdict ? null : "Auditor JSON is missing a valid verdict (pass|warn|block)"
  };
}

export function parseExecutionResult(text, fallback = {}) {
  const parsed = extractJsonObject(text);
  if (!parsed) {
    return {
      kind: "execution",
      status: fallback.status ?? null,
      summary: String(text ?? "").trim(),
      claims: [],
      tests: [],
      blockers: [],
      uncertainty: [],
      parseError: text ? "Execution response did not contain a valid JSON object" : "Execution response was empty"
    };
  }
  return {
    kind: "execution",
    status: String(parsed.status ?? fallback.status ?? "").trim() || null,
    summary: String(parsed.summary ?? "").trim(),
    claims: asArray(parsed.claims),
    tests: asArray(parsed.tests),
    blockers: asArray(parsed.blockers).map(String),
    uncertainty: asArray(parsed.uncertainty ?? parsed.uncertainties).map(String),
    parseError: null
  };
}

export function normalizeSeatResult(result, seat) {
  return seat.role === "auditor" ? parseAuditResult(result.summary) : parseExecutionResult(result.summary, result);
}

export function hasBlockingAudit(results) {
  return results.some((result) => result.structured?.kind === "audit" && result.structured.verdict === "block");
}

export function buildRepairContext(results) {
  const lines = [];
  for (const result of results) {
    if (result.structured?.kind !== "audit") continue;
    if (result.structured.verdict === "block") {
      lines.push(`Auditor ${result.seat} returned block.`);
    }
    for (const finding of result.structured.findings ?? []) {
      if (!["P0", "P1"].includes(finding.severity)) continue;
      lines.push(`- ${finding.severity} ${finding.file ?? "unknown"}${finding.line ? `:${finding.line}` : ""}: ${finding.claim}`);
      if (finding.evidence) lines.push(`  Evidence: ${finding.evidence}`);
      if (finding.recommendation) lines.push(`  Required action: ${finding.recommendation}`);
    }
    if (result.structured.parseError) lines.push(`- Auditor ${result.seat}: ${result.structured.parseError}`);
  }
  return lines.join("\n");
}
