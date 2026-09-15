# Routing Policy

| Level | Task | Seats |
|---|---|---|---|
| L0 | Simple explanation or small edit | Codex only |
| L1 | Routine implementation | ZCode fast executor |
| L2 | Refactor, debugging, tests, review | ZCode deep executor + DSH auditor |
| L3 | Security, architecture, migration, high stakes | ZCode + Kimi architect + DSH deep auditor |
| Vision | UI, screenshots, images | Add Kimi vision seat |

## Scheduling

DeepSeek peak hours in Asia/Shanghai are weekdays 09:00-12:00 and 14:00-18:00. Prefer flexible DeepSeek-backed audits outside those windows; during peak, DeepSeekHarness may use a Kimi or GLM provider route.

The GLM night campaign is temporary and currently applies to GLM-5.3-Flash from 23:00 to 09:00 Asia/Shanghai. Prefer ZCode + GLM-5.3-Flash for batch work during this window. Campaign dates are configuration, not hard-coded policy.

## Cost discipline

- Use fast seats for drafts, summaries, and routine code.
- Escalate to deep seats only for difficult or high-stakes work.
- Cap seats per run and rounds per task.
- Do not retry a partially applied code change with another model until the diff has been inspected.


## Explicit model map

| Model | Native Harness | Also supported | Default role |
|---|---|---|
| `kimi-k3` | KimiCode | DeepSeekHarness | architect, vision, research |
| `kimi-2.8` | KimiCode | DeepSeekHarness | fast analysis and triage |
| `GLM-5.3` | ZCode | DeepSeekHarness | deep coding and repair |
| `GLM-5.3-flash` | ZCode | DeepSeekHarness | routine and batch coding |
| `DeepSeek-flash` | DeepSeekHarness | — | audit and verification |

ZCode receives the model through `~/.zcode/cli/config.json`, not a CLI flag. KimiCode receives it through `-m`. DSH receives the provider/model pair through an isolated `$DSH_HOME/settings.yaml`; the source settings and credentials are not modified.
