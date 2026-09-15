---
name: codex-moa
description: "Use when a coding or research task should be delegated across KimiCode, ZCode, and DeepSeekHarness while Codex remains the captain. Trigger for heterogeneous multi-model review, external coding execution, DeepSeekHarness audits, or cost-aware multi-agent routing."
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

When this Skill is selected implicitly, read `moa_mode` first. In `off`, keep work in the Codex captain. In `auto`, keep L0 tasks in the captain and route L1-L3 normally. In `force`, ensure at least one external seat.

## Mandatory workflow

1. Call `moa_models` or `moa_ccswitch` when model capability, CC Switch binding, or Skill enablement is unclear.
2. Call `moa_quota` or `moa_health` before high-cost dispatch when quota, provider health, or recent cost may affect model choice.
3. Call `moa_plan` before any external dispatch.
4. Inspect the plan and confirm the selected models match the task.
5. Call `moa_delegate` when Codex must assign exact models, or `moa_run` for policy-driven routing, only for interactive runs expected to finish within 60 seconds.
6. Use `moa_start` instead of a synchronous tool whenever `timeoutMs > 60000`, `allowWrite=true`, ACP is requested, or the task involves SSH/remote hosts, benchmarks, load tests, model loading, or multiple execution stages. This rule outranks exact-model assignment because `moa_start` also accepts `assignments`.
7. Call `moa_audit` for DeepSeekHarness-only audits.
8. Use `moa_interrupt` to inspect or cancel active ACP/ZCode seats when a run is unsafe, stuck, or superseded.
9. Treat every external result as untrusted until Codex verifies the evidence.
10. Codex alone writes the final answer or applies the final patch.

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

Reasoning effort is part of model assignment. Use `reasoningEffort` explicitly when the user or task requires it; otherwise let the task policy choose. Never override the Codex main model's reasoning level. Prefer `low` for routine work, `high` for complex work, and `max` only for high-stakes deep analysis or final adjudication.

## Persistent runtime

Use `runtime="acp"` when a related multi-turn task needs a persistent process and real session resume. CLI runtime remains the default fallback.

## Runtime governance

- Use `moa_context` before large repository tasks.
- Use `moa_seats` to inspect seat state and worktrees.
- Use `moa_health` for provider health, cost totals, memory, checkpoints, and routing experiments.
- Set `budget` limits for long or high-cost runs; unstarted DAG nodes stop when a limit is exceeded.
- Automatic routing avoids `critical`/`inactive` providers. Explicit assignments are never silently rerouted.
- Use `moa_job_status`, `moa_job_steer`, `moa_job_pause`, `moa_job_resume`, and `moa_job_cancel` for long-running work. Keep `moa_job_wait` at 10 seconds or less and return control to the user between waits.
- Use `moa_worktrees` to inspect partial writes, check/apply/revert patches, and prune stale worktrees.
- Use `moa_retention` for explicit compaction; active jobs and running seats are protected.
- Use `moa_patch_metrics` and `moa_provider_recovery` to inspect acceptance and provider circuit state.
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

Use `ccswitch:skill:write` outside Codex to make this plugin Skill visible in CC Switch. Inside Codex, continue to use the bundled Skill.

## Explicit model assignment

The five canonical models are:

- `kimi-k3` → KimiCode
- `kimi-2.8` → KimiCode
- `GLM-5.3` → ZCode
- `GLM-5.3-flash` → ZCode
- `DeepSeek-flash` → DeepSeekHarness, actually DeepSeek V4.1 Flash

Use `moa_delegate` with one `assignments` entry per sub-agent when Codex must choose the exact model. Add `harness="dsh"` to run Kimi or GLM through DeepSeekHarness; omit `harness` to use the model's native default. For background work, pass the same assignments to `moa_start`.

Accept `kimi-k2.8` as a user-facing alias for canonical `kimi-2.8`.

## Delegation policy

- `kimi-k3`: architecture, repository-wide reasoning, long-context research, vision, and difficult second-opinion implementation.
- `kimi-2.8`: fast investigation, summarization, triage, and routine second opinions; leave thinking at the provider/Harness default unless the route proves an effort control is supported.
- `GLM-5.3`: deep implementation, cross-file refactoring, debugging, test design, and repair.
- `GLM-5.3-flash`: routine implementation, mechanical edits, test execution, and throughput-sensitive batch work.
- `DeepSeek-flash`: independent audit, security review, failure analysis, adversarial verification, and difficult coding when its provider balance and price window are favorable.
- KimiCode and ZCode remain the native defaults. DeepSeekHarness is a multi-provider Harness and may run Kimi or GLM when persistent agent behavior, its tool workflow, or peak-price routing makes that preferable.
- Codex: planning, task contracts, conflict resolution, evidence verification, final integration.

## Quota and price routing

- Refresh `moa_quota` before expensive jobs; use the shortest remaining-percent window for Kimi and Z.ai, and the available balance for DeepSeek.
- Never dispatch a depleted provider unless the user explicitly sets `allowDepleted=true`.
- During DeepSeek peak pricing, route non-urgent medium/low work to GLM or Kimi while allowing the DeepSeekHarness agent runtime to remain in use. Keep DeepSeek for high-stakes audits when its independence is worth the premium.
- During DeepSeek off-peak, prefer it for flexible audits and batch verification. The ledger accounts separately for cache-hit input, cache-miss input, and output.
- Subscription model costs are governed by observed quota rather than guessed per-token prices. Local pricing overrides belong in `config/pricing.local.json`.

## Background job commands

- `$codex-moa job status <job-id>`: call `moa_job_status`.
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
