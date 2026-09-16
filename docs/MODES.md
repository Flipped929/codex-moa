# Orchestration Modes

The model selected in the active Codex conversation is always the captain. It may be an OpenAI model or a model from another provider. Codex MOA never changes that selection or its reasoning effort.

Codex MOA persists one logical mode in `~/.codex-moa/mode.json`:

- `off`: keep automatic work in the Codex captain. Explicit seat assignments still run.
- `auto`: when the page captain is explicitly known to be GPT/OpenAI, delegate suitable L0 execution to one fast external seat while GPT retains planning, staged review, integration, and the final answer. Opaque or non-OpenAI captains keep L0 locally. L1 is normally external, L2 is hybrid, and L3 implementation is captain-primary.
- `force`: delegate at least one external seat, including otherwise-simple tasks. For L3, force adds external support or audit seats without transferring core ownership.

Execution ownership is independent from orchestration mode. `executionOwner="captain"` keeps critical work in the page conversation, `hybrid` allows bounded external implementation, and `external` transfers core execution only when the user explicitly requested that tradeoff. Quota and price signals never change an L3 captain-primary decision.

Use the canonical English Skill commands `$codex-moa on`, `$codex-moa off`, `$codex-moa auto`, and `$codex-moa status`. Translated aliases are intentionally unsupported. `$codex-moa <task>` forces delegation only for that task without changing the persisted mode.

Self-optimization uses `$codex-moa optimize`; see `docs/EVOLUTION.md` for the proposal-first approval flow.

`assets/AGENTS.codex-moa.md` is a project-level template. A user-level `~/.codex/AGENTS.md` can apply the same default across Codex workspaces.
