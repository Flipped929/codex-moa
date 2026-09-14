#!/usr/bin/env node
import { existsSync, lstatSync, mkdirSync, readlinkSync, symlinkSync, unlinkSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";

const write = process.argv.includes("--write");
const force = process.argv.includes("--force");
const source = resolve("skills/moa");
const targetDir = join(homedir(), ".cc-switch", "skills");
const target = join(targetDir, "codex-moa");

if (!existsSync(source)) {
  console.error(`Skill source not found: ${source}`);
  process.exit(1);
}

if (!write) {
  console.log(JSON.stringify({ mode: "dry-run", source, target }, null, 2));
  console.log("Re-run with --write to link the Skill into cc-switch.");
  process.exit(0);
}

mkdirSync(targetDir, { recursive: true });
if (existsSync(target) || (() => { try { lstatSync(target); return true; } catch { return false; } })()) {
  const current = (() => { try { return readlinkSync(target); } catch { return null; } })();
  if (current === source) {
    console.log(JSON.stringify({ ok: true, unchanged: target, source }, null, 2));
    process.exit(0);
  }
  if (!force) {
    console.error(`Target already exists: ${target}. Use --force to replace it.`);
    process.exit(1);
  }
  unlinkSync(target);
}

symlinkSync(source, target, "dir");
console.log(JSON.stringify({ ok: true, linked: target, source }, null, 2));
console.log("Open CC Switch and enable codex-moa for Codex.");
