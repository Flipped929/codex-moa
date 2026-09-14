# Audit Contract

DeepSeekHarness audit output must use this JSON shape:

```json
{
  "verdict": "pass | warn | block",
  "findings": [
    {
      "severity": "P0 | P1 | P2",
      "file": "src/example.ts",
      "line": 42,
      "claim": "short description",
      "evidence": "file, line, command, or observed output",
      "recommendation": "specific action",
      "confidence": 0.0
    }
  ],
  "missing_evidence": [],
  "verified_commands": []
}
```

Rules:

1. A finding without evidence is not a finding.
2. Missing evidence belongs in `missing_evidence`.
3. `block` is allowed only for a verified P0 or P1 issue.
4. Model confidence does not replace tests or reproducible evidence.
5. Codex must independently verify the cited evidence before acting.
