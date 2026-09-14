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
- reasoning-effort policy by task, role, stakes, and quota
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

Generate proposals:

```text
moa_evolve(action="propose")
```

Review from MCP:

```text
moa_evolve(action="list")
moa_evolve(action="get", proposalId="evo-...")
```

Approval, apply, and rollback are deliberately unavailable from MCP. They must be run by the user in a terminal.

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
- Applied files are backed up.
- Proposal and applied states are persisted.
- Rollback restores the exact previous file.
- No shell code is executed by the proposal application layer.
- Evolution cannot change credentials, permissions, or Codex itself.
