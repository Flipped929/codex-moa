# CLI Harnesses

The model selected in the Codex page is always the captain. Child CLI selection never replaces it.

## Default policy

| Harness | Role | Default use |
|---|---|---|
| Pi | Primary universal child Harness | Kimi, GLM, optional DeepSeek |
| Claude Code | Secondary long-loop Harness | Explicit Kimi, GLM, or DeepSeek route |
| Codex CLI | Responses compatibility Harness | Explicit route only; OpenAI Official remains user-controlled |
| DeepSeekHarness | Independent audit | Default DeepSeek audit route |

KimiCode and ZCode remain compatibility fallbacks. Automatic routing does not consume GPT through a nested Codex CLI.

## CC Switch isolation

CC Switch remains the source of provider credentials, model ids, contexts, output limits, modalities, and reasoning metadata. Codex MOA reads it without modifying it and projects only the selected card into private runtime homes:

```text
~/.codex-moa/pi-home
~/.codex-moa/claude-homes/<provider-id>
~/.codex-moa/codex-homes/<provider-id>
```

Concurrent jobs therefore do not change the globally selected CC Switch card. Only explicitly requested Skills are projected into a child home.

## CLI upgrades

Codex MOA follows a detect-only policy. It reports missing, below-minimum, and newer available versions, but never runs an installer or package-manager mutation. Upgrade through CC Switch when it owns that installation, or through the CLI's normal package manager yourself.

```bash
npm run doctor
node scripts/doctor.mjs --latest
```

The network-backed latest-version check is opt-in. `moa_doctor(checkLatest=true)` exposes the same report.

## Capability inventory and probes

Declared matrix:

```bash
npm run ccswitch:capabilities
```

Bounded live text/tool probe:

```bash
node scripts/ccswitch-capability-probe.mjs --live --model GLM-5.3 --harness pi
```

Image probe:

```bash
node scripts/ccswitch-capability-probe.mjs --live --model DeepSeek-flash --harness pi --feature image
```

Live probes are read-only, limited to three turns, and capped at 60 seconds. Context and output maxima are configuration/vendor ceilings; the probe does not deliberately consume hundreds of thousands of tokens to stress-test those ceilings.

## Current route status

Pi and Claude Code passed text/tool probes for all five canonical models. Pi image probes passed for Kimi K3, GLM-5.3-Flash, and DeepSeek Flash.

The current third-party Codex cards remain explicit-only: Kimi and DeepSeek returned authentication failures, while GLM accepted authentication but closed the Responses stream before `response.completed`. Fix and re-probe those CC Switch cards before considering Codex CLI automatic routing.
