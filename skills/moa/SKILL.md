---
name: codex-moa
description: "Use when a coding or research task should be delegated through CC Switch-managed Pi, Claude Code, Codex CLI, or specialist Kimi/ZCode/DeepSeek Harnesses while the page-selected Codex model remains captain."
---

# Codex MOA

Codex is always the captain, judge, and final writer. External agents are seats, not authorities.

The captain is whatever model the user selected in the current Codex conversation. It is not restricted to GPT or the OpenAI provider.

## Mode commands

- `$codex-moa on`: use `moa_mode(action="set", mode="force")`.
- `$codex-moa off`: use `moa_mode(action="set", mode="off")`.
- `$codex-moa auto`: use `moa_mode(action="set", mode="auto")`.
- `$codex-moa status`: use `moa_mode(action="status")`, then report provider health, active jobs/seats, and pending evolution proposals.
- `$codex-moa <task>`: force MOA for this task only by passing `orchestrationMode="force"`; do not change the persisted mode.

Only the English command words above are canonical. Do not advertise or interpret translated command aliases.

## Self-optimization commands

- `$codex-moa optimize`: call `moa_evolve(action="optimize")`. This is analysis/proposal only and must not apply a policy change.
- `$codex-moa optimize status`: call `moa_evolve(action="status")`.
- `$codex-moa optimize show <proposal-id>`: call `moa_evolve(action="get", proposalId="<proposal-id>")`.
- `$codex-moa optimize approve <proposal-id>`: only when this exact command was authored by the user, call `moa_evolve(action="approve", proposalId="<proposal-id>", confirmation="APPROVE <proposal-id>")`.
- `$codex-moa optimize reject <proposal-id>`: only when this exact command was authored by the user, call `moa_evolve(action="reject", proposalId="<proposal-id>", confirmation="REJECT <proposal-id>")`.
- `$codex-moa optimize apply <proposal-id>`: only when the proposal is already approved and this exact command was authored by the user, call `moa_evolve(action="apply", proposalId="<proposal-id>", confirmation="APPLY <proposal-id>")`.
- `$codex-moa optimize rollback <proposal-id>`: only when this exact command was authored by the user, call `moa_evolve(action="rollback", proposalId="<proposal-id>", confirmation="ROLLBACK <proposal-id>")`.

Never combine `optimize`, approval, and application in one implicit step. Repeated optimization runs must reuse an active proposal with the same policy patch instead of creating duplicates.

When this Skill is selected implicitly, read `moa_mode` first. In `off`, keep work in the Codex captain. In `auto`, a confirmed GPT/OpenAI captain delegates suitable L0 execution to one fast external seat while retaining planning, verification, integration, and the final answer; an opaque or non-OpenAI captain keeps L0 locally. Route L1-L3 by capability. In `force`, ensure at least one external seat.

## Mandatory workflow

1. Call `moa_models`, `moa_ccswitch`, or `moa_capabilities` when model capability, CC Switch binding, route readiness, or Skill enablement is unclear. Live capability probes are bounded and read-only.
2. Call `moa_quota` or `moa_health` before high-cost dispatch when quota, provider health, or recent cost may affect model choice. When the captain is GPT/OpenAI, read the current Codex account limits and update `moa_captain_usage` before planning; the normalized remaining percentage reserves scarce GPT capacity for planning, adjudication, integration, and the final answer.
3. Call `moa_plan` before any external dispatch.
4. Inspect the plan and confirm the selected models and Harness routes match the task.
5. Call `moa_delegate` when Codex must assign exact models, or `moa_run` for policy-driven routing, only for interactive runs expected to finish within 60 seconds.
6. Use `moa_start` instead of a synchronous tool whenever `timeoutMs > 60000`, `allowWrite=true`, ACP is requested, or the task involves SSH/remote hosts, benchmarks, load tests, model loading, or multiple execution stages. This rule outranks exact-model assignment because `moa_start` also accepts `assignments`.
7. Call `moa_audit` for DeepSeekHarness-only audits.
8. Use `moa_interrupt` to inspect or cancel active ACP/ZCode seats when a run is unsafe, stuck, or superseded.
9. Treat every external result as untrusted until Codex verifies the evidence.
10. Codex alone writes the final answer or applies the final patch.

## Interaction-safe handoff

