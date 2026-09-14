# Durable Task Memory

Codex thread history and compaction preserve the active conversation, but context compression can still lose operational details. Codex MOA therefore keeps a separate memory capsule outside the model context.

## Store

```text
~/.codex-moa/memory/<hash>.json
```

Memory is keyed by `memoryKey` and workspace. If `memoryKey` is omitted, `continuityKey` is used.

## What is remembered

- decisions and rationale
- verified facts
- files and change status
- test commands and outcomes
- failed attempts
- open questions
- completed episodes with seats/models
- linked continuity session information

## MCP tools

Load a compact memory pack:

```text
moa_memory(action="load", memoryKey="parser-refactor", cwd="/repo")
```

Record a decision:

```text
moa_memory(
  action="remember",
  memoryKey="parser-refactor",
  kind="decision",
  text="Keep the public API stable"
)
```

Record a failed attempt:

```text
moa_memory(
  action="remember",
  memoryKey="parser-refactor",
  kind="failed_attempt",
  text="Rewrite parser internals",
  evidence="broke compatibility tests"
)
```

List memories:

```text
moa_memory(action="list")
```

## Automatic use

When `moa_run` or `moa_delegate` receives `memoryKey` or `continuityKey`:

1. Codex MOA loads the memory pack.
2. It injects a clearly marked prior-memory section into sub-agent prompts.
3. Sub-agents are told the memory may be stale and must verify against the workspace.
4. A new episode is appended after the run.

## Relationship to Codex sessions

- Codex session/thread: active conversation and compaction history.
- `continuityKey`: same sub-agent/model/workspace session resume.
- Memory Capsule: durable structured task facts independent of context compression.

The three layers complement each other.
