# Continuity

Continuity means the same seat, model, and workspace should keep a real session context across related tasks.

## Usage

Pass a stable key:

```text
moa_delegate(
  task="Continue the parser refactor",
  cwd="/repo",
  continuityKey="parser-refactor",
  assignments=[
    {"model": "GLM-5.3", "role": "executor"}
  ]
)
```

Per-seat keys can override the run-level key.

## Store

```text
~/.codex-moa/continuity.json
```

Each entry records:

- continuity key
- seat
- harness
- model
- workspace
- session id
- update time

## Model safety

A continuity key is bound to one model. If a later request uses a different model, codex-moa refuses to resume the old session by default:

```text
Continuity key ... is bound to model ...; requested ...
```

Use `allowContinuityModelSwitch=true` only when intentionally resetting the context.

## Harness support

| Harness | Continuity |
|---|---|
| KimiCode | `--session <id>` resume |
| ZCode | CLI `--resume <sess_...>` plus app-server `session/resume` |
| DSH | ACP `session/resume` with persisted profile/home fallback |

## Why same process/context matters

- preserves earlier decisions and terminology
- avoids repeated repository exploration
- improves multi-step reasoning and repair loops
- reduces duplicate token consumption
- keeps the same model's reasoning trajectory coherent

Continuity should be reused for related multi-turn work, not across unrelated tasks or risky model changes.
