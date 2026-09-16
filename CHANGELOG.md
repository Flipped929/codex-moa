# Changelog

## 0.23.1

- Add a protocol-neutral persistent runtime contract across KimiCode, DeepSeekHarness, ZCode, Pi, Claude Code, and Codex CLI while retaining `runtime="acp"` as a compatibility alias.
- Bridge Pi through JSONL RPC and Claude Code/Codex CLI through cancellable session-resume adapters, fixing Pi jobs that previously failed with `No ACP command configured for harness: pi`.
- Preflight explicit persistent Harness assignments before creating background jobs so unsupported configurations fail before a misleading queued job is recorded.
- Report each seat's resolved runtime mode, transport, job-level control boundary, and native protocol steering support without claiming that every Harness speaks ACP on the wire.
- Extend cancellation, capability probes, documentation, and regression coverage for the unified persistent runtime.

## 0.23.0

- Make the page-selected captain the primary executor for L3 implementation: it owns architecture, critical implementation, integration, and repair while external seats provide bounded architecture, research, testing, benchmarking, and audit support.
- Add explicit `executionOwner=auto|captain|hybrid|external` routing. L3 defaults to `captain`; external core execution is rejected before any Harness starts unless `hybrid` or `external` was deliberately selected.
- Keep GPT quota, provider balance, price, TPS, and completion evidence as support-routing signals without allowing them to transfer L3 core ownership.
- Recommend a GPT page captain for L3 when the selected model is known to be non-GPT, without silently changing the page model or its reasoning effort.
- Preserve compatibility with already-open sessions: the Skill avoids new MCP arguments against older servers, and compatible installation retains every prior plugin cache directory.

## 0.22.2

- Bind background jobs to the originating Codex thread and deliver terminal-state continuation prompts through the official `codex queue` interface.
- Persist notification delivery attempts separately from captain acknowledgement, with explicit retry and acknowledgement tools.
- Preserve prior plugin cache directories during local reinstalls so already-open sessions do not lose their MCP config and worker resources.

## 0.22.1

- Delegate suitable L0 execution when the page captain is explicitly confirmed as GPT/OpenAI, while keeping GPT responsible for planning, staged evidence review, adjudication, integration, and the final answer.
- Preserve opaque and non-OpenAI captain behavior, and never infer the page model from the global CC Switch provider card.
- Persist DAG-layer stage reviews and captain judgments, then compare execution routes within the same complexity level using completion, acceptance, tests, and quality before cost, latency, and TPS.
- Add a redacted model/Harness failure-memory ledger. Deterministic failures activate an immediate guard, repeated transient failures activate a temporary guard, and automatic routing changes route instead of repeating an active failure.
- Record successful route recovery to clear active guards without deleting failure history; expose failure memory through health, evolution, artifacts, and retention.

## 0.22.0

- Pair GLM execution with a Kimi subscription gate and Kimi execution with a GLM subscription gate; reconcile the pair after health-based rerouting so the blocking audit remains cross-family.
- Add a parallel, non-blocking DeepSeek shadow audit sampled at 25% during peak L2 work, 40% off-peak L2 work, and 100% for L3 work.
- Compare DeepSeek audit Harnesses through a deterministic Codex/Pi/DeepSeekHarness experiment while keeping failures out of task gating, provider circuits, repair rounds, and routing health.
- Record executor-auditor pairs, Harness, completion, latency, output TPS, cost, accepted findings, false positives, and critical-path contribution in a private audit ledger.
- Add `moa_audit_metrics` for status and captain adjudication; feed the evidence into proposal-first self-optimization without automatically changing policy.
- Add audit-ledger retention and regression coverage for parallel audit layers, shadow failure isolation, and post-reroute cross-family reconciliation.

## 0.21.0

- Fix third-party Codex CLI authentication by projecting each CC Switch card into an isolated provider `env_key` instead of relying on OpenAI `auth.json` semantics.
- Strip unrelated desktop, marketplace, plugin, and project tables from isolated Codex homes.
- Add GPT captain quota snapshots and dynamic delegation targets while keeping the page-selected model in control.
- Record route/provider completion rates and observed output TPS; gate all performance preferences on sample size and completion quality.
- Feed TPS and task completion evidence into proposal-first self-optimization analysis.

## Unreleased

