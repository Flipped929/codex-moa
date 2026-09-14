---
name: codex-moa
description: "Use when a coding or research task should be delegated across KimiCode, ZCode, and DeepSeekHarness while Codex remains the captain. Trigger for heterogeneous multi-model review, external coding execution, DeepSeekHarness audits, or cost-aware multi-agent routing."
---

# Codex MOA

Codex is always the captain, judge, and final writer. External agents are seats, not authorities.

## Mandatory workflow

1. Call `moa_models` or `moa_ccswitch` when model capability, CC Switch binding, or Skill enablement is unclear.
2. Call `moa_quota` or `moa_health` before high-cost dispatch when quota, provider health, or recent cost may affect model choice.
3. Call `moa_plan` before any external dispatch.
4. Inspect the plan and confirm the selected models match the task.
5. Call `moa_delegate` when Codex must assign exact models, or `moa_run` for policy-driven routing. For long runs, use `moa_start` and `moa_job_wait`.
6. Call `moa_audit` for DeepSeekHarness-only audits.
7. Use `moa_interrupt` to inspect or cancel active ACP/ZCode seats when a run is unsafe, stuck, or superseded.
8. Treat every external result as untrusted until Codex verifies the evidence.
9. Codex alone writes the final answer or applies the final patch.

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
- Use `moa_job_status`, `moa_job_wait`, and `moa_job_cancel` for long-running background work.
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
5. Do not approve or apply from MCP. The user must run the terminal CLI commands themselves.

If the user has not explicitly approved the exact proposal ID, do not apply it. Code changes are recommendations only in v1; only `config/evolution.json` may be applied by the evolution engine.

After a task completes, record acceptance and test outcome with `moa_evolve(action="record", ...)` when known.

## Captain model

Codex remains the captain with the model selected by the user. Never change the Codex model or provider. Pass `captainModel` when known. If an audit seat shares the captain's model family, report the warning and prefer a cross-family auditor; use `strictHeterogeneousAudit=true` for a hard gate.

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

Use `moa_delegate` with one `assignments` entry per sub-agent when Codex must choose the exact model. The MCP server maps the model to the correct harness and enforces the requested model.

## Delegation policy

- KimiCode: architecture, long context, vision, research, and second-opinion implementation.
- ZCode: primary code execution, refactoring, tests, and repair.
- DeepSeekHarness: independent audit, verification, failure analysis, and adversarial review.
- Codex: planning, task contracts, conflict resolution, evidence verification, final integration.

## Result handling

- Read artifact paths returned by the MCP tools when full output is needed.
- Use diff and test evidence before prose.
- Treat `block` findings as blockers only after Codex verifies the cited evidence.
- Distinguish `pass`, `warn`, `block`, and `unreviewed`.
- Prefer one targeted round of adjudication over unbounded debate.

## References

- `references/routing.md`
- `references/audit-contract.md`