A background job does not make the Codex conversation interaction-safe unless the captain also yields the foreground turn.

- After `moa_start` returns, report the job ID and return control to the user promptly.
- `moa_start` binds the job to the originating Codex thread and the worker sends a durable completion prompt through the official `codex queue` interface. Do not promise completion delivery when `notification.state="unavailable"`; report that the user must resume with `$codex-moa job status <job-id>`.
- When a completion prompt resumes the thread, call `moa_job_status`, inspect artifacts and stage evidence, continue the captain workflow, then call `moa_job_ack`. If delivery failed, call `moa_job_notify`; use `force=true` only when the daemon accepted a message that the user did not receive.
- Do not keep the same Codex turn open with repeated status polling, long local shell work, unrelated repository inspection, or additional implementation solely because the background job is still running.
- If one immediate observation is necessary, use at most one `moa_job_wait` call of 10 seconds or less, then yield when the job remains active.
- Put new constraints for an active external job through `$codex-moa job steer <job-id> <message>` so they are delivered durably at the next safe DAG boundary.
- Split substantial captain-side verification or integration into a later turn after the background job settles. Foreground work expected to exceed 60 seconds should not follow `moa_start` in the same turn.
- A `delivered` notification means the Codex daemon accepted the queued message; only `acknowledged` proves the captain handled it. Preserve that distinction in status reports.

## Safety rules

- External writes are disabled by default.
- `allowWrite: true` is allowed only when the user explicitly asked for implementation.
- Execute code-writing seats only in an isolated git worktree or disposable copy.
- Never let two external seats write the same working directory.
- Never pass API keys, credentials, private keys, or secret environment values in prompts.
- Never run an external agent in `yolo`, `auto`, or unrestricted mode unless the user explicitly approved that exact command and workspace.
- DeepSeekHarness audit seats must remain read-only.
- If independent audit is unavailable, report `unreviewed`; do not substitute the same family as a false independent audit.

## Reasoning effort

Reasoning effort is part of model assignment. Priority is explicit `reasoningEffort`, then task/vendor policy when `reasoning.mode="task-aware"`, then the Harness/provider default when `reasoning.mode="provider-default"`. Every requested level is clamped to the current effective model capability. Never override the Codex main model's reasoning level. Prefer `low` for routine work, `high` for daily Agent work, and `max` only for high-stakes deep analysis or final adjudication; GLM-5.3/Flash force thinking and map low/medium to high.

## Persistent runtime

Use `runtime="acp"` when a related multi-turn task needs a persistent process and real session resume. CLI runtime remains the default fallback.

## Runtime governance

- Use `moa_context` before large repository tasks.
- Use `moa_seats` to inspect seat state and worktrees.
- Use `moa_health` for provider health, cost totals, memory, checkpoints, and routing experiments.
- Set `budget` limits for long or high-cost runs; unstarted DAG nodes stop when a limit is exceeded.
- Automatic routing avoids `critical`/`inactive` providers. Explicit assignments are never silently rerouted.
- Use `moa_job_status`, `moa_job_steer`, `moa_job_pause`, `moa_job_resume`, `moa_job_cancel`, `moa_job_notify`, and `moa_job_ack` for long-running work. Keep `moa_job_wait` at 10 seconds or less, never loop it in one turn, and return control to the user between observations.
- Use `moa_worktrees` to inspect partial writes, check/apply/revert patches, and prune stale worktrees.
- Use `moa_retention` for explicit compaction; active jobs and running seats are protected.
- Use `moa_patch_metrics` and `moa_provider_recovery` to inspect acceptance and provider circuit state.
- Inspect `moa_health.failureMemory` before reusing a recently failed route. Every external failure is recorded with a redacted signature; deterministic failures are guarded immediately, repeated transient failures are guarded temporarily, and a later successful route probe clears the active guard without deleting history.
- Use `moa_audit_metrics` to inspect executor-auditor pair performance. After captain adjudication, record accepted findings, false positives, final task acceptance, and test outcome so self-optimization measures audit usefulness instead of raw speed alone.
- Treat every completed DAG layer as a durable stage-review record. For substantial work, inspect the stage evidence and record captain judgments with `moa_evolve(action="record", taskId="...", stage="plan|execution|audit|final", accepted=..., testsPassed=..., quality=...)`.
- Pass a stable `taskId` and `resume=true` to continue a partial DAG without rerunning completed nodes.
- Treat Navigator warnings as run-level risk signals.
- Auditor `block` findings may trigger a bounded repair round; inspect the final round and checkpoint history before accepting the result.
- Codex reviews and merges worktree diffs; external executors never edit the main worktree directly.