- Add CC Switch-managed Claude Code and Codex CLI as explicit, isolated sub-agent Harnesses; Pi remains the automatic default for Kimi/GLM and DeepSeekHarness remains the default independent DeepSeek audit path.
- Add private per-provider Claude settings and Codex homes, including Codex catalog normalization and explicit Skill projection, so concurrent seats never switch the global CC Switch card.
- Add `moa_capabilities` and `npm run ccswitch:capabilities` for declared capability inventory plus bounded read-only text/tool and image probes.
- Add detect-only CLI lifecycle governance: doctor reports installed/minimum/latest versions and upgrade actions, but never upgrades a CLI automatically.
- Record DeepSeek Flash's documented 384K output ceiling as 393,216 tokens.
- Validate all five models through Pi and Claude Code text/tool probes; validate Pi image input for Kimi K3, GLM-5.3-Flash, and DeepSeek Flash.
- Keep Codex CLI third-party routes explicit-only after live probes found invalid Kimi/DeepSeek credentials and an incomplete GLM Responses stream in the current CC Switch cards.

- Add an explicit Pi Harness route for DeepSeek V4.1 Flash through the CC Switch `deepseek/deepseek-flash` provider while keeping DeepSeekHarness as the independent default route.
- Add task-aware, vendor-profiled reasoning selection with a provider-default escape hatch, effective-capability clamping, and reasoning-aware self-optimization metrics and proposal validation.
- Make CC Switch the runtime source of truth for Kimi/GLM Pi credentials, provider/model IDs, context/output limits, reasoning/extended-thinking metadata, and image input by projecting its `app_type=pi` cards into a private Pi home before every run; keep DeepSeekHarness independent.
- Bind Pi-routed models to their exact configured CC Switch provider card instead of allowing an unrelated same-name Codex card to win metadata selection.
- Add Pi as a first-class CLI Harness for Kimi Coding and Z.ai Coding Plan models, with provider/model selection, read-only tool enforcement, continuity IDs, and explicit reasoning flags.
- Fix Kimi prompt-mode failures by no longer combining the incompatible `--prompt` and `--plan` flags.
- Add an allowlisted Skill broker that resolves explicitly requested CC Switch/Pi/Codex Skill paths and passes them to Pi or Kimi without loading the full catalog.
- Balance Kimi and GLM subscriptions by weekly remaining-percentage gap, prefer Pi→Kimi while Kimi is underused, and preserve ZCode during the GLM night campaign.
- Track reliability separately for each `model@harness` route so a failing Kimi CLI route does not condemn Pi→Kimi.
- Add an interaction-safe background handoff contract: `moa_start`, job status/wait, and steering now tell the captain to yield while a job is active, cap each wait at ten seconds, and explicitly distinguish queue-risk mitigation from an App-level queue fix.
- Require the captain to stop repeated polling and substantial local work after background dispatch, preserving mid-run control through durable job steering.
- Make the ClaudeBar extension self-contained so a fresh installation can find its probe without a manually configured project root.
- Prevent long synchronous MCP calls from monopolizing a Codex turn: write-enabled, ACP, remote, benchmark, multi-stage, and over-60-second work must use `moa_start`.
- Add durable `moa_job_steer`, `moa_job_pause`, and `moa_job_resume` controls with checkpoint-safe delivery and ten-second maximum waits.
- Allow Kimi K3/K2.8 and GLM 5.3/5.3 Flash to run through DeepSeekHarness while retaining KimiCode/ZCode as their native defaults.
- Route non-urgent DeepSeekHarness audits to Kimi/GLM during DeepSeek peak pricing, while preserving DeepSeek for high-stakes independent audits.
- Track DeepSeek V4.1 Flash peak/off-peak cache-hit, cache-miss, and output prices; treat zero currency balance as depleted.
- Document explicit per-model task roles and quota/price routing rules.
- Standardize all `$codex-moa` control words on English-only commands.
- Add `$codex-moa optimize` plus exact-ID approve, reject, apply, and rollback commands.
- Expose gated evolution mutations through MCP only for exact user-authored confirmation commands.
- Deduplicate active self-optimization proposals by stable policy-patch fingerprint.
- Add seat/model reliability rates with a three-run minimum-evidence marker.
- Carry forward `pi-moa`'s proposal-first governance and `dsh-moa`'s capability-aware graceful-degradation principles without copying their runtime-specific implementations.

- Added persistent `off` / `auto` / `force` orchestration mode and the `moa_mode` MCP tool.
- Kept the active Codex conversation model as captain without restricting it to GPT.
- Added `kimi-k2.8` alias and corrected Kimi K2.8 reasoning levels/default.
- Stopped merging reasoning levels across independent CC Switch provider cards.
- Required isolated managed worktrees for external writes and constrained worktree removal.
- Redacted MCP result objects, filtered child-process secrets, allowlisted background-worker environment variables, and hardened the local dashboard against XSS/CSRF and remote binding.

## 0.19.2

