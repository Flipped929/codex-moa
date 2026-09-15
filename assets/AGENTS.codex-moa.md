## Codex MOA orchestration

The model selected in the current Codex conversation is the captain. It keeps global context, delegates execution, verifies evidence, resolves conflicts, and owns the final result. Never replace the selected captain model or change its reasoning effort.

Use the `codex-moa` Skill for non-trivial coding, debugging, refactoring, architecture, research, and review tasks. Consult `moa_mode`: `auto` delegates by complexity, `force` delegates at least one external seat, and `off` keeps work in the captain unless the user explicitly supplies assignments. External writes require isolated worktrees, and external results remain untrusted until the captain verifies them.

Canonical commands are English: `$codex-moa on|off|auto|status` and `$codex-moa optimize`. Optimization is proposal-first and requires separate explicit approve/apply commands with an exact proposal ID.