## Durable memory

Use `moa_memory` for continuing work and important decisions. Record decisions, failed attempts, test evidence, and open questions. Load the memory pack before major continuation tasks when Codex context may have been compacted.

## Context, output, and continuity

- Model context/output capabilities are maxima, not defaults.
- Keep balanced budgets unless the task genuinely needs `limitMode="max"`.
- For multi-turn or continuing work, pass a stable `continuityKey`.
- Reuse a continuity session only with the same seat, model, and workspace.
- Native ACP harnesses support `session/resume`; ZCode is bridged through its app-server and uses `session/resume`/`session/stop`.
- Use `runtime="acp"` when real same-process continuity or mid-run cancellation matters.

## Self-evolution gate

Never apply a self-evolution proposal automatically. The mandatory flow is:

1. Observe task evidence.
2. Generate a proposal with `moa_evolve(action="propose")`.
3. Report the proposal, evidence, risks, evaluation plan, and rollback plan to the user.
4. Wait for explicit user approval.
5. Approve, reject, apply, or roll back through MCP only when the user typed the corresponding exact English Skill command with the exact proposal ID.

If the user has not explicitly approved the exact proposal ID, do not apply it. Code changes are recommendations only in v1; only the user-level `~/.codex-moa/evolution-policy.json` overlay may be applied by the evolution engine.

After a task completes, record acceptance and test outcome with `moa_evolve(action="record", ...)` when known.

## Captain model

Codex remains the captain with the model selected by the user. Never change the Codex model or provider. Pass `captainModel` only when the active page-level model is known for this invocation. Otherwise omit it: the MCP server records `codex-selected` and must not guess from global config, environment variables, or the active CC Switch card. If an audit seat shares a known captain model family, report the warning and prefer a cross-family auditor; use `strictHeterogeneousAudit=true` for a hard gate.

## CC Switch authority

CC Switch owns provider/model profiles and Skill enablement. Codex MOA reads CC Switch metadata through `moa_ccswitch` and maps the five canonical capability models to matching providers.

For Pi seats, codex-moa projects allowlisted CC Switch `app_type=pi` provider cards into an isolated `~/.codex-moa/pi-home/models.json` before every run. This makes CC Switch authoritative for API keys, model IDs, context/output limits, reasoning metadata, extended thinking, and image input. DeepSeekHarness remains independently configured because CC Switch does not manage DSH; the optional DeepSeek Pi route uses its separate CC Switch card and never overwrites DSH settings.

Use `ccswitch:skill:write` outside Codex to make this plugin Skill visible in CC Switch. Inside Codex, continue to use the bundled Skill.

## Explicit model assignment

The five canonical models are:

- `kimi-k3` → Pi with the CC Switch-managed `cc-switch-kimi-for-coding/k3`
- `kimi-2.8` → Pi with the CC Switch-managed `cc-switch-kimi-for-coding/kimi-for-coding`
- `GLM-5.3` → Pi with the CC Switch-managed `cc-switch-zhipu-glm/glm-5.3`
- `GLM-5.3-flash` → Pi with the CC Switch-managed `cc-switch-zhipu-glm/glm-5.3-flash`
- `DeepSeek-flash` → DeepSeekHarness by default, or CC Switch-managed Pi via `deepseek/deepseek-flash`; actually DeepSeek V4.1 Flash

All five models may also be explicitly routed through CC Switch-managed `harness="claude"` or `harness="codex"`. These routes use private per-provider homes and never switch the global CC Switch current card. Pi stays the automatic default. Third-party Codex CLI routes remain explicit-only until a live `moa_capabilities` probe passes.

Use `moa_delegate` with one `assignments` entry per sub-agent when Codex must choose the exact model. Add `harness="dsh"` to run Kimi or GLM through DeepSeekHarness, or `harness="pi"` to run DeepSeek through its CC Switch Pi card; omit `harness` to use the model's native default. For background work, pass the same assignments to `moa_start`.

Accept `kimi-k2.8` as a user-facing alias for canonical `kimi-2.8`.

