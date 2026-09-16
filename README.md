# codex-moa

**English** | [简体中文](README.zh-CN.md)

Codex MOA keeps Codex as the captain while delegating work to isolated heterogeneous agent harnesses:

- **Pi** for a unified Kimi/GLM Coding Plan route and explicit CC Switch-managed Skills.
- **Claude Code** as a CC Switch-managed secondary execution route.
- **Codex CLI** as an explicit Responses-compatible child route without automatically consuming OpenAI quota.
- **KimiCode** as an explicit native Kimi fallback.
- **ZCode** as an explicit native GLM compatibility fallback.
- **DeepSeekHarness** for independent audit and verification.

The Codex plugin exposes one local MCP server. The MCP server owns routing, subprocess execution, artifacts, redaction, and scheduling hints.

## What it does

Codex MOA turns Codex into the captain of a heterogeneous multi-model runtime:

- Plans a task into a dependency-aware DAG.
- Selects models by capability, cost tier, quota, health, and task risk.
- Runs Pi, Claude Code, Codex CLI, KimiCode, ZCode, and DeepSeekHarness as independent seats.
- Detects CLI versions and optional latest releases without performing automatic upgrades.
- Exposes declared and bounded live capability checks through `moa_capabilities`.
- Tracks normalized GPT captain quota through `moa_captain_usage` and recommends a dynamic external-work share without ever replacing the page-selected captain.
- In `auto`, a confirmed GPT/OpenAI captain delegates suitable routine and bounded execution. For L3 implementation, the page captain personally owns architecture, critical implementation, integration, and repair; external routes provide scoped support and are compared by quality before cost and speed.
- Separates orchestration mode from execution ownership with `executionOwner=auto|captain|hybrid|external`. L3 defaults to `captain`, and accidental external core assignments are blocked before a Harness starts.
- Persists redacted model/Harness failure signatures, temporarily guards deterministic or repeated failures, and routes automatic work away from known-bad paths until recovery.
- Records completion rate, latency, and output TPS per model/Harness route. Automatic preference requires at least three samples and a 75% completion gate; TPS remains a secondary tie-breaker.
- Uses complementary GLM/Kimi subscription audits as gates and samples DeepSeek as a parallel non-gating shadow auditor for L2, with mandatory dual audit for L3. `moa_audit_metrics` records pair quality, Harness reliability, critical-path latency, cost, and captain adjudication.
- Isolates write-capable executors in Git worktrees.
- Captures structured execution and audit results.
- Repairs auditor `block` findings in a bounded second round.
- Persists checkpoints so partial runs can resume without repeating completed nodes.
- Tracks budgets, token cost, provider health, patch acceptance, and seat quality.
- Exposes async jobs, cancellation, a local dashboard, and ClaudeBar visibility.
- Keeps Codex as the final judge and writer; external agents are never authorities.

## Architecture

```mermaid
flowchart TB
  User[User task in Codex] --> Captain[Codex Captain]
  Captain --> Planner[Planner and Router<br/>task level, roles, DAG, budgets, quota, provider health]

  Planner --> Pi[Pi seat<br/>Kimi/GLM, explicit Skills]
  Planner --> Kimi[KimiCode seat<br/>architecture, long context, vision]
  Planner --> ZCode[ZCode seat<br/>GLM executor]
  Planner --> DSH[DeepSeekHarness seat<br/>independent audit]

  Pi --> Worktree
  Kimi --> ACP[ACP session runtime]
  ZCode --> ZBridge[ZCode Protocol bridge]
  DSH --> ACP

  ACP --> Worktree[Git worktree isolation]
  ZBridge --> Worktree
  Worktree --> Evidence[Diff, tests, structured result]

  Evidence --> Checkpoint[Checkpoint and resume]
  Evidence --> Repair{Auditor block?}
  Repair -->|yes| Planner
  Repair -->|no| Navigator[Navigator review and adjudication]

  Checkpoint --> Blackboard[Blackboard artifacts]
  Blackboard --> Memory[Memory capsules]
  Blackboard --> Cost[Cost ledger]
  Blackboard --> Jobs[Async job store]
  Blackboard --> Patch[Patch acceptance metrics]

  Cost --> Health[Provider health and circuit breaker]
  Health --> Planner

  Jobs --> Control[Cancel/control plane]
  Control --> ACP
  Control --> ZBridge

  Blackboard --> Dashboard[Local dashboard]
  Blackboard --> Bar[ClaudeBar extension]
  CCSwitch[CC Switch provider metadata] -.-> Planner
```


