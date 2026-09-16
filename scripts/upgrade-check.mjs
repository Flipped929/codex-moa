#!/usr/bin/env node
import { readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { runCommand } from "../src/lib/process.mjs";

const root = process.cwd();
const checks = {};

async function commandCheck(name, command, args, required = false) {
  const result = await runCommand({ command, args, cwd: root, timeoutMs: 15000 });
  checks[name] = {
    ok: result.ok,
    required,
    version: (result.stdout || result.stderr || "").trim().split(/\r?\n/)[0] || null,
    output: result.stdout || result.stderr || "",
    error: result.ok ? null : (result.stderr || `exit ${result.code}`).trim()
  };
  return result;
}

const nodeMajor = Number(process.versions.node.split(".")[0]);
checks.node = { ok: nodeMajor >= 20, required: true, version: process.versions.node };
checks.bundle = { ok: existsSync(join(root, "mcp/server.bundle.mjs")), required: true };
checks.skill = { ok: existsSync(join(root, "skills/moa/SKILL.md")), required: true };

let manifest = null;
try {
  manifest = JSON.parse(await readFile(join(root, ".codex-plugin/plugin.json"), "utf8"));
  checks.manifest = {
    ok: manifest.name === "codex-moa" && typeof manifest.version === "string" && !("hooks" in manifest),
    required: true,
    version: manifest.version,
    usesHooks: "hooks" in manifest
  };
} catch (error) {
  checks.manifest = { ok: false, required: true, error: error.message };
}

const codex = await commandCheck("codexCli", "codex", ["--version"], false);
await commandCheck("claudeCli", "claude", ["--version"], false);
await commandCheck("piCli", "pi", ["--version"], false);
await commandCheck("codexPluginList", "codex", ["plugin", "list"], false);
if (checks.codexPluginList.ok) {
  checks.codexPluginList.installed = checks.codexPluginList.output.includes("codex-moa");
delete checks.codexCli.output;
delete checks.claudeCli.output;
delete checks.piCli.output;
delete checks.codexPluginList.output;
}

let health = null;
if (checks.bundle.ok) {
  const healthRun = await runCommand({
    command: process.execPath,
    args: ["mcp/server.bundle.mjs", "--health"],
    cwd: root,
    timeoutMs: 10000
  });
  try {
    health = JSON.parse(healthRun.stdout);
    checks.mcpHealth = { ok: healthRun.ok && health.plugin === "codex-moa", required: true, report: health };
  } catch (error) {
    checks.mcpHealth = { ok: false, required: true, error: healthRun.stderr || error.message };
  }
} else {
  checks.mcpHealth = { ok: false, required: true, error: "bundle missing" };
}

const coreOk = Object.values(checks)
  .filter((check) => check.required)
  .every((check) => check.ok);
const report = {
  ok: coreOk,
  codexVersion: codex.stdout?.trim() || null,
  pluginVersion: manifest?.version ?? null,
  checks,
  warnings: [
    checks.codexPluginList.installed ? null : "codex-moa is not currently listed as installed; reinstall after upgrades if needed."
  ].filter(Boolean)
};

console.log(JSON.stringify(report, null, 2));
process.exit(coreOk ? 0 : 1);
