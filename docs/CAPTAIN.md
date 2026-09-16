# Codex Captain Model

Codex main model selection is authoritative. `codex-moa` never changes the main Codex model, provider, or session.

## Resolution order

The captain identity is resolved in this order:

1. Explicit `captainModel` passed to an MCP tool.
2. `codex-selected`, meaning the active Codex thread remains captain but its exact
   page-level model is intentionally opaque to the MCP server.

The global `~/.codex/config.toml`, environment variables, and CC Switch provider
cards are not used to guess the captain model. They can differ from the model
selected for the active Codex thread. CC Switch is still read to report the active
provider, but provider metadata is not treated as proof of the page-level model.

MCP stdio does not receive the current Codex session model by default, so explicit input is the most reliable option.

When the captain is explicitly confirmed as GPT/OpenAI and mode is `auto`, routine L0 execution is delegated to a fast external seat. This preserves GPT capacity for the parts where its higher capability matters: task contracts, staged evidence review, adjudication, integration, and the final answer. An opaque captain is never guessed from CC Switch or global configuration.

For L3 implementation, the page-selected captain is also the primary executor. It owns architecture, critical implementation, integration, and repair. External seats are support-only unless `executionOwner="hybrid"` scopes a bounded module or the user explicitly requests `executionOwner="external"`. GPT quota may affect support volume, never core ownership. When a known non-GPT page captain receives an L3 task, Codex MOA recommends switching the page model to GPT but never changes it automatically.

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
