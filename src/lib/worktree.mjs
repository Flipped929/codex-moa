import { existsSync } from "node:fs";
import { chmod, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { homedir, tmpdir } from "node:os";
import { join, resolve, sep } from "node:path";
import { runCommand } from "./process.mjs";

function expandHome(value) {
  if (typeof value !== "string") return value;
  if (value === "~") return homedir();
  if (value.startsWith("~/")) return resolve(homedir(), value.slice(2));
  return resolve(value);
}

export async function gitRoot(cwd) {
  const result = await runCommand({ command: "git", args: ["rev-parse", "--show-toplevel"], cwd, timeoutMs: 10000 });
  return result.ok ? result.stdout.trim() : null;
}

export async function currentHead(cwd) {
  const result = await runCommand({ command: "git", args: ["rev-parse", "HEAD"], cwd, timeoutMs: 10000 });
  return result.ok ? result.stdout.trim() : null;
}

function worktreeRoot(repo) {
  const hash = createHash("sha256").update(resolve(repo)).digest("hex").slice(0, 12);
  return join(expandHome("~/.codex-moa/worktrees"), hash);
}

export async function createWorktree({ cwd, taskId, seat }) {
  const repo = await gitRoot(cwd);
  if (!repo) return { supported: false, repo: null, path: null };
  const path = join(worktreeRoot(repo), taskId, seat);
  await mkdir(join(worktreeRoot(repo), taskId), { recursive: true });
  if (existsSync(path)) return { supported: true, repo, path, baseCommit: await currentHead(repo), existing: true };
  const sourceHead = await currentHead(repo);
  const status = await runCommand({ command: "git", args: ["status", "--porcelain=v1", "--untracked-files=all"], cwd: repo, timeoutMs: 30000 });
  let snapshotCommit = sourceHead;
  let includesWorkingTree = false;
  if (status.ok && status.stdout.trim()) {
    const temporary = await mkdtemp(join(tmpdir(), "codex-moa-index-"));
    const indexPath = join(temporary, "index");
    const env = {
      GIT_INDEX_FILE: indexPath,
      GIT_AUTHOR_NAME: "Codex MOA",
      GIT_AUTHOR_EMAIL: "codex-moa@localhost",
      GIT_COMMITTER_NAME: "Codex MOA",
      GIT_COMMITTER_EMAIL: "codex-moa@localhost"
    };
    try {
      const readTree = await runCommand({ command: "git", args: ["read-tree", "HEAD"], cwd: repo, env, timeoutMs: 30000 });
      if (!readTree.ok) throw new Error(readTree.stderr || "git read-tree failed");
      const add = await runCommand({ command: "git", args: ["add", "-A", "--", "."], cwd: repo, env, timeoutMs: 120000 });
      if (!add.ok) throw new Error(add.stderr || "git add into temporary index failed");
      const tree = await runCommand({ command: "git", args: ["write-tree"], cwd: repo, env, timeoutMs: 30000 });
      if (!tree.ok || !tree.stdout.trim()) throw new Error(tree.stderr || "git write-tree failed");
      const commit = await runCommand({
        command: "git",
        args: ["commit-tree", tree.stdout.trim(), "-p", sourceHead, "-m", `codex-moa workspace snapshot ${taskId}/${seat}`],
        cwd: repo,
        env,
        timeoutMs: 30000
      });
      if (!commit.ok || !commit.stdout.trim()) throw new Error(commit.stderr || "git commit-tree failed");
      snapshotCommit = commit.stdout.trim();
      includesWorkingTree = true;
    } finally {
      await rm(temporary, { recursive: true, force: true });
    }
  }
  const result = await runCommand({
    command: "git",
    args: ["worktree", "add", "--detach", path, snapshotCommit],
    cwd: repo,
    timeoutMs: 120000
  });
  if (!result.ok && !existsSync(path)) throw new Error(result.stderr || `git worktree add failed with exit ${result.code}`);
  return { supported: true, repo, path, baseCommit: snapshotCommit, sourceHead, includesWorkingTree };
}

function parseStatus(output) {
  const lines = String(output ?? "").split(/\r?\n/).filter(Boolean);
  const changedFiles = [];
  const untrackedFiles = [];
  const deletedFiles = [];
  for (const line of lines) {
    const code = line.slice(0, 2);
    const path = line.slice(3).trim();
    if (!path) continue;
    if (code === "??") untrackedFiles.push(path);
    else changedFiles.push(path);
    if (code.includes("D")) deletedFiles.push(path);
  }
  return { changedFiles, untrackedFiles, deletedFiles };
}

export async function captureWorktreeDiff(path) {
  if (!path || !existsSync(path)) return "";
  const status = await runCommand({ command: "git", args: ["status", "--porcelain=v1", "--untracked-files=all"], cwd: path, timeoutMs: 30000 });
  const parsed = parseStatus(status.stdout);
  if (parsed.untrackedFiles.length > 0) {
    await runCommand({ command: "git", args: ["add", "-N", "--", ...parsed.untrackedFiles], cwd: path, timeoutMs: 30000 });
  }
  const result = await runCommand({ command: "git", args: ["diff", "--binary", "HEAD"], cwd: path, timeoutMs: 30000, maxOutputBytes: 16 * 1024 * 1024 });
  if (parsed.untrackedFiles.length > 0) {
    await runCommand({ command: "git", args: ["reset", "-q", "--", "."], cwd: path, timeoutMs: 30000 });
  }
  return result.stdout || "";
}

export async function inspectWorktree(path, { baseCommit = null, resultStatus = "done", diff = null } = {}) {
  if (!path || !existsSync(path)) {
    return { exists: false, clean: false, changedFiles: [], untrackedFiles: [], deletedFiles: [], diffBytes: 0, partialWrite: false, hasConflicts: false };
  }
  const status = await runCommand({ command: "git", args: ["status", "--porcelain=v1", "--untracked-files=all"], cwd: path, timeoutMs: 30000 });
  const parsed = parseStatus(status.stdout);
  const patch = diff ?? await captureWorktreeDiff(path);
  const partialWrite = Boolean(status.stdout.trim()) && ["failed", "error", "cancelled"].includes(resultStatus);
  return {
    exists: true,
    clean: !status.stdout.trim(),
    head: await currentHead(path),
    baseCommit,
    changedFiles: parsed.changedFiles,
    untrackedFiles: parsed.untrackedFiles,
    deletedFiles: parsed.deletedFiles,
    diffBytes: Buffer.byteLength(patch, "utf8"),
    partialWrite,
    hasConflicts: /^(<{7}|={7}|>{7})/m.test(patch),
    statusCode: status.code
  };
}

export async function writeDiffArtifact(root, seat, diff) {
  if (!diff) return null;
  const path = join(root, "artifacts", `${seat}.patch`);
  await mkdir(join(root, "artifacts"), { recursive: true });
  await writeFile(path, diff, { encoding: "utf8", mode: 0o600 });
  await chmod(path, 0o600).catch(() => {});
  return path;
}

export async function checkPatch({ cwd, patchPath }) {
  const repo = await gitRoot(cwd);
  if (!repo) return { ok: false, error: "Not a Git repository" };
  const result = await runCommand({ command: "git", args: ["apply", "--check", "--binary", resolve(patchPath)], cwd: repo, timeoutMs: 60000 });
  return { ok: result.ok, repo, stdout: result.stdout, error: result.ok ? null : result.stderr };
}

export async function applyPatch({ cwd, patchPath, threeWay = false }) {
  const repo = await gitRoot(cwd);
  if (!repo) return { ok: false, error: "Not a Git repository" };
  const args = ["apply", "--binary", ...(threeWay ? ["--3way"] : []), resolve(patchPath)];
  const result = await runCommand({ command: "git", args, cwd: repo, timeoutMs: 120000 });
  return { ok: result.ok, repo, stdout: result.stdout, error: result.ok ? null : result.stderr };
}

export async function revertPatch({ cwd, patchPath }) {
  const repo = await gitRoot(cwd);
  if (!repo) return { ok: false, error: "Not a Git repository" };
  const check = await runCommand({ command: "git", args: ["apply", "-R", "--check", "--binary", resolve(patchPath)], cwd: repo, timeoutMs: 60000 });
  if (!check.ok) return { ok: false, repo, error: check.stderr };
  const result = await runCommand({ command: "git", args: ["apply", "-R", "--binary", resolve(patchPath)], cwd: repo, timeoutMs: 120000 });
  return { ok: result.ok, repo, stdout: result.stdout, error: result.ok ? null : result.stderr };
}

export async function listWorktrees(cwd) {
  const repo = await gitRoot(cwd);
  if (!repo) return [];
  const result = await runCommand({ command: "git", args: ["worktree", "list", "--porcelain"], cwd: repo, timeoutMs: 30000 });
  if (!result.ok) return [];
  const records = result.stdout.trim().split(/\r?\n\r?\n/).filter(Boolean);
  return records.map((record) => {
    const entry = {};
    for (const line of record.split(/\r?\n/)) {
      const [key, ...parts] = line.split(" ");
      if (key === "worktree") entry.path = parts.join(" ");
      else if (key === "HEAD") entry.head = parts[0];
      else if (key === "branch") entry.branch = parts.join(" ");
      else if (key === "detached") entry.detached = true;
    }
    return entry;
  });
}

export async function removeWorktree(path, { repo = null, force = false } = {}) {
  if (!path || !existsSync(path)) return { removed: false, error: "Worktree does not exist" };
  if (!repo) return { removed: false, error: "Repository root is required for managed worktree removal" };
  const repository = await gitRoot(repo);
  if (!repository) return { removed: false, error: "Not a Git repository" };
  const target = resolve(path);
  const managedRoot = resolve(worktreeRoot(repository));
  if (!target.startsWith(`${managedRoot}${sep}`)) {
    return { removed: false, path: target, error: `Refusing to remove a worktree outside the managed root: ${managedRoot}` };
  }
  const registered = await listWorktrees(repository);
  if (!registered.some((entry) => resolve(entry.path) === target)) {
    return { removed: false, path: target, error: "Refusing to remove a path not registered as a git worktree" };
  }
  const args = ["worktree", "remove", ...(force ? ["--force"] : []), path];
  const result = await runCommand({ command: "git", args, cwd: repository, timeoutMs: 60000 });
  return { removed: result.ok, path: target, error: result.ok ? null : (result.stderr || `exit ${result.code}`) };
}

export async function pruneWorktrees(cwd, { dryRun = true, expire = null } = {}) {
  const repo = await gitRoot(cwd);
  if (!repo) return { ok: false, error: "Not a Git repository" };
  const args = ["worktree", "prune", "--verbose", ...(dryRun ? ["--dry-run"] : []), ...(expire ? ["--expire", expire] : [])];
  const result = await runCommand({ command: "git", args, cwd: repo, timeoutMs: 60000 });
  return { ok: result.ok, repo, dryRun, stdout: result.stdout, error: result.ok ? null : result.stderr };
}
