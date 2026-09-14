# Codex Captain Model

Codex main model selection is authoritative. `codex-moa` never changes the main Codex model, provider, or session.

## Resolution order

The captain model is resolved in this order:

1. Explicit `captainModel` passed to an MCP tool.
2. `CODEX_MOA_CAPTAIN_MODEL` environment variable.
3. `model = "..."` from `~/.codex/config.toml`.
4. The current Codex provider/model metadata read from CC Switch.
5. `codex-selected` fallback.

MCP stdio does not receive the current Codex session model by default, so explicit input is the most reliable option.

## Usage

Inspect the resolved captain:

```text
moa_captain()
```

Or pass it explicitly:

```text
moa_plan(task="...", captainModel="DeepSeek-flash")
moa_delegate(task="...", cwd="/repo", captainModel="DeepSeek-flash", assignments=[...])
```

## Heterogeneity warning

If an audit seat uses the same model family as the captain, `codex-moa` returns an `auditWarnings` entry. Set `strictHeterogeneousAudit=true` to turn that warning into a blocking error.

Example: a DeepSeek captain plus a DeepSeek auditor is not a true cross-family audit. Prefer GLM or Kimi as the auditor in that case.

## Guarantee

- Codex remains the captain and final writer.
- `codex-moa` only selects external sub-agents.
- Captain model mismatches produce warnings, never silent model switching.
