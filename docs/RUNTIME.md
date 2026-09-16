# Runtime Capabilities

## Seat Registry

Persistent runtime state:

```text
~/.codex-moa/seats.json
```

Tracks task id, seat, harness, model, reasoning, limits, worktree, status, session id, duration, and diff path.

Use:

```text
moa_seats(taskId="...")
```

## Worktree isolation

Executor seats automatically run in detached Git worktrees:

```text
~/.codex-moa/worktrees/<repo-hash>/<task-id>/<seat>
```

Each worktree captures a binary diff after the run. Codex remains responsible for reviewing and merging the patch.

## Context Pack

`moa_context` builds a keyword-scored context pack using `git ls-files`, file scoring, excerpts, hashes, and token estimates.

It does not dump the whole repository into the model.

## Navigator

Every `moa_run` now produces a deterministic Navigator review containing:

- failed seats
- timeouts
- missing diffs
- audit heterogeneity warnings
- low quota models
- overall verdict

Navigator results are included in the run result and Memory Capsule episode.

## Memory distillation

```text
moa_memory(action="distill", memoryKey="...")
```

Deduplicates decisions, facts, files, tests, failed attempts, and questions, and retains the latest 20 episodes.

## ACP persistent runtime

Seats can opt into ACP with:

```json
{"runtime": "acp"}
```

| Harness | Transport | Cancellation |
|---|---|---|
| KimiCode | Native ACP `kimi acp` | `session/cancel` |
| DSH | Native ACP `dsh --profile acp` | `session/cancel` |
| ZCode | ZCode Protocol `app-server`, bridged to the ACP seat contract | `session/stop` |

ZCode UI `start-plan` providers require GUI captcha and are not headless-safe. Configure `zcode.headlessProvider` in `config/local.json` to select an API-key provider for codex-moa while leaving the UI provider unchanged. codex-moa also runs ZCode in an isolated home (`~/.codex-moa/zcode-home`) and symlinks shared credentials, so its headless CLI config does not overwrite the user TUI/GUI provider selection.

The process pool is kept in memory; session ids are persisted through `continuityKey` so a later Codex run can resume after the process is recreated.

Run the real smoke test:

```bash
npm run acp:smoke -- --harness all --json
```

The smoke test distinguishes transport success from external blockers such as missing authentication or provider-side model failures.

## CC Switch-managed CLI Harnesses

Pi, Claude Code, and Codex CLI run through private per-provider homes. They never change the globally selected CC Switch card. Pi is the automatic default; Claude Code and Codex CLI are explicit routes. See `docs/CLI-HARNESSES.md` for lifecycle policy, capability probes, and current route status.

## Async jobs

Long-running MoA tasks can be started without blocking the MCP request:

```text
moa_start(task="...", cwd="/repo", assignments=[...])
moa_job_status()
moa_job_status(jobId="job-...")
moa_job_wait(jobId="job-...", timeoutMs=10000)
moa_job_steer(jobId="job-...", message="New constraint")
moa_job_cancel(jobId="job-...", reason="superseded")
moa_job_notify(jobId="job-...", force=false)
moa_job_ack(jobId="job-...")
```

Each job is persisted at:

```text
~/.codex-moa/jobs/<job-id>/
  job.json
  input.json
  worker.log
```

The worker runs `runMoA` independently of the MCP connection. `moa_job_cancel` marks the job cancelled and writes scoped ACP cancellation requests. Nodes that have not started are marked cancelled; running CLI seats are allowed to finish, while ACP/ZCode seats are interrupted through their protocol cancel path.

Async jobs reject per-seat `env` values so credentials are not persisted to disk. Put credentials in provider configuration, or use synchronous `moa_run` when seat-local environment variables are required.

### Interaction-safe handoff

Starting a detached worker is only half of the handoff. `moa_start`, single-job `moa_job_status`, `moa_job_wait`, and `moa_job_steer` return an `interaction` object that tells the captain whether it should yield the foreground turn. When `captainShouldYield` is true:

1. Report the job ID and the durable status/steer commands.
2. Do not loop on status/wait or continue substantial local work in the same turn.
3. Use at most one wait of 10 seconds, then return control to the user.
4. The worker queues a continuation prompt to the originating thread when the job settles.
5. Perform captain-side verification and integration in that later turn, then call `moa_job_ack`.

Completion delivery uses the official `codex queue` command and is persisted in `job.json`. `notification.state="delivered"` means the daemon accepted the message, not that the captain handled it. `notification.state="acknowledged"` is the end-to-end confirmation. A failed or missing prompt remains visible and can be retried with `moa_job_notify`; `force=true` intentionally permits duplicate delivery.

## Interrupt and control plane

```text
moa_interrupt(action="status")
moa_interrupt(action="cancel", taskId="...", seat="executor")
```

Cancellation requests are also persisted at `~/.codex-moa/control.json`. The dashboard reads runtime state and writes scoped cancellation requests:

```bash
npm run dashboard
npm run control -- status
npm run control -- cancel --task-id TASK_ID --seat SEAT_ID
```

## Checkpoint and resume

Each DAG layer is persisted to:

