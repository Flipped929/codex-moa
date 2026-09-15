# Context and Output Limits

Model capability and runtime budget are separate settings.

## Capability registry

| Model | Context window | Max output | Balanced context | Balanced output |
|---|---:|---:|---:|---:|
| Kimi K3 | 1,048,576 | 131,072 | 262,144 | 16,384 |
| Kimi K2.8 Preview | 1,048,576 | 131,072 | 262,144 | 16,384 |
| GLM-5.3 | 1,000,000 | 128,000 | 262,144 | 32,768 |
| GLM-5.3-flash | 1,000,000 | 128,000 | 131,072 | 16,384 |
| DeepSeek-flash | 1,000,000 | 384,000 | 262,144 | 32,768 |

## Balanced task policy

- L1: about 25% of context, 8K output
- L2: about 50% of context, 32K output
- L3: about 75% of context, up to 64K output
- Audit/review: 8K output, or 16K for high stakes
- Auditor limits are never reduced for quota pressure

## Is maximum capability always better?

No. Full context and output are maximum capabilities, not defaults.

Using maximum values by default can cause:

- Higher cost and slower responses
- More attention dilution from irrelevant context
- Quota burn and rate-limit pressure
- Longer, less focused reasoning
- Truncation or timeouts when combined with tool loops

Use `limitMode="max"` only for tasks that genuinely require it.

## Explicit budgets

Assignments can specify:

```json
{
  "model": "GLM-5.3",
  "contextBudget": 262144,
  "outputBudget": 32768,
  "limitMode": "balanced"
}
```

Or request full capability:

```json
{
  "model": "DeepSeek-flash",
  "limitMode": "max"
}
```

## Task budget enforcement

Runtime capability limits are not spending budgets. Codex MOA also supports task budgets:

```json
{
  "budget": {
    "enforce": true,
    "maxTokens": 2000000,
    "maxEstimatedUsd": 20,
    "maxDurationMs": 3600000,
    "maxContextUsed": 500000
  }
}
```

Checks run before each DAG layer and repair round. Unstarted nodes are blocked when a limit is exceeded.

## Enforcement

- KimiCode: `KIMI_MODEL_MAX_CONTEXT_SIZE`, `KIMI_MODEL_MAX_OUTPUT_SIZE`, `KIMI_MODEL_MAX_COMPLETION_TOKENS`
- ZCode: model `limit.context` and `limit.output` in CLI config
- DSH: model `maxTokens` in the isolated DSH home settings

## CC Switch metadata

The provider metadata patch also fills known `contextWindow` and `maxTokens` gaps in CC Switch provider entries:

```bash
npm run ccswitch:patch-metadata:write
npm run ccswitch:limits
```

This changes missing capability metadata only; existing values are preserved. It never changes transport metadata. Runtime uses the balanced budget unless `limitMode="max"` is requested.
