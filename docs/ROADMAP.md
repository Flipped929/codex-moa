# Roadmap

## v0.2 Explicit model routing

- Five-model registry.
- `moa_models`.
- `moa_delegate`.
- Codex-selected model per sub-agent.
- KimiCode model flag enforcement.
- ZCode provider/model synchronization.
- DeepSeekHarness model enforcement through its audit profile.

## v0.3 Persistent sessions

- Kimi ACP adapter.
- DSH ACP adapter.
- ZCode app-server adapter.
- Session resume and cancellation. (implemented)
- Async job handles. (implemented)

## v0.4 Worktree orchestration

- Automatic git worktree creation.
- Per-seat diff capture.
- Cleanup policy. (implemented)
- Partial-write detection. (implemented)

## v0.5 Quality and cost control

- Seat scorecards.
- Patch acceptance metrics.
- Audit true-positive and false-positive rates.
- Budget enforcement. (implemented)
- Automatic time-window scheduling.

## v0.6 Resilience, experimentation, and observability

- Task DAG checkpoint/resume. (implemented)
- Real ACP smoke tests for all three harnesses. (implemented; external auth/provider failures are reported explicitly)
- Seat interrupt/cancel control plane and local dashboard. (implemented)
- Cost ledger, provider health, and ClaudeBar runtime status. (implemented)
- Deterministic routing A/B experiments with automatic rollback. (implemented)
- Structured SeatResult/AuditorFinding parsing. (implemented)
- Provider health-aware automatic routing. (implemented)
- Provider circuit breaker, latency/error classification, and recovery probes. (implemented)
- Retention/compaction for runtime stores. (implemented)
- Patch acceptance metrics. (implemented)
- Auditor block repair round with checkpoint round history. (implemented)
