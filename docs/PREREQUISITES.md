# Prerequisites

## 1. Runtime

- macOS.
- Node.js 20 or newer.
- npm.
- Git, for isolated worktrees.
- Codex with plugin and MCP support.

Verify:

```bash
node --version
npm --version
codex --version
```

## 2. KimiCode

Required for architecture, long context, vision, and second opinions.

```bash
kimi --version
kimi provider list
```

The default Kimi adapter uses OAuth-managed KimiCode configuration. Do not duplicate credentials into this project unless a custom provider requires an environment variable.

## 3. ZCode

Required for GLM-backed coding execution.

Default path:

```text
/Applications/ZCode.app/Contents/Resources/glm/zcode.cjs
```

Verify:

```bash
node /Applications/ZCode.app/Contents/Resources/glm/zcode.cjs --version
```

Open ZCode once and configure at least one Anthropic-compatible provider. Codex MOA reads the desktop provider configuration and synchronizes the selected model into `~/.zcode/cli/config.json`.

ZCode `start-plan` providers require an interactive GUI captcha for each model request. They cannot be used by a headless ACP bridge. Keep the UI plan if you use ZCode interactively, and set a separate API-key provider only for codex-moa:

```json
{
  "zcode": {
    "headlessProvider": "builtin:bigmodel-coding-plan"
  }
}
```

`zcode.headlessProvider` takes precedence for codex-moa without changing the ZCode UI default. codex-moa uses `zcode.headlessHome` (default `~/.codex-moa/zcode-home`) for its CLI config and symlinks shared credentials from the real `~/.zcode/v2` directory. Use `zcode.provider` only when you intentionally want to force the same provider everywhere.

## 4. DeepSeekHarness

Required for independent audits.

```bash
dsh --version
dsh --profile headless --help
```

Before enabling DSH audits, run a small smoke test:

```bash
dsh --profile headless "reply with exactly: ok"
```

## 5. ACP smoke test

After all three harnesses are authenticated, verify the real runtime paths:

```bash
npm run acp:smoke -- --harness all --json
```

Expected transport behavior:

- KimiCode and DSH use native ACP.
- ZCode is bridged through `zcode app-server` and ZCode Protocol.
- A provider-side authentication, captcha, quota, or model error is reported as `auth_required` or `provider_error` rather than being mistaken for a transport success.


## 6. Dedicated DSH audit profiles

The project includes:

```bash
node scripts/setup-dsh-profiles.mjs
```

This is a dry run. To create the profiles:

```bash
node scripts/setup-dsh-profiles.mjs --write
```

Profiles created:

- `codex-dsh-audit-fast`
- `codex-dsh-audit-deep`

Both are read-only, use `deepseek-official/deepseek-flash`, auto-deny approvals, and disable recursive subagents/workflows.

After creation, update `config/local.json`:

```json
{
  "profiles": {
    "dsh": {
      "fast": "codex-dsh-audit-fast",
      "deep": "codex-dsh-audit-deep"
    }
  }
}
```

## 7. Codex plugin installation

The project is a valid Codex plugin. Install it through a local or Git marketplace after development is complete.

Do not install it until the plugin and external commands pass `npm test`, `npm run doctor`, and the plugin validator.

## 8. Workspace policy

Code-writing seats must use isolated git worktrees:

```bash
git worktree add /path/to/worktrees/zcode -b moa/zcode-task
```

Never let KimiCode and ZCode write the same directory concurrently.

## 9. Credentials and privacy

- Never put API keys in prompts.
- Never commit `config/local.json`.
- Do not send proprietary or regulated source code to an external provider without authorization.
- Review each provider's terms, data policies, quota rules, and rate limits.