```text
~/.codex-moa/blackboard/<task-id>/checkpoint.json
```

Completed nodes are skipped when resuming. Failed or blocked nodes are retried, then downstream layers become runnable when their dependencies succeed:

```text
moa_run(task="...", cwd="/repo", taskId="stable-task-id", resume=true)
moa_delegate(task="...", cwd="/repo", taskId="stable-task-id", resume=true, assignments=[...])
```

## Retention and compaction

`moa_retention` plans deletion/compaction for blackboard runs, jobs, managed clean worktrees, cost-ledger entries, audit metrics, failure memory, and routing history. Active jobs and running seats are protected. Apply requires `allowWrite=true`.

## Patch acceptance metrics

Patch check/apply/revert operations are written to `~/.codex-moa/patch-metrics.jsonl` and summarized by `moa_patch_metrics` or `npm run patch:metrics`.

## Provider recovery

Provider state is stored at `~/.codex-moa/provider-state.json`. Repeated failures open a circuit with exponential backoff; errors are classified as auth, rate-limit, timeout, server, provider-business, or unknown. Half-open circuits can be probed through `moa_provider_recovery` or `moa_health(probeProviders=true)`, and successful probes close the circuit.

## Budget enforcement

Per-task budgets support token, estimated USD, wall-time, and context limits. Checks run before each DAG layer and before repair rounds. When a limit is exceeded, unstarted nodes are blocked and the run returns `budget.exceeded` details.

## Provider health routing

Automatic plans consult provider health before dispatch. `critical` or `inactive` providers are replaced with a healthy model of the same tier when possible. If no replacement exists, dispatch fails unless `allowUnhealthy=true`. Explicit `assignments`/`seats` are never silently changed.

## Structured results and repair rounds

Seat summaries are normalized into structured execution/audit results:

- execution: status, summary, claims, tests, blockers, uncertainty
- audit: verdict, findings, missing evidence, verified commands

Auditor responses are parsed from raw JSON or fenced JSON. Invalid auditor JSON is surfaced as a Navigator warning instead of being treated as a pass. An auditor `block` can trigger a repair round when `plan.budget.maxRounds > 1`: executors rerun with the P0/P1 findings, then auditors re-check the repaired result. Checkpoint nodes keep a `rounds` history while `node.result` remains the latest result.

Gate auditors participate in Navigator blocking and repair rounds. Shadow auditors run in parallel, remain read-only, and are excluded from gate failure, provider-circuit, routing-outcome, and repair decisions. Their failures and block verdicts remain visible for captain adjudication and Harness comparison.

`moa_audit_metrics(action="status")` summarizes executor-auditor pairs. After reviewing findings, the captain records accepted findings and false positives with `moa_audit_metrics(action="record", ...)`; this evidence feeds proposal-first self-optimization.

Every completed DAG layer is persisted in `checkpoint.stageReviews` with phase, model/Harness route, status, duration, tests, and blocking-gate outcome. `moa_evolve(action="record", stage="plan|execution|audit|final", ...)` adds the captain's judgment. Evolution analysis compares execution routes only within the same task level and gates cost/TPS optimization behind completion, acceptance, tests, and quality.

External seat failures are appended to `~/.codex-moa/failures.jsonl` with model, Harness, phase, failure class, timeout/stop metadata, and a redacted signature. Authentication/capability failures activate an immediate route guard; repeated matching transient failures activate a short guard. Automatic routing changes family or Harness instead of repeating an active guard, while exact user assignments are never silently rewritten. A later successful run clears the active guard but preserves the historical record.

## Cost ledger and provider health

```bash
npm run health
```

The health summary includes seats, worktrees, memory capsules, Navigator, checkpoints, provider health, routing experiments, and recent token/duration cost totals.

## Routing A/B experiments

`config/evolution.json` defines the `medium-review-tier` experiment. Variant selection is deterministic for a task and workspace. After the configured sample count, a challenger whose success rate falls below control by the rollback margin is automatically disabled and future traffic is pinned to control. The decision is recorded in:

```text
~/.codex-moa/routing-experiments.json
```


## Persistent state safety

Persistent JSON stores use an exclusive lock file plus atomic rename. Seat registry, control requests, routing experiments, and continuity sessions use read-modify-write update primitives, so concurrent runs do not overwrite one another. Each store also has a versioned migration step.

## Task graph

`moa_plan` now returns a DAG with nodes, edges, and execution layers. Architect/research seats precede executors; auditors/reviewers depend on executors.

L3 implementation is deliberately not represented as a complete background DAG when `executionPolicy.owner` is `captain`. The foreground page captain performs the core work, while any returned graph covers bounded support only. Callers must not announce task completion merely because those support nodes reached a terminal state. If an explicit executor is combined with captain-owned L3 work, orchestration fails with `CAPTAIN_PRIMARY_REQUIRED` before any external process starts.

## Role registry

Built-in role defaults live in `roles/`. User overrides live in:

```text
~/.codex-moa/roles/*.json
```

Roles may tune mode, model tier, runtime, reasoning, and context/output budgets. They cannot expand sandbox or approval permissions.