## Status

This repository currently implements the MVP control plane:

- Codex plugin manifest and MCP configuration.
- `codex-moa` Skill.
- MCP tools: `moa_mode`, `moa_doctor`, `moa_models`, `moa_ccswitch`, `moa_quota`, `moa_health`, `moa_plan`, `moa_run`, `moa_start`, `moa_job_status`, `moa_job_wait`, `moa_job_steer`, `moa_job_pause`, `moa_job_resume`, `moa_job_cancel`, `moa_job_notify`, `moa_job_ack`, `moa_worktrees`, `moa_retention`, `moa_patch_metrics`, `moa_provider_recovery`, `moa_delegate`, `moa_audit`, `moa_interrupt`, `moa_schedule`, `moa_captain`, `moa_evolve`.
- Five explicit models: `kimi-k3`, `kimi-2.8`, `GLM-5.3`, `GLM-5.3-flash`, `DeepSeek-flash`.
- CC Switch 3.20.3 native Responses direct-mode detection, with routing retained only for Chat/Anthropic upstreams.
- CC Switch routing audit: `npm run ccswitch:routing`.
- Pi, Claude Code, Codex CLI, KimiCode, ZCode, and DeepSeekHarness adapters.
- Weekly subscription-burn balancing between Kimi and GLM through Pi.
- Allowlisted Skill resolution from CC Switch, Pi, Codex, and Agents directories.
- Blackboard artifacts under `~/.codex-moa/blackboard`.
- Time policy for DeepSeek peak/off-peak; the legacy GLM night campaign no longer changes the default Harness.
- DeepSeekHarness multi-provider routes for Kimi and GLM, with native Harnesses retained as defaults.
- Durable job steering plus pause/resume at checkpoint boundaries; synchronous runs are limited to interactive work.
- Real ACP smoke harness for KimiCode, DeepSeekHarness, and the ZCode app-server bridge.
- Task DAG checkpoint/resume, cost ledger, provider health, routing A/B experiments with automatic rollback.
- Local control dashboard, interrupt/cancel requests, and richer ClaudeBar runtime status sections.
- Node test suite.

External writes are disabled by default. A seat cannot write unless `allowWrite` is true and the seat explicitly sets `autoApprove`.

For highest-complexity work, use a GPT/OpenAI page model when available. Codex MOA may recommend that choice, but it never changes the page-selected model or reasoning effort. GPT quota, subscription balance, provider pricing, TPS, and completion history tune external support; they cannot transfer L3 core ownership.

## Prerequisites

- Node.js 20 or newer.
- Codex with plugin and MCP support.
- KimiCode CLI installed and authenticated.
- ZCode installed at `/Applications/ZCode.app`, or override the command in `config/local.json`.
- DeepSeekHarness installed as `dsh` and authenticated.
- Pi installed as `pi`. Kimi, GLM, and the optional DeepSeek Pi route read allowlisted provider cards from CC Switch into an isolated Pi home before every run; the default DeepSeekHarness route remains independently configured.
- Claude Code and Codex CLI are optional explicit child Harnesses. Their CC Switch cards are projected into private per-provider homes and never replace the page-selected captain or global current card.
- Git worktrees or disposable copies for code-writing seats.

## Documentation

- `docs/PREREQUISITES.md`
- `docs/ARCHITECTURE.md`
- `docs/ROADMAP.md`
- `docs/UPGRADE-SAFETY.md`
- `docs/QUOTA.md`
- `docs/CCSWITCH.md`
- `docs/CAPTAIN.md`
- `docs/EVOLUTION.md`
- `docs/REASONING.md`
- `docs/LIMITS.md`
- `docs/CONTINUITY.md`
- `docs/MEMORY.md`
- `docs/RUNTIME.md`

## Local setup

```bash
cd /path/to/codex-moa
npm install
npm test
npm run doctor
npm run upgrade-check
```

`npm run doctor` checks command availability, minimum versions, CLI capabilities, the ZCode script path, and the DSH headless profile. `node scripts/doctor.mjs --latest` performs an opt-in registry lookup; codex-moa never upgrades a CLI automatically.

## Install as a local Codex plugin

The repository includes a development marketplace at `dev-marketplace/`.

```bash
codex plugin marketplace add /path/to/codex-moa/dev-marketplace
codex plugin add codex-moa@codex-moa-local
```

