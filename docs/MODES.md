# Orchestration Modes

The model selected in the active Codex conversation is always the captain. It may be an OpenAI model or a model from another provider. Codex MOA never changes that selection or its reasoning effort.

Codex MOA persists one logical mode in `~/.codex-moa/mode.json`:

- `off`: keep automatic work in the Codex captain. Explicit seat assignments still run.
- `auto`: keep L0 tasks in the captain and delegate L1-L3 tasks by complexity.
- `force`: delegate at least one external seat, including otherwise-simple tasks.

Use the canonical English Skill commands `$codex-moa on`, `$codex-moa off`, `$codex-moa auto`, and `$codex-moa status`. Translated aliases are intentionally unsupported. `$codex-moa <task>` forces delegation only for that task without changing the persisted mode.

Self-optimization uses `$codex-moa optimize`; see `docs/EVOLUTION.md` for the proposal-first approval flow.

`assets/AGENTS.codex-moa.md` is a project-level template. A user-level `~/.codex/AGENTS.md` can apply the same default across Codex workspaces.
