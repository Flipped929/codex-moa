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
| Kimi 2.8 | high | high | `KIMI_MODEL_THINKING_EFFORT` |
| GLM-5.3 | low, high, max | max | ZCode `thoughtLevel` and model `reasoning.defaultVariant` |
| GLM-5.3-flash | low, high, max | max | ZCode `thoughtLevel` and model `reasoning.defaultVariant` |
| DeepSeek-flash | off, low, high, max | high | isolated DSH home `settings.yaml` |

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

On 2026-09-15 the missing metadata was patched through:

```bash
npm run ccswitch:patch-metadata
npm run ccswitch:patch-metadata:write
```

Before patching, the database is automatically backed up under `~/.codex-moa/backups/cc-switch/`.

## MCP integration

- `moa_models` returns model reasoning capabilities and the CC Switch gap audit.
- `moa_plan` returns selected `reasoningEffort` and rationale for every seat.
- `moa_run` and `moa_delegate` accept `reasoningEffort` per assignment.
- Results record the selected effort and enforcement channel.

## Codex main model

Codex MOA does not change the Codex main model's reasoning level. The user's Codex/CC Switch selection remains authoritative.