Start a new Codex task after installation so the plugin Skill and MCP tools are loaded.

For upgrades while older Codex sessions are still open, update the manifest cachebuster and run `npm run plugin:reinstall`. The compatibility installer restores prior cache directories after installation so already-running MCP processes retain their config and worker files; only new sessions receive newly added tools.

## Configuration

Default configuration lives in `config/default.json`, `config/models.json`, and `config/schedule.json`.

Create `config/local.json` to override machine-specific command/provider values. Start from `config/local.example.json`. Use `config/models.local.json` or `config/schedule.local.json` for model and schedule overrides. These files are ignored by git.

Example:

```json
{
  "commands": {
    "kimi": { "command": "kimi", "args": [] },
    "zcode": {
      "command": "node",
      "args": ["/Applications/ZCode.app/Contents/Resources/glm/zcode.cjs"]
    },
    "dsh": { "command": "dsh", "args": [] },
    "pi": { "command": "pi", "args": [] },
    "claude": { "command": "claude", "args": [] },
    "codex": { "command": "codex", "args": [] }
  },
  "profiles": {
    "dsh": {
      "fast": "codex-dsh-audit-fast",
      "deep": "codex-dsh-audit-deep"
    }
  },
  "zcode": {
    "headlessProvider": "builtin:bigmodel-coding-plan",
    "headlessHome": "~/.codex-moa/zcode-home"
  }
}
```

See [`docs/CLI-HARNESSES.md`](docs/CLI-HARNESSES.md) for isolation, upgrade detection, and live capability probes.

## Tool usage

Plan without execution:

```text
moa_plan(task="Refactor the parser", stakes="medium")
```

List canonical models:

```text
moa_models()
```

Delegate with explicit models selected by Codex:

```text
moa_delegate(
  task="Review this migration and implement the safest fix",
  cwd="/path/to/repo",
  assignments=[
    {"model": "kimi-k3", "role": "architect"},
    {"model": "GLM-5.3", "role": "executor"},
    {"model": "DeepSeek-flash", "role": "auditor"}
  ]
)
```

Run a read-only review:

```text
moa_run(task="Review the parser changes", cwd="/path/to/repo", mode="review", stakes="medium")
```

Run a DeepSeekHarness audit:

```text
moa_audit(task="Audit the current diff", cwd="/path/to/repo", deep=false)
```

Check current pricing policy:

```text
moa_schedule()
```

## Captain model

Codex keeps the model selected by the user. Pass `captainModel` only when the active page-level model is known; otherwise `moa_captain` reports the opaque `codex-selected` identity instead of guessing from global configuration. Codex MOA never overrides the Codex main model.

The captain is not restricted to GPT or the OpenAI provider. Persistent orchestration modes are `off`, `auto` (default), and `force`; see `docs/MODES.md`. Canonical commands are `$codex-moa on|off|auto|status`; `$codex-moa <task>` is a one-task force override. Use `$codex-moa optimize` for proposal-first self-optimization.

## Async jobs

Long runs can start in the background and survive the MCP request boundary:

```text
moa_start(task="...", cwd="/repo", assignments=[...])
moa_job_status(jobId="job-...")
moa_job_wait(jobId="job-...", timeoutMs=10000)
moa_job_steer(jobId="job-...", message="New constraint")
moa_job_cancel(jobId="job-...", reason="superseded")
moa_job_notify(jobId="job-...")
moa_job_ack(jobId="job-...")
```

Job state is persisted under `~/.codex-moa/jobs/<job-id>/`. The worker process owns the run; the MCP server only starts, observes, waits, or requests cancellation. Async jobs reject per-seat `env` values so credentials are not persisted; use provider configuration or synchronous `moa_run` for seat-local environment variables.

`moa_start` also returns an `interaction` handoff contract. While a job is active, the captain should report the job ID and yield the Codex foreground turn instead of polling repeatedly or continuing substantial local work. One wait may last at most 10 seconds. Later constraints should use `moa_job_steer`. The worker binds the origin `CODEX_THREAD_ID` and sends terminal continuation through the official `codex queue` command. `delivered` means the daemon accepted the message; `acknowledged` means the captain actually handled it. Failed delivery is durable and can be retried with `moa_job_notify`.

## Retention and compaction

Plan or apply retention for blackboard runs, jobs, managed worktrees, cost ledger, and routing history:

```bash
npm run retention
npm run retention -- --apply --write
```

