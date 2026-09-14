#!/usr/bin/env node
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { runCommand } from "../src/lib/process.mjs";

const args = new Set(process.argv.slice(2));
const write = args.has("--write");
const force = args.has("--force");
const dshHome = process.env.DSH_HOME ? resolve(process.env.DSH_HOME) : join(homedir(), ".dsh");
const dshCommand = process.env.DSH_COMMAND || "dsh";

const patch = `# Managed by codex-moa. Audit profiles are read-only and cannot recurse into subagents.
- id: agent-default-model
  config:
    provider: deepseek-official
    model: deepseek-flash
    reasoningEffort: max
- id: sandbox-policy
  config:
    mode: read-only
    workspaceRoot: !!js process.cwd()
- id: approval
  config:
    policy: never
- id: tool-subagent
  disabled: true
- id: tool-subagent-fork
  disabled: true
- id: tool-workflow
  disabled: true
- id: tool-ralph
  disabled: true
`;

const profiles = ["codex-dsh-audit-fast", "codex-dsh-audit-deep"];

for (const profile of profiles) {
  const profileDir = join(dshHome, "profiles", profile);
  const patchPath = join(profileDir, "cordis.patch.yml");
  console.log(`${write ? "write" : "plan"}: ${profile} -> ${profileDir}`);
  if (!write) continue;

  if (!existsSync(profileDir)) {
    mkdirSync(profileDir, { recursive: true });
    const init = await runCommand({
      command: dshCommand,
      args: ["--profile", profile, "--from-default-profile", "headless", "--help"],
      cwd: process.cwd(),
      timeoutMs: 30000,
      stripSecretEnv: true
    });
    if (!init.ok) {
      console.error(init.stderr || init.stdout);
      process.exit(1);
    }
  }

  if (existsSync(patchPath) && !force) {
    console.log(`skip: ${patchPath} already exists (use --force to replace)`);
    continue;
  }
  writeFileSync(patchPath, patch, "utf8");
  console.log(`updated: ${patchPath}`);
}

if (!write) {
  console.log("\nDry run only. Re-run with --write to create/update these DSH profiles.");
}
