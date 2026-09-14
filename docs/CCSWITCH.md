# CC Switch Integration

CC Switch is treated as the source of truth for provider/model profiles, upstream API format, Skill enablement, reasoning metadata, and context/output limits.

## CC Switch 3.20.3 routing rule

CC Switch 3.20.3 moves the official Codex presets for Kimi, GLM, DeepSeek, Qwen, MiniMax, MiMo, and LongCat to native OpenAI Responses endpoints. These providers no longer need the local Responses-to-Chat routing layer.

Local routing is still required only when the upstream exposes Chat Completions or Anthropic Messages and must be converted to Responses. Existing provider cards are snapshots: re-import the preset or change `上游格式 / Upstream Format` to `Responses` to remove stale conversion metadata.

`codex-moa` therefore uses two rules:

1. Prefer native Responses direct mode when `apiFormat = openai_responses`, `wire_api = responses`, and the base URL is not loopback.
2. Keep local-routing compatibility when the upstream is Chat Completions or Anthropic Messages.

The plugin never changes Codex's selected captain model or enables/disables CC Switch takeover automatically.

## Read-only integration

`codex-moa` reads:

- `~/.cc-switch/settings.json`
- `~/.cc-switch/cc-switch.db`
- `~/.codex/config.toml` to classify the live transport only

It reads these tables:

- `providers` for provider metadata, current selections, API format, live transport, and model hints.
- `skills` for Skill inventory and Codex/Claude enablement flags.

It never exposes credentials from the database or copies CC Switch secrets into the quota snapshot or MCP output.

## Routing audit

Run:

```bash
npm run ccswitch:routing
```

The report distinguishes:

- `direct_ready`: native Responses direct mode; no local routing needed.
- `metadata_stale`: the card points to a Responses endpoint but still carries old Chat conversion metadata.
- `proxy_required`: the upstream is still Chat Completions or Anthropic Messages.
- `proxy_managed`: the live Codex config still points to `127.0.0.1` or carries `PROXY_MANAGED`.

`moa_ccswitch`, `moa_models`, and `moa_doctor` include the same audit. `codex-moa` reports routing problems but does not rewrite live Codex configuration.

## Model bindings

`moa_models` and `moa_ccswitch` map the five canonical models to matching CC Switch providers:

- Kimi K3 and Kimi 2.8
- GLM-5.3 and GLM-5.3-flash
- DeepSeek V4.1 Flash (`DeepSeek-flash`)

CC Switch is authoritative for provider profiles, credentials, transport, and model availability. `config/models.json` remains a capability map from canonical model IDs to harnesses; it is not a second credential store.

`codex-moa` applies the selected model through each harness's native mechanism:

- KimiCode: `-m`
- ZCode: synchronized provider/model in `~/.zcode/cli/config.json`
- DeepSeekHarness: dedicated audit profile

## Skill integration

The plugin bundles `skills/moa` and uses it directly. To make the same Skill visible in CC Switch:

```bash
npm run ccswitch:skill
npm run ccswitch:skill:write
```

The second command creates:

```text
~/.cc-switch/skills/codex-moa -> ~/Projects/codex-moa/skills/moa
```

Open CC Switch and enable `codex-moa` for Codex. The script intentionally does not edit `cc-switch.db`; CC Switch owns Skill enablement and synchronization.

## Snapshot

Generate a read-only snapshot:

```bash
npm run ccswitch:snapshot
```

It writes:

```text
~/.codex-moa/ccswitch.json
```

The snapshot contains no API keys or tokens.

## Reasoning and limit metadata

Audit:

```bash
npm run ccswitch:reasoning
npm run ccswitch:limits
```

Apply metadata fixes idempotently with a database backup:

```bash
npm run ccswitch:patch-metadata
npm run ccswitch:patch-metadata:write
```

The patch updates only provider reasoning/limit metadata and known official Codex transport metadata. It does not change credentials, provider selection, the selected captain model, or live Codex configuration.