```text
moa_retention(action="plan")
moa_retention(action="apply", allowWrite=true, dryRun=false)
```

Managed worktrees are only pruned when clean by default. Active jobs and running seats are always protected.

## Patch acceptance metrics

Worktree check/apply/revert operations record outcomes:

```text
moa_patch_metrics()
npm run patch:metrics
```

Metrics include apply acceptance rate, failure/conflict rate, revert rate, and per-seat/per-model patch performance.

## Provider recovery

Provider circuits open after repeated failures, classify auth/rate-limit/timeout/provider errors, and track p50/p95 latency:

```text
moa_provider_recovery(action="status")
moa_provider_recovery(action="probe", providers=["zai"], force=false)
npm run provider:recovery -- --probe
```

Half-open providers are probed automatically by `moa_provider_recovery` or `moa_health(probeProviders=true)` and close after a successful probe.

## Budget enforcement

Task-level budgets can stop a DAG before downstream layers or repair rounds continue:

```text
moa_run(
  task="...",
  cwd="/repo",
  budget={
    "enforce": true,
    "maxTokens": 2000000,
    "maxEstimatedUsd": 20,
    "maxDurationMs": 3600000,
    "maxContextUsed": 500000
  }
)
```

Budget checks happen before each DAG layer and before repair rounds. Already-running seats are allowed to finish; unstarted nodes are marked blocked with `budgetExceeded` details.

## Provider health routing

Automatic plans avoid providers marked `critical` or `inactive`. A healthy model with the same tier is selected when available; otherwise dispatch is refused unless `allowUnhealthy=true` is set. Explicit assignments are never silently rerouted.

## Structured results and repair

Execution and audit seats are parsed into structured results. Auditor `block` findings are normalized into `P0/P1/P2` findings and can trigger a bounded repair round:

```text
Round 1: executor → auditor(block)
Round 2: executor receives findings → auditor re-checks
```

The final Navigator review consumes structured findings, parse errors, conflict markers, and partial writes. Checkpoint nodes retain per-round result history.

## Worktree lifecycle

Inspect worktree state and patches:

```text
moa_worktrees(action="list", cwd="/repo")
moa_worktrees(action="inspect", path="/path/to/worktree")
moa_worktrees(action="check_patch", cwd="/repo", patchPath="/path/to/change.patch")
```

Mutating actions require `allowWrite=true`:

```text
moa_worktrees(action="apply_patch", cwd="/repo", patchPath="...", allowWrite=true)
moa_worktrees(action="revert_patch", cwd="/repo", patchPath="...", allowWrite=true)
moa_worktrees(action="remove", path="...", allowWrite=true, force=false)
moa_worktrees(action="prune", cwd="/repo", dryRun=true)
```

Worktree inspection includes tracked and untracked files, conflict markers, binary diff size, and `partialWrite` when a failed/cancelled seat left changes.

## Persistent ACP runtime

Seats can opt into persistent ACP processes with `runtime="acp"` for KimiCode and DSH. ZCode does not expose ACP natively, so codex-moa bridges the ZCode Protocol `app-server` into the same seat contract.

```bash
npm run acp:smoke -- --harness all --json
npm run acp:smoke -- --harness dsh
```

## Runtime governance

Seat Registry, worktree isolation, Context Pack, Navigator review, memory distillation, DAG checkpoint/resume, cost ledger, provider health, and cancellation are available. See `docs/RUNTIME.md`.

```bash
npm run health
npm run dashboard
npm run control -- status
npm run control -- cancel --task-id TASK_ID --seat SEAT_ID
```

## Durable memory

Use `memoryKey` or `continuityKey` to persist decisions, facts, files, tests, failed attempts, and episodes outside the model context. See `docs/MEMORY.md`.

## Context, limits, and continuity

Balanced context/output budgets and continuity keys are supported. See `docs/LIMITS.md` and `docs/CONTINUITY.md`.

## Reasoning effort

Reasoning effort is selected per sub-agent and can be explicit or task-policy driven:

```bash
npm run ccswitch:reasoning
```

CC Switch is the single source of truth for Kimi/GLM and optional DeepSeek models routed through Pi. The exact configured
Pi provider card supplies credentials, provider/model IDs, selectable reasoning/default, extended
thinking, context/output limits, and image input. `config/models.json` is only a fallback when the
card is unavailable (`CODEX_MOA_NO_CCSWITCH=1` also skips the overlay). DeepSeekHarness is the
explicit exception and keeps its own provider/profile configuration. See `docs/REASONING.md` for
provider mappings and enforcement channels. CC Switch metadata gaps are **reported, never patched**:
`npm run ccswitch:patch-reasoning` is a read-only audit (codex-moa never writes CC Switch — provider
cards, database, catalog, or skills).

