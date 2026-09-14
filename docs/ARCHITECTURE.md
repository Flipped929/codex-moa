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
```

## Codex responsibilities

- Define the TaskContract.
- Choose or approve the plan.
- Adjudicate conflicts.
- Verify evidence.
- Apply the final patch or write the final answer.

## External responsibilities

- KimiCode: architecture, long context, vision, second opinion.
- ZCode: primary coding execution and tests.
- DeepSeekHarness: independent audit and verification.

## CC Switch authority

CC Switch owns provider/model profiles and Skill enablement. Codex MOA reads this metadata through `moa_ccswitch` and maps canonical models to matching providers. It does not maintain a competing Skill or provider database.

## Model assignment

Codex may provide explicit `assignments`. Each assignment names one of five canonical models, and the MCP server maps it to the owning harness:

- KimiCode receives the model through `-m`.
- ZCode receives the model by synchronizing provider and `provider/model` into `~/.zcode/cli/config.json`.
- DeepSeekHarness uses `deepseek-flash` from its dedicated read-only profile.

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

## Write model

- `allowWrite` defaults to false.
- A writing seat must explicitly set `autoApprove`.
- Audit seats are always read-only.
- Codex remains the only final writer to the main workspace.
