# Controlled Self-Evolution

`codex-moa` can evolve its own routing and audit policy, but only through a human-approved proposal workflow.

## Core rule

```text
observe -> propose -> report -> user approval -> apply -> evaluate -> keep or rollback
```

No proposal is applied automatically. No model may silently rewrite code or policy.

## What can evolve in v1

Only the user-level overlay:

```text
~/.codex-moa/evolution-policy.json
```

The plugin ships defaults in `config/evolution.json`. The user-level policy is merged on top and survives plugin reinstall or Codex upgrades. The policy controls:

- captain-family-aware audit routing
- preferred cross-family auditors
- timeout budgets
- reasoning-effort mode and policy by model, task, role, stakes, and quota
- quota and routing thresholds

Source-code changes are reported as recommendations but are not auto-applied in v1.

## Event and proposal store

```text
~/.codex-moa/evolution/
  events.jsonl
  outcomes.jsonl
  proposals/
  backups/
```

`runMoA` records task events automatically. Codex or the user records task outcomes:

```text
moa_evolve(action="record", taskId="...", accepted=true, testsPassed=true, quality=9)
```

For staged review, use `stage="plan"`, `"execution"`, `"audit"`, or `"final"`. Automatic DAG-layer evidence is retained in each task checkpoint. Evolution analysis joins final captain outcomes to executor routes within the same complexity level and requires sufficient completion, acceptance, tests, and quality evidence before cost, latency, or TPS can influence a proposal.

Generate proposals:

```text
moa_evolve(action="propose")
```

Review from MCP:

```text
moa_evolve(action="list")
moa_evolve(action="get", proposalId="evo-...")
```

The canonical Skill command is:

```text
$codex-moa optimize
```

It analyzes evidence and creates or reuses proposals; it never applies them. Active proposals with the same policy patch are deduplicated. Reliability rates based on fewer than three runs are descriptive only and cannot drive automatic routing changes.
Unapproved proposals expire after 30 days so stale recommendations cannot be applied accidentally.

Audit optimization additionally reads `~/.codex-moa/audit-metrics.jsonl`. Pair and Harness changes require at least five audit runs plus captain adjudication evidence. Completion, useful findings, false positives, critical-path latency, and cost are evaluated before TPS; shadow audit failures never count as gate failures.

Failure-aware optimization reads `~/.codex-moa/failures.jsonl`. It preserves redacted failure signatures and route recoveries so proposals do not recommend a model/Harness combination with an active deterministic or repeated-transient guard.

Reasoning optimization is capability-gated. Metrics are separated by
`model@harness@effective-effort`, and proposals are checked against the current CC
Switch/vendor capability table both when created and when applied. A stale proposal
that names an unavailable effective effort is rejected instead of silently remapped.

Review and control a proposal with separate, explicit commands:

```text
$codex-moa optimize status
$codex-moa optimize show <proposal-id>
$codex-moa optimize approve <proposal-id>
$codex-moa optimize reject <proposal-id>
$codex-moa optimize apply <proposal-id>
$codex-moa optimize rollback <proposal-id>
```

Approval and application remain separate gates. Codex may call the gated MCP actions only when the user authored the matching exact English command containing the exact proposal ID.

## CLI

```bash
npm run evolve:status
npm run evolve:propose

CODEX_MOA_EVOLUTION_CONFIRM="APPROVE evo-..." \
  node scripts/evolve.mjs approve evo-...

CODEX_MOA_EVOLUTION_CONFIRM="APPLY evo-..." \
  node scripts/evolve.mjs apply evo-...

CODEX_MOA_EVOLUTION_CONFIRM="ROLLBACK evo-..." \
  node scripts/evolve.mjs rollback evo-...
```

## Projects worth borrowing from

| Project | Stars | Useful idea |
|---|---:|---|
| [EvoMap/evolver](https://github.com/EvoMap/evolver) | ~9.1k | Genes, Capsules, EvolutionEvents, auditability, `--review` mode |
| [OpenEvolve](https://github.com/algorithmicsuperintelligence/openevolve) | ~7.4k | benchmarked code evolution and selection |
| [Hermes Agent Self-Evolution](https://github.com/NousResearch/hermes-agent-self-evolution) | ~5.3k | DSPy/GEPA-based skill, prompt, and code optimization |
| [EvoAgentX](https://github.com/ANative-Lab/EvoAgentX) | ~3.3k | automated workflow, prompt, and tool evolution |
| [EvoX](https://github.com/EMI-Group/evox) | ~2.6k | population-based evolutionary computation primitives |
| [Darwin Gödel Machine](https://github.com/jennyzzt/dgm) | ~2.3k | empirically validated self-modifying coding agents |

EvoMap is the closest project to this requirement: it explicitly supports auditable evolution and a human review mode. EvoX is primarily an evolutionary computation framework, so it is useful for mutation/selection primitives but not as the agent architecture itself.

EvoMap is GPL-3.0/source-available. `codex-moa` borrows the concepts only and does not copy its implementation.

## Safety properties

- Human approval is mandatory.
- Approval and apply use different exact confirmations.
- Analysis/proposal never implies approval.
- Identical active policy patches are deduplicated.
- Low-sample reliability rates are descriptive only.
- Unapproved proposals expire after 30 days.
- Applied files are backed up.
- Proposal and applied states are persisted.
- Rollback restores the exact previous file.
- No shell code is executed by the proposal application layer.
- Evolution cannot change credentials, permissions, or Codex itself.