Reasoning selection priority is: explicit assignment, task/vendor policy, then provider default.
Set `reasoning.mode` in `config/evolution.json` or the approved user overlay to `task-aware` or
`provider-default`. Self-optimization groups evidence by model, Harness, and effective effort and
rejects proposals that are incompatible with the current capability table.

To make a Codex main-model reasoning level survive CC Switch provider switches, change it **in CC Switch** (provider card
or 通用配置). `npm run ccswitch:codex-effort -- --provider DeepSeek --effort max` only reports the difference between the
card and the live `config.toml`; it refuses to write either one.

## Controlled self-evolution

Use the English Skill commands for a proposal-first workflow:

```text
$codex-moa optimize
$codex-moa optimize status
$codex-moa optimize show <proposal-id>
$codex-moa optimize approve <proposal-id>
$codex-moa optimize apply <proposal-id>
$codex-moa optimize rollback <proposal-id>
```

Approval and apply are separate exact-ID gates. Equivalent terminal commands remain available:

```bash
npm run evolve:status
npm run evolve:propose
```

Only the user-level `~/.codex-moa/evolution-policy.json` overlay can be auto-applied in v1; it survives upgrades. Code changes remain recommendations for human/Codex implementation.

## CC Switch integration

CC Switch remains the source of truth for provider/model profiles and Skill enablement:

```bash
npm run ccswitch:snapshot
npm run ccswitch:skill:write
```

The plugin reads CC Switch metadata and never edits `cc-switch.db`.

## Quota visibility

```bash
npm run quota
npm run health
```

This refreshes KimiCode, Z.ai/GLM, and DeepSeek quota into `~/.codex-moa/quota.json`.

For macOS menu-bar and Notch visibility, install the included ClaudeBar extension:

```bash
npm run claudebar:install:write
```

Then restart ClaudeBar. The extension is self-contained and does not require a project-root setting.

## Design lineage and credits

This project is an independent Codex-native orchestration runtime. Its design borrows concepts from open-source agent infrastructure and from the author's own MoA experiments.

### Author's prior projects

- [pi-moa](https://github.com/Flipped929/pi-moa): double-plane captain/governance design, role-based dispatch, structured task/result cards, Navigator review, guard boundaries, and cost-tiered execution.
- [dsh-moa](https://github.com/Flipped929/dsh-moa): persistent seats, roster-style role files, subscription-first model routing, cross-family auditing, asynchronous Navigator checks, result-card persistence, redaction, and provider/cost visibility.
- DeepSeekHarness (`dsh`): its profile, session, tool, permission, and ACP behaviors informed the DSH adapter, persistent session handling, and headless audit profile design.

### Open-source projects and specifications

- [Agent Client Protocol (ACP)](https://agentclientprotocol.com/) and `@agentclientprotocol/sdk`: native KimiCode/DSH session execution, updates, resume, and cancellation.
- [Model Context Protocol (MCP)](https://modelcontextprotocol.io/) and `@modelcontextprotocol/sdk`: the Codex-facing tool surface.
- [OpenAI Codex](https://github.com/openai/codex): plugin/MCP integration patterns and the captain-centric workflow.
- KimiCode CLI and ZCode app-server: seat execution, session semantics, and Model/Agent protocol behavior.
- [ClaudeBar](https://github.com/tddworks/ClaudeBar): extension manifest and probe model used for menu-bar/Notch visibility.
- [CC Switch](https://github.com/farion1231/cc-switch): source-of-truth metadata for provider/model profiles and Skill enablement.
- `ccusage` and related local token monitors: conceptual reference for local-first cost and usage accounting. Codex MOA keeps provider quota/health checks separate from local token estimates.

No source project is treated as authoritative over Codex's final verification. External agents remain untrusted workers, and every borrowed mechanism is reimplemented behind the local MCP/runtime contracts in this repository.

## Safety

- Codex remains the final writer.
- Auditors are read-only.
- External executors use isolated worktrees.
- Secrets are stripped from child-process environments unless explicitly allowlisted.
- Commands use `spawn` with `shell: false`.
- Logs and artifacts are redacted.
