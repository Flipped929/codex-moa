# Codex Upgrade Safety

`codex-moa` is designed so that a Codex upgrade can disable the plugin at worst, but should not make Codex itself unusable.

## Compatibility boundaries

- The plugin uses only the public Codex plugin manifest, Skill discovery, and standard MCP stdio.
- It does not patch Codex binaries, configuration internals, thread storage, or app-server internals.
- It does not register Codex hooks.
- The MCP server is bundled into `mcp/server.bundle.mjs`; it does not depend on the Codex installation directory.
- External-agent failures are returned as MCP tool errors and do not crash the MCP process.
- Unexpected MCP process failures are logged and exit only that process.

## After upgrading Codex

Run:

```bash
cd /path/to/codex-moa
npm run upgrade-check
```

The check verifies:

- Node.js version.
- plugin manifest readability and minimal schema.
- no `hooks` field.
- Skill presence.
- bundled MCP server presence.
- MCP `--health` startup.
- current Codex CLI version.
- whether `codex-moa` is currently installed.

If the plugin is missing after an upgrade:

```bash
codex plugin marketplace add /path/to/codex-moa/dev-marketplace
codex plugin add codex-moa@codex-moa-local
```

Start a new Codex task after reinstalling.

## If the plugin is broken

Codex should remain usable. To remove or disable the plugin:

```bash
codex plugin remove codex-moa@codex-moa-local
```

Alternatively, disable it in the Codex plugin configuration and restart Codex.

## Version and cache behavior

- Use semantic plugin versions for meaningful releases.
- For local iterations without a release bump, use the plugin-creator cachebuster helper:

```bash
python3 "$CODEX_HOME/skills/.system/plugin-creator/scripts/update_plugin_cachebuster.py" \
  /path/to/codex-moa
```

Then reinstall:

```bash
codex plugin add codex-moa@codex-moa-local
```

## Compatibility risks

| Risk | Mitigation |
|---|---|
| Codex plugin manifest schema changes | Keep the manifest minimal and avoid optional unsupported fields. |
| MCP protocol changes | Use the standard SDK transport and test handshake after upgrades. |
| Plugin cache changes | Reinstall from the local marketplace. |
| External CLI changes | `moa_doctor` detects versions and capabilities. |
| Node runtime changes | Require Node.js 20+, check at startup and in upgrade-check. |
| MCP server crash | Isolate errors, exit only the MCP child process, keep Codex running. |
