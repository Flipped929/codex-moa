# Reasoning Effort Policy

Reasoning effort is selected per sub-agent and applied through each harness. Codex main-model reasoning remains controlled by Codex and CC Switch.

## Canonical levels

```text
off < low < medium < high < xhigh < max
```

Provider mappings:

| Model | Supported | Default | Enforcement |
|---|---|---|---|
| Kimi K3 | low, high, max | high | Pi `--thinking`; Claude `--effort`; Codex config override |
| Kimi K2.8 Preview | low, high, max | max | Pi `--thinking`; Claude `--effort`; Codex config override |
| GLM-5.3 | high, max | max | Pi `--thinking`; Claude `--effort`; Codex config override |
| GLM-5.3-flash | high, max | max | Pi `--thinking`; Claude `--effort`; Codex config override |
| DeepSeek-flash | off, low, high, max | high | DSH by default; explicit Pi/Claude/Codex route |

Kimi Code defaults K3 to `high` and K2.8 Preview to `max`; both expose `low/high/max`. GLM-5.3 and GLM-5.3-Flash force thinking: `low/medium` map to `high`, and `xhigh` maps to `max`, so only `high/max` are distinct effective levels. DeepSeek V4.1 Flash defaults to `high`, recommends `low` for simple work, `high` for daily Agent work, and `max` for complex work; it also supports non-thinking mode.

Provider cards are independent. The effective-model overlay selects one matching CC Switch card and never unions reasoning levels across multiple cards.

### Source of truth (2026-09-15 用户裁决)

For a Pi route, an explicit CC Switch `thinkingLevelMap` is authoritative. When the
card enables reasoning but leaves that map empty, codex-moa uses the versioned vendor
profile in `config/models.json`; this avoids incorrectly collapsing every model to
`high`. DSH keeps its own independent profile. An explicit user effort always wins,
then task/vendor policy, then the provider default.

- Effective table: `src/lib/effective-models.mjs` (`loadEffectiveModels()`), consumed
  by the router, orchestrator, and captain resolution.
- Provenance: the returned table carries `reasoningSources[modelId] = "cc-switch" | "cc-switch+vendor" | "local"`,
  and each routed seat records `seat.reasoningSource`.
- Escape hatch: `CODEX_MOA_NO_CCSWITCH=1` skips the overlay (offline/tests).
- The table in this document lists the local fallback values; CC Switch may declare a
  different set, in which case CC Switch wins.

Unsupported levels are mapped to the nearest supported level. Ties above `high` prefer the stronger level; ties below `high` prefer the cheaper level.

## Automatic selection

Defaults live in `config/evolution.json` and can be evolved after approval:

- `reasoning.mode="task-aware"`: select by model profile, task level, role, and stakes
- `reasoning.mode="provider-default"`: omit the effort flag and leave selection to the Harness/provider
- L0: low (GLM maps to high)
- L1: low
- L2: high
- L3: max
- Auditor/reviewer: high, or max for high stakes
- Architect: high, or max for L3
- Vision: high
- Low quota downgrades non-audit roles by one level

## Explicit assignment

```json
{
  "model": "GLM-5.3",
  "role": "executor",
  "reasoningEffort": "max"
}
```

Explicit values are normalized to a real effective level and the requested/effective pair is recorded.

If omitted, Codex MOA chooses from task level, role, stakes, quota, and the current evolution policy.

## CC Switch completeness audit

Run:

```bash
npm run ccswitch:reasoning
```

The audit compares Codex MOA's known capability map with the reasoning levels stored in CC Switch.

Metadata gaps are reported only. Edit provider cards in CC Switch; codex-moa never writes its database.

## Persist the Codex main-model effort

CC Switch writes the live Codex config from the provider card. Changing the reasoning level only inside Codex can therefore be reverted on the next provider switch.

Audit both locations through the read-only command:

```bash
npm run ccswitch:set-codex-effort -- --provider DeepSeek --effort max
```

Supported values: `none`, `low`, `medium`, `high`, `xhigh`, `max`. This command is an audit only; change the value in CC Switch.

## MCP integration

- `moa_models` returns model reasoning capabilities and the CC Switch gap audit.
- `moa_plan` returns selected `reasoningEffort` and rationale for every seat.
- `moa_run` and `moa_delegate` accept `reasoningEffort` per assignment.
- Results record requested/effective effort, source, model, and Harness route.

## Codex main model

Codex MOA does not change the Codex main model's reasoning level. The user's Codex/CC Switch selection remains authoritative.
