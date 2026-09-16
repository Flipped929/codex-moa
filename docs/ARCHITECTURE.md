# Architecture

```text
Codex captain
  |
  +-- codex-moa MCP server
        +-- router / policy
        +-- scheduler
        +-- blackboard
        +-- adapters
              +-- KimiCode
              +-- ZCode
              +-- DeepSeekHarness
              +-- Pi
              +-- Claude Code
              +-- Codex CLI
```

## Codex responsibilities

- Define the TaskContract.
- Choose or approve the plan.
- Adjudicate conflicts.
- Verify evidence.
- Apply the final patch or write the final answer.

## External responsibilities

- Pi: default Kimi/GLM execution and optional DeepSeek route.
- Claude Code: explicit secondary CC Switch-managed execution route.
- Codex CLI: explicit Responses-compatible route; third-party routes require a passing probe.
- KimiCode: native Kimi compatibility fallback.
- ZCode: native GLM compatibility fallback.
- DeepSeekHarness: independent audit and verification.

Automatic L2/L3 plans form an audit fan-out after execution. A complementary GLM/Kimi subscription auditor is the gate; a sampled DeepSeek auditor is a non-gating shadow. Both run in the same DAG layer. High-risk L3 tasks always include both. DeepSeek Harness selection is a deterministic, reversible experiment across Codex CLI, Pi, and DSH.

## CC Switch authority

CC Switch owns provider/model profiles and Skill enablement. Codex MOA reads this metadata through `moa_ccswitch` and maps canonical models to matching providers. It does not maintain a competing Skill or provider database.

## Model assignment

Codex may provide explicit `assignments`. Each assignment names one of five canonical models, and the MCP server maps it to the owning harness:

- KimiCode receives the model through `-m`.
- ZCode receives the model by synchronizing provider and `provider/model` into `~/.zcode/cli/config.json`.
- DeepSeekHarness uses `deepseek-flash` from its dedicated read-only profile.
- Pi receives an exact CC Switch provider/model pair through an isolated Pi home.
- Claude Code receives a private CC Switch settings file plus explicit `--model` and `--effort`.
- Codex CLI receives a private `CODEX_HOME`, normalized model catalog, explicit model, and sandbox.

## Trust model

External agents are untrusted workers. Their output is input to Codex, not authority.

## Storage

Each run creates:

```text
~/.codex-moa/blackboard/<task-id>/
  manifest.json
  events.jsonl
  results.json
  results/
  artifacts/
  logs/
  checkpoint.json
  navigator.json
```

Global runtime stores include the seat registry, continuity sessions, memory capsules, cost ledger, routing-experiment state, control requests, and async jobs. Versioned JSON stores use lock files and atomic rename; registry/control/routing/continuity mutations are read-modify-write safe.

Audit pairing and adjudication telemetry is stored separately in `~/.codex-moa/audit-metrics.jsonl` so transport completion, audit verdict, useful findings, false positives, cost, TPS, and critical-path contribution are not conflated with provider health.

## Write model

- `allowWrite` defaults to false.
- A writing seat must explicitly set `autoApprove`.
- Audit seats are always read-only.
- Codex remains the only final writer to the main workspace.