- Hands-off reasoning (user ruling 2026-09-15): codex-moa no longer auto-specifies thinking levels. Task-policy effort derivation (`effortForTask`) and role `reasoningEffort` defaults were removed from seat planning; DSH home prep no longer falls back to `high` and leaves the source `settings.yaml` untouched unless an effort is explicitly requested. Explicit `input.reasoningEffort` / per-assignment `reasoningEffort` still work and are marked `reasoningSource: "explicit"`; everything else runs with `reasoningSource: "model-default"`.

## 0.19.1

- Made codex-moa strictly read-only against CC Switch (user ruling 2026-09-15): provider-card writes, codex catalog writes, live `config.toml` writes, and skill linking now throw via `assertCcSwitchReadOnly()`. The `:write` npm scripts were removed; `ccswitch:patch-reasoning` and `ccswitch:codex-effort` are read-only audits.
- Made CC Switch the single source of truth for reasoning levels: the router, orchestrator, and captain now resolve per-model supported levels and defaults from CC Switch provider cards (`reasoningLevels`/`defaultReasoningLevel`/`thinkingLevelMap`), with `config/models.json` used only as fallback for unmanaged models.
- Added `reasoningSources[modelId]` and `seat.reasoningSource` provenance, plus `CODEX_MOA_NO_CCSWITCH=1` to skip the overlay.
- Fixed the CC Switch metadata patch to fill only missing reasoning and limit fields.
- Preserved provider-supplied reasoning levels, defaults, custom levels, and user choices.
- Removed Codex transport rewrites and routing metadata deletion. CC Switch presets and user settings remain authoritative for `apiFormat`, `base_url`, `wire_api`, and local-routing metadata.
- Added `ccswitch:set-codex-effort` to persist a chosen Codex reasoning level in both the CC Switch provider card and live config, with backups.

## 0.19.0

- Added retention/compaction planning and application for blackboard, jobs, worktrees, cost ledger, and routing history.
- Protected active jobs and running seats from retention.
- Added patch acceptance metrics for check/apply/revert, conflicts, acceptance rate, and per-seat/per-model performance.
- Added provider circuit breaker state with exponential backoff.
- Added provider error classification for auth, rate-limit, timeout, server, and provider-business errors.
- Added p50/p95 provider latency tracking and half-open recovery probes.
- Added `moa_retention`, `moa_patch_metrics`, and `moa_provider_recovery`.

## 0.18.0

- Added task-level budget enforcement for tokens, estimated USD, wall time, and peak context.
- Budget checks run before DAG layers and repair rounds; unstarted nodes are blocked on violation.
- Added provider health-aware routing for automatic plans.
- Critical/inactive providers are replaced with healthy same-tier models when possible.
- Added `allowUnhealthy` and `respectHealth` controls for automatic dispatch.
- Added budget, provider-routing, and enforcement tests.

## 0.17.0

- Added structured execution and audit result parsing, including fenced JSON support.
- Added normalized AuditorFinding records with P0/P1/P2 severity, evidence, and recommendations.
- Navigator now consumes structured audit blocks, parse errors, conflict markers, and partial writes.
- Added bounded repair rounds after auditor blocks, with executor repair and auditor re-check.
- Checkpoint nodes now preserve per-round result history.
- Expanded tests for structured parsing and repair-round orchestration.

## 0.16.0

- Added worktree state inspection with tracked/untracked/deleted files, conflict markers, diff size, and partial-write detection.
- Added binary patch check/apply/revert operations and `moa_worktrees`.
- Added worktree cleanup/prune controls and the `worktrees.cleanup` policy.
- Added a generic locked JSON store with schema migrations.
- Migrated seat registry, control requests, routing experiments, and continuity sessions to atomic read-modify-write updates.
- Added concurrent-update and migration tests.

## 0.15.0

- Added persisted async job handles: `moa_start`, `moa_job_status`, `moa_job_wait`, and `moa_job_cancel`.
- Added a detached job worker with job/input/log files under `~/.codex-moa/jobs`.
- Added graceful job cancellation that marks unstarted DAG nodes and interrupts active ACP/ZCode seats.
- Added ACP `usage_update` collection and unified context usage in seat results and the cost ledger.
- Added ZCode isolated `headlessHome` support so codex-moa does not overwrite the TUI/GUI CLI config.
- Added CI verification on Node 20 and Node 22.

## 0.14.0

