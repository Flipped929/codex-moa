import { existsSync, readFileSync } from "node:fs";
import { chmod, mkdir, readdir, rename, writeFile } from "node:fs/promises";
import { createHash, randomUUID } from "node:crypto";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { redactText } from "./redact.mjs";

function expandHome(value) {
  if (typeof value !== "string") return value;
  if (value === "~") return homedir();
  if (value.startsWith("~/")) return resolve(homedir(), value.slice(2));
  return resolve(value);
}

export function memoryRoot() {
  return expandHome(process.env.CODEX_MOA_MEMORY_HOME || "~/.codex-moa/memory");
}

export function memoryKey({ key, cwd }) {
  const source = `${key || "default"}\n${resolve(cwd || process.cwd())}`;
  return createHash("sha256").update(source).digest("hex").slice(0, 24);
}

export function memoryPath(key) {
  return join(memoryRoot(), `${key}.json`);
}

async function saveMemory(memory) {
  await mkdir(dirname(memory.path), { recursive: true });
  const temporary = `${memory.path}.${randomUUID()}.tmp`;
  await writeFile(temporary, `${JSON.stringify(memory, null, 2)}\n`, { mode: 0o600 });
  await rename(temporary, memory.path);
  await chmod(memory.path, 0o600);
  return memory;
}

export async function loadMemory({ key, cwd, title = null }) {
  const resolvedKey = memoryKey({ key, cwd });
  const path = memoryPath(resolvedKey);
  if (!existsSync(path)) {
    return {
      version: 1,
      key: resolvedKey,
      sourceKey: key,
      cwd: resolve(cwd || process.cwd()),
      title,
      goal: null,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      decisions: [],
      facts: [],
      files: [],
      tests: [],
      failedAttempts: [],
      openQuestions: [],
      episodes: [],
      path
    };
  }
  const memory = JSON.parse(readFileSync(path, "utf8"));
  memory.path = path;
  return memory;
}

export async function remember({ key, cwd, kind, text, evidence = null, path = null, status = null }) {
  const memory = await loadMemory({ key, cwd });
  const item = { text: redactText(text), evidence: evidence ? redactText(evidence) : null, path, status, at: new Date().toISOString() };
  const map = {
    decision: "decisions",
    fact: "facts",
    file: "files",
    test: "tests",
    failed_attempt: "failedAttempts",
    open_question: "openQuestions"
  };
  const collection = map[kind];
  if (!collection) throw new Error(`Unknown memory kind: ${kind}`);
  memory[collection].push(item);
  memory.updatedAt = item.at;
  return saveMemory(memory);
}

export async function recordEpisode({ key, cwd, episode }) {
  if (!key) return null;
  const memory = await loadMemory({ key, cwd });
  const safe = JSON.parse(redactText(JSON.stringify(episode)));
  memory.title ??= safe.title ?? null;
  memory.goal ??= safe.task ?? null;
  memory.episodes.push({ ...safe, at: new Date().toISOString() });
  memory.updatedAt = new Date().toISOString();
  return saveMemory(memory);
}

export async function distillMemory({ key, cwd }) {
  const memory = await loadMemory({ key, cwd });
  const dedupe = (items, selector) => {
    const seen = new Set();
    return (items ?? []).filter((item) => {
      const value = selector(item);
      if (seen.has(value)) return false;
      seen.add(value);
      return true;
    });
  };
  memory.decisions = dedupe(memory.decisions, (item) => item.text);
  memory.facts = dedupe(memory.facts, (item) => item.text);
  memory.files = dedupe(memory.files, (item) => item.path || item.text);
  memory.tests = dedupe(memory.tests, (item) => `${item.text}|${item.status ?? ""}`);
  memory.failedAttempts = dedupe(memory.failedAttempts, (item) => item.text);
  memory.openQuestions = dedupe(memory.openQuestions, (item) => item.text);
  memory.episodes = (memory.episodes ?? []).slice(-20);
  memory.distilledAt = new Date().toISOString();
  memory.stats = {
    decisions: memory.decisions.length,
    facts: memory.facts.length,
    files: memory.files.length,
    tests: memory.tests.length,
    failedAttempts: memory.failedAttempts.length,
    openQuestions: memory.openQuestions.length,
    episodes: memory.episodes.length
  };
  return saveMemory(memory);
}

export function buildMemoryPack(memory, maxChars = 8000) {
  const lines = [];
  if (memory.title) lines.push(`# ${memory.title}`);
  if (memory.goal) lines.push(`Goal: ${memory.goal}`);
  const section = (name, items, formatter) => {
    if (!items?.length) return;
    lines.push(`\n## ${name}`);
    for (const item of items.slice(-12)) lines.push(`- ${formatter(item)}`);
  };
  section("Decisions", memory.decisions, (item) => `${item.text}${item.evidence ? ` (${item.evidence})` : ""}`);
  section("Facts", memory.facts, (item) => `${item.text}${item.evidence ? ` (${item.evidence})` : ""}`);
  section("Files", memory.files, (item) => `${item.path || item.text}${item.status ? ` [${item.status}]` : ""}`);
  section("Tests", memory.tests, (item) => `${item.text}${item.status ? ` [${item.status}]` : ""}`);
  section("Failed attempts", memory.failedAttempts, (item) => `${item.text}: ${item.evidence || "no evidence"}`);
  section("Open questions", memory.openQuestions, (item) => item.text);
  section("Episodes", memory.episodes, (item) => `${item.task}: ${item.summary || ""}`);
  const text = lines.join("\n").trim();
  return text.length <= maxChars ? text : `${text.slice(0, maxChars - 32)}\n...<memory truncated>`;
}

export async function listMemories() {
  const root = memoryRoot();
  if (!existsSync(root)) return [];
  const result = [];
  for (const file of await readdir(root)) {
    if (!file.endsWith(".json")) continue;
    try {
      const memory = JSON.parse(readFileSync(join(root, file), "utf8"));
      result.push({ key: memory.key, sourceKey: memory.sourceKey, title: memory.title, cwd: memory.cwd, updatedAt: memory.updatedAt });
    } catch {}
  }
  return result.sort((a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt)));
}