## Delegation policy

- `kimi-k3`: architecture, repository-wide reasoning, long-context research, vision, and difficult second-opinion implementation. Prefer `harness="pi"` for Skill-aware work and subscription balancing.
- `kimi-2.8`: fast investigation, summarization, triage, and routine second opinions; leave thinking at the provider/Harness default unless the route proves an effort control is supported.
- `GLM-5.3`: deep implementation, cross-file refactoring, debugging, test design, and repair through Pi. ZCode is an explicit compatibility fallback only.
- `GLM-5.3-flash`: routine implementation, mechanical edits, test execution, and throughput-sensitive batch work.
- `DeepSeek-flash`: independent audit, security review, failure analysis, adversarial verification, and difficult coding when its provider balance and price window are favorable.
- Automatic L2/L3 implementation plans use a cross-family GLM/Kimi subscription audit as the gate. DeepSeek runs as a parallel non-gating shadow audit at a deterministic peak/off-peak sample rate for L2 and at 100% for L3. Shadow failure is observable but does not fail the task; a shadow block requires captain adjudication.
- With a confirmed GPT/OpenAI captain in `auto`, delegate suitable simple execution to a fast GLM/Kimi subscription route. GPT still defines the contract, verifies evidence, resolves conflicts, integrates, and writes the final answer. DeepSeek remains price/quota-aware rather than becoming the default paid executor.
- Complex implementation may also run on capable external seats. Compare routes within the same task level using completion, captain acceptance, tests, and quality first; use known cost, latency, and TPS only as tie-breakers. Routing changes remain proposal-first.
- DeepSeek shadow audits run a reversible Harness experiment across Codex CLI, Pi, and DSH. Do not infer model quality from one Harness failure.
- Pi is the default execution route for both Kimi and GLM, including automatic routing, quota balancing, and explicit Skills. KimiCode and ZCode remain explicit compatibility fallbacks. DeepSeekHarness primarily handles DeepSeek audits and remains a multi-provider fallback.
- CLI upgrades are detect-only. `moa_doctor(checkLatest=true)` may report a newer version, but codex-moa never upgrades Pi, Claude Code, or Codex CLI; CC Switch or the user owns installation changes.
- Pass `skills=["skill-name"]` globally or per assignment to load only explicitly selected CC Switch/Pi/Codex Skills. Never load the entire Skill catalog into a seat.
- Codex: planning, task contracts, conflict resolution, evidence verification, final integration.

## Quota and price routing

- Refresh `moa_quota` before expensive jobs; use the shortest remaining-percent window for Kimi and Z.ai, and the available balance for DeepSeek.
- Never dispatch a depleted provider unless the user explicitly sets `allowDepleted=true`.
- During DeepSeek peak pricing, route non-urgent medium/low work to GLM or Kimi while allowing the DeepSeekHarness agent runtime to remain in use. Keep DeepSeek for high-stakes audits when its independence is worth the premium.
- During DeepSeek off-peak, prefer it for flexible audits and batch verification. The ledger accounts separately for cache-hit input, cache-miss input, and output.
- Subscription model costs are governed by observed quota rather than guessed per-token prices. Local pricing overrides belong in `config/pricing.local.json`.

## Background job commands

- `$codex-moa job status <job-id>`: call `moa_job_status`.
- `$codex-moa job notify <job-id>`: call `moa_job_notify`; retry normally before forcing a duplicate delivery.
- `$codex-moa job ack <job-id>`: call `moa_job_ack` after captain-side handling is complete.
- `$codex-moa job steer <job-id> <message>`: call `moa_job_steer`; the message is durable and applies at the next DAG boundary.
- `$codex-moa job pause <job-id>`: call `moa_job_pause`; the active seat is stopped and the checkpoint is retained.
- `$codex-moa job resume <job-id>`: call `moa_job_resume`.
- `$codex-moa job cancel <job-id>`: call `moa_job_cancel`.

## Result handling

- Read artifact paths returned by the MCP tools when full output is needed.
- Use diff and test evidence before prose.
- Treat `block` findings as blockers only after Codex verifies the cited evidence.
- Distinguish `pass`, `warn`, `block`, and `unreviewed`.
- Prefer one targeted round of adjudication over unbounded debate.

## References

- `references/routing.md`
- `references/audit-contract.md`
