# Reasoning Effort Policy

Reasoning effort is selected per sub-agent and applied through each harness. Codex main-model reasoning remains controlled by Codex and CC Switch.

## Canonical levels

```text
off < low < medium < high < xhigh < max
```

Provider mappings:

| Model | Supported | Default | Enforcement |
|---|---|---|---|
| Kimi K3 | low, high, max | high | `KIMI_MODEL_THINKING_EFFORT` |
| Kimi K2.8 Preview | low, high, max | max | `KIMI_MODEL_THINKING_EFFORT` |
| GLM-5.3 | low, high, max | max | ZCode `thoughtLevel` and model `reasoning.defaultVariant` |
| GLM-5.3-flash | low, high, max | max | ZCode `thoughtLevel` and model `reasoning.defaultVariant` |
| DeepSeek-flash | off, low, high, max | high | isolated DSH home `settings.yaml` |

Kimi Code currently defaults K3 to `high` and K2.8 Preview to `max`; neither exposes a non-thinking mode. GLM-5.3 and GLM-5.3-Flash default to `max` and expose `low/high/max`. DeepSeek V4.1 Flash defaults to thinking `high` and also supports non-thinking mode.

Provider cards are independent. The effective-model overlay selects one matching CC Switch card and never unions reasoning levels across multiple cards.

### Source of truth (2026-09-15 用户裁决)

CC Switch is the single source of truth for both the selectable level set and the
per-model default. Every model managed by CC Switch takes `reasoning.supported` /
`reasoning.default` from the CC Switch provider cards (codex cards use the model
catalog's `reasoningLevels` / `defaultReasoningLevel`; pi cards use
`thinkingLevelMap` keys). `config/models.json` is the fallback and is used only for
models CC Switch does not manage, when CC Switch is unavailable, or when its card
declares no levels at all.

- Effective table: `src/lib/effective-models.mjs` (`loadEffectiveModels()`), consumed
  by the router, orchestrator, and captain resolution.
- Provenance: the returned table carries `reasoningSources[modelId] = "cc-switch" | "local"`,
  and each routed seat records `seat.reasoningSource`.
- Escape hatch: `CODEX_MOA_NO_CCSWITCH=1` skips the overlay (offline/tests).
- The table in this document lists the local fallback values; CC Switch may declare a
  different set, in which case CC Switch wins.

Unsupported levels are mapped to the nearest supported level. Ties above `high` prefer the stronger level; ties below `high` prefer the cheaper level.

## Automatic selection

Defaults live in `config/evolution.json` and can be evolved after approval:

- L0: off
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

Explicit values are never silently downgraded.

If omitted, Codex MOA chooses from task level, role, stakes, quota, and the current evolution policy.

## CC Switch completeness audit

Run:

```bash
npm run ccswitch:reasoning
```

The audit compares Codex MOA's known capability map with the reasoning levels stored in CC Switch.

Missing metadata can be filled through:

```bash
npm run ccswitch:patch-metadata
npm run ccswitch:patch-metadata:write
```

The patch only fills gaps. Existing provider levels and defaults are preserved, including vendor-specific or user-selected values. It never changes transport metadata.

Before patching, the database is automatically backed up under `~/.codex-moa/backups/cc-switch/`.

## Persist the Codex main-model effort

CC Switch writes the live Codex config from the provider card. Changing the reasoning level only inside Codex can therefore be reverted on the next provider switch.

Update both locations through the explicit command:

```bash
npm run ccswitch:set-codex-effort -- --provider DeepSeek --effort max
npm run ccswitch:set-codex-effort -- --provider DeepSeek --effort max --write
```

Supported values: `none`, `low`, `medium`, `high`, `xhigh`, `max`. The write path backs up both the CC Switch database and `~/.codex/config.toml`.

## MCP integration

- `moa_models` returns model reasoning capabilities and the CC Switch gap audit.
- `moa_plan` returns selected `reasoningEffort` and rationale for every seat.
- `moa_run` and `moa_delegate` accept `reasoningEffort` per assignment.
- Results record the selected effort and enforcement channel.

## Codex main model

Codex MOA does not change the Codex main model's reasoning level. The user's Codex/CC Switch selection remains authoritative.