- Added real ACP end-to-end smoke coverage and fixed Kimi/DSH cancellation through `session/cancel`.
- Added a ZCode Protocol bridge so the ZCode app-server participates through the same seat contract as native ACP seats.
- Added Task DAG checkpoint persistence, partial-run recovery, and `resume=true` execution.
- Added a cost ledger over tokens, duration, quota context, and optional configured USD rates.
- Added provider health aggregation and the `moa_health` MCP tool.
- Added deterministic routing A/B experiments with sample thresholds, success-rate comparison, and automatic rollback to control.
- Added `moa_interrupt`, persisted control requests, and a local visual dashboard with per-seat cancellation.
- Expanded the ClaudeBar extension with quota, cost, runtime metrics, and Navigator/provider status sections.
- Added ACP, ZCode Protocol, checkpoint/resume, cost/health, routing experiment, and control-store tests.

## 0.13.0

- Updated CC Switch integration for v3.20.3 native Responses direct mode.
- Added direct/proxy transport detection for Codex live and provider configurations.
- Added `ccswitch:routing` and routing audits in `moa_ccswitch`, `moa_models`, and `moa_doctor`.
- Extended the metadata patch to repair stale Kimi/GLM upstream-format metadata and the GLM Responses endpoint.
- Migrated the expired DeepSeek V4.1 Flash alias to the current official `deepseek-flash` model ID.
- Kept local-routing compatibility for providers that still expose Chat Completions or Anthropic Messages.

## 0.12.0

- Added optional ACP persistent seat runtime for Kimi, DSH, and ZCode.
- Added Task DAG nodes, edges, and execution layers.
- Added package and user Role/Roster registries.
- Added ACP process listing in `moa_seats`.
- Added persistent session resume metadata.
- Added token usage extraction into seat results and the seat registry.

## 0.11.0

- Added persistent Seat Registry.
- Added Git worktree isolation and automatic diff capture.
- Added context-pack generation and `moa_context`.
- Added Navigator run review.
- Added Memory distillation.
- Added `moa_seats`.

## 0.10.0

- Added durable Task Memory Capsules independent of context compaction.
- Added `moa_memory` load/remember/list actions.
- Added automatic memory-pack injection and episode recording.
- Added structured decisions, facts, files, tests, failed attempts, and open questions.

## 0.9.0

- Added model context/output capability metadata and balanced runtime budgets.
- Extended the idempotent CC Switch metadata patch to fill provider context/output gaps.
- Added Kimi, ZCode, and DSH budget enforcement.
- Added `continuityKey` session persistence.
- Added Kimi/ZCode session resume and same-model continuity protection.
- Added limits and continuity documentation.

## 0.8.0

- Added unified reasoning effort selection and enforcement.
- Added reasoning capability mapping for all five models.
- Added CC Switch reasoning completeness audit.
- Added per-harness enforcement for Kimi, ZCode, and DSH.
- Added task-, role-, stakes-, and quota-aware effort selection.
- Added idempotent CC Switch reasoning metadata patch with database backup.

## 0.7.0

- Added human-gated self-evolution proposals.
- Added evolution event and outcome ledger.
- Added terminal-only approval, apply, and rollback gates so Codex cannot self-approve.
- Added `moa_evolve` and `npm run evolve:*` commands.
- Restricted automatic evolution to `config/evolution.json`.
- Added policy-driven cross-family audit routing.

## 0.6.0

- Codex-selected model is now treated as the captain contract.
- Added `moa_captain` and captain metadata in plan/run results.
- Added same-family audit warnings and optional strict enforcement.
- Added explicit `captainModel` support.
- Added captain fallback resolution from Codex config and CC Switch.

## 0.5.0

- Added read-only CC Switch provider/model and Skill integration.
- Added `moa_ccswitch`.
- Added `ccswitch:snapshot` and `ccswitch:skill` workflows.
- Added credentials-safe tests for CC Switch metadata.

## 0.4.0

- Added unified KimiCode, Z.ai/GLM, and DeepSeek quota refresh.
- Added `moa_quota` and quota awareness in planning/delegation.
- Added ClaudeBar menu-bar/Notch extension integration.
- Added quota documentation and parser tests.

## 0.3.0

- Added MCP `--health` and `moa_compat`.
- Added `npm run upgrade-check` for Codex upgrades.
- Added upgrade-safety documentation.
- Kept the plugin manifest minimal and independent of Codex internals.

## 0.2.0

- Added a canonical registry for the five available sub-agent models.
- Added `moa_models` and `moa_delegate`.
- Codex can now assign exact models per sub-agent.
- KimiCode models are passed through `-m`.
- ZCode models are enforced by synchronizing provider and `provider/model` into `~/.zcode/cli/config.json`.
- DSH audit seats enforce `DeepSeek-flash` through the dedicated profile.
- Added ZCode provider/model resolution tests.

## 0.1.0

- Initial Codex plugin, MCP server, adapters, routing, blackboard, and tests.
