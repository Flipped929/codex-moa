#!/usr/bin/env node
import { existsSync, mkdirSync, readlinkSync, symlinkSync, unlinkSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";

const write = process.argv.includes("--write");
const force = process.argv.includes("--force");
const source = resolve("integrations/claudebar/codex-moa");
const targetDir = join(homedir(), ".claudebar", "extensions");
const target = join(targetDir, "codex-moa");

if (!write) {
  console.log(JSON.stringify({ mode: "dry-run", source, target }, null, 2));
  console.log("Re-run with --write to create the symlink.");
  process.exit(0);
}

mkdirSync(targetDir, { recursive: true });
if (existsSync(target)) {
  if (force) unlinkSync(target);
  else {
    console.error(`Target already exists: ${target}. Use --force to replace it.`);
    process.exit(1);
  }
}
symlinkSync(source, target, "dir");
console.log(JSON.stringify({ installed: target, source: readlinkSync(target) }, null, 2));
