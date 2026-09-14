# Quota Monitoring and Routing

## What each provider exposes

| Provider | Source | Credential | Endpoint |
|---|---|---|---|
| KimiCode | Coding Plan usage | `KIMI_CODE_API_KEY` or DSH credential | `https://api.kimi.com/coding/v1/usages` |
| Z.ai / GLM | Coding Plan quota | `ZAI_CODING_CN_API_KEY` or compatible environment variable | `https://open.bigmodel.cn/api/monitor/usage/quota/limit` |
| DeepSeek | Account balance | `DEEPSEEK_API_KEY` | `https://api.deepseek.com/user/balance` |

The plugin also reads credentials already managed by:

- DeepSeekHarness: `~/.dsh/.credentials.yaml`
- KimiCode: `~/.kimi-code/credentials/kimi-code.json`
- ZCode: provider keys in `~/.zcode/v2/config.json`

Credentials are never included in tool output.

## Codex MOA tools

Refresh and inspect quota:

```text
moa_quota(refresh=true)
```

Plan with quota context:

```text
moa_plan(task="...", stakes="high")
```

Delegate with quota enforcement:

```text
moa_delegate(
  task="...",
  cwd="/path/to/repo",
  respectQuota=true,
  assignments=[
    {"model": "kimi-k3"},
    {"model": "GLM-5.3"},
    {"model": "DeepSeek-flash"}
  ]
)
```

`respectQuota` defaults to true. A model whose chosen quota window is already depleted is rejected unless `allowDepleted` is set.

## Cost ledger and provider health

Every completed seat writes a cost-ledger entry to `~/.codex-moa/cost-ledger.jsonl` with:

- input/output/reasoning/cache token usage when the harness exposes it
- ACP context usage (`contextUsed` / `contextWindow`) when a harness emits `usage_update`
- duration and terminal status
- provider quota context
- optional estimated USD cost when `config/pricing.local.json` defines rates

Provider health combines quota status, low remaining windows, and recent seat failures:

```text
moa_health()
npm run health
```

`healthy`, `warning`, `critical`, and `inactive` are reported per provider. The overall result is the worst provider state.

Provider circuits add consecutive-failure breaking, p50/p95 latency, error classification, exponential backoff, and half-open recovery probes. Automatic plan seats avoid `critical`/`inactive` providers and prefer a healthy same-tier model. If no healthy replacement exists, dispatch is refused unless `allowUnhealthy=true`. Explicit model assignments are not silently rerouted.

## macOS visibility

The recommended UI is [ClaudeBar](https://github.com/tddworks/ClaudeBar), a native macOS menu bar and Notch application with built-in quota providers and a user extension API.

The ClaudeBar extension renders four sections: provider quotas, runtime/cost metrics, Navigator/provider status, and cost usage. Its Dashboard link opens the local control plane at `http://127.0.0.1:3737` when `npm run dashboard` is running.

A ready-to-use ClaudeBar extension lives at:

```text
integrations/claudebar/codex-moa/
```

Install it:

```bash
npm run claudebar:install:write
```

Restart ClaudeBar afterwards.

## Project comparison

| Project | Stars | Role |
|---|---:|---|
| `ccusage` | ~18.5k | Local token/cost accounting; does not prove remaining vendor quota. |
| `Javis603/token-monitor` | ~2.1k | Broadest local-first usage widget and useful live quota reference implementation. |
| `tddworks/ClaudeBar` | ~1.5k | Best native macOS menu bar + Notch UI for Kimi, DeepSeek, Z.ai and extensions. |
| `MioMioOS/MioIsland` | ~541 | AI coding agent Dynamic Island, but mostly Claude/Codex. |
| `shobhit99/SuperIsland` | ~660 | General Dynamic Island extension framework. |

Star count alone is not enough: `ccusage` has the most stars but is not a live Coding Plan quota source. `ClaudeBar` is the best fit for visible macOS quota because it already supports the providers and Notch Live Activity.

## Failure behavior

- A provider quota error marks that provider `unavailable`.
- Other providers remain usable.
- Missing quota data does not block plugin startup.
- Depleted quota blocks dispatch only when a quota snapshot exists and `respectQuota` is enabled.
