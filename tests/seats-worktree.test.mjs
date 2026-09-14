import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { readSeatRegistry, upsertSeat, upsertSeatAtomic, writeSeatRegistry } from "../src/lib/seat-registry.mjs";
import { buildContextPack } from "../src/lib/context-pack.mjs";
import { applyPatch, captureWorktreeDiff, checkPatch, createWorktree, inspectWorktree, pruneWorktrees, removeWorktree, revertPatch } from "../src/lib/worktree.mjs";
import { runCommand } from "../src/lib/process.mjs";

test("persists seat registry entries", async () => {
  const root = await mkdtemp(join(tmpdir(), "codex-moa-seats-"));
  const path = join(root, "seats.json");
  const registry = { version: 1, seats: {} };
  upsertSeat(registry, "task:seat", { status: "running", model: "GLM-5.3" });
  await writeSeatRegistry(registry, path);
  const loaded = await readSeatRegistry(path);
  assert.equal(loaded.version, 2);
  assert.equal(loaded.seats["task:seat"].model, "GLM-5.3");
});

test("atomically merges concurrent seat registry updates", async () => {
  const root = await mkdtemp(join(tmpdir(), "codex-moa-seats-lock-"));
  const path = join(root, "seats.json");
  await Promise.all([
    upsertSeatAtomic(path, "task:a", { status: "running", model: "GLM-5.3" }),
    upsertSeatAtomic(path, "task:b", { status: "running", model: "DeepSeek-flash" })
  ]);
  const loaded = await readSeatRegistry(path);
  assert.equal(Object.keys(loaded.seats).length, 2);
});

test("creates isolated git worktrees and context packs", { skip: !process.env.CI && process.platform === "win32" }, async () => {
  const root = await mkdtemp(join(tmpdir(), "codex-moa-worktree-"));
  await runCommand({ command: "git", args: ["init"], cwd: root, timeoutMs: 10000 });
  await writeFile(join(root, "parser.ts"), "export function parse(value: string) { return value; }\n", "utf8");
  await runCommand({ command: "git", args: ["add", "parser.ts"], cwd: root, timeoutMs: 10000 });
  await runCommand({ command: "git", args: ["-c", "user.email=test@example.com", "-c", "user.name=Test", "commit", "-m", "init"], cwd: root, timeoutMs: 10000 });

  const context = await buildContextPack({ cwd: root, task: "fix parser", maxFiles: 5 });
  assert.ok(context.files.some((file) => file.path === "parser.ts"));

  const worktree = await createWorktree({ cwd: root, taskId: "task-1", seat: "executor" });
  assert.equal(worktree.supported, true);
  await writeFile(join(worktree.path, "parser.ts"), "export function parse(value: string) { return value.trim(); }\n", "utf8");
  await writeFile(join(worktree.path, "new-file.ts"), "export const created = true;\n", "utf8");
  const diff = await captureWorktreeDiff(worktree.path);
  assert.match(diff, /trim\(\)/);
  assert.match(diff, /new-file\.ts/);

  const state = await inspectWorktree(worktree.path, { baseCommit: worktree.baseCommit, resultStatus: "failed", diff });
  assert.equal(state.partialWrite, true);
  assert.ok(state.changedFiles.includes("parser.ts"));
  assert.ok(state.untrackedFiles.includes("new-file.ts"));

  const patchPath = join(root, "change.patch");
  await writeFile(patchPath, diff, "utf8");
  const checked = await checkPatch({ cwd: root, patchPath });
  assert.equal(checked.ok, true, checked.error);
  const applied = await applyPatch({ cwd: root, patchPath });
  assert.equal(applied.ok, true, applied.error);
  assert.match(await readFile(join(root, "parser.ts"), "utf8"), /trim\(\)/);
  const reverted = await revertPatch({ cwd: root, patchPath });
  assert.equal(reverted.ok, true, reverted.error);

  const pruned = await pruneWorktrees(root, { dryRun: true });
  assert.equal(pruned.ok, true, pruned.error);
  const removed = await removeWorktree(worktree.path, { repo: root, force: true });
  assert.equal(removed.removed, true, removed.error);
});
