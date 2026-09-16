#!/usr/bin/env node
import { cp, mkdtemp, mkdir, readdir, rm } from "node:fs/promises";
import { existsSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { basename, join } from "node:path";
import { spawnSync } from "node:child_process";

const pluginName = "codex-moa";
const marketplace = "personal";
const cacheRoot = join(homedir(), ".codex", "plugins", "cache", marketplace, pluginName);
const backupRoot = await mkdtemp(join(tmpdir(), "codex-moa-cache-compat-"));

async function versionDirectories(root) {
  if (!existsSync(root)) return [];
  return (await readdir(root, { withFileTypes: true }))
    .filter((entry) => entry.isDirectory())
    .map((entry) => join(root, entry.name));
}

const previous = await versionDirectories(cacheRoot);
let result;
try {
  for (const source of previous) await cp(source, join(backupRoot, basename(source)), { recursive: true });

  result = spawnSync("codex", ["plugin", "add", `${pluginName}@${marketplace}`, "--json"], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"]
  });
} finally {
  await mkdir(cacheRoot, { recursive: true });
  for (const source of await versionDirectories(backupRoot)) {
    const destination = join(cacheRoot, basename(source));
    if (!existsSync(destination)) await cp(source, destination, { recursive: true });
  }
  await rm(backupRoot, { recursive: true, force: true });
}

if (result?.status !== 0) {
  process.stderr.write(result?.stderr || result?.stdout || `codex plugin add exited ${result?.status ?? "without status"}\n`);
  process.stderr.write(`Restored ${previous.length} prior cache version(s) after the failed install.\n`);
  process.exitCode = result?.status || 1;
} else {
  process.stdout.write(result.stdout);
  process.stdout.write(`Preserved ${previous.length} prior cache version(s) for active-session MCP compatibility.\n`);
}
