import { createHash } from "node:crypto";
import { homedir } from "node:os";
import { resolve } from "node:path";
import { readJsonStore, updateJsonStore, writeJsonAtomic, withFileLock } from "./json-store.mjs";

const CONTINUITY_VERSION = 2;
const DEFAULT_STORE = { version: CONTINUITY_VERSION, entries: {} };
const MIGRATIONS = {
  1: (store) => ({ ...store, entries: store.entries ?? {} })
};

function expandHome(value) {
  if (typeof value !== "string") return value;
  if (value === "~") return homedir();
  if (value.startsWith("~/")) return resolve(homedir(), value.slice(2));
  return resolve(value);
}

export function continuityStorePath() {
  return expandHome(process.env.CODEX_MOA_CONTINUITY_PATH || "~/.codex-moa/continuity.json");
}

export function makeContinuityKey({ group, seat, harness, model, cwd }) {
  if (!group) return null;
  const raw = JSON.stringify({ group, seat, harness, model, cwd: resolve(cwd || process.cwd()) });
  return createHash("sha256").update(raw).digest("hex").slice(0, 24);
}

export async function readContinuityStore(path = continuityStorePath()) {
  return readJsonStore(path, { version: CONTINUITY_VERSION, defaultValue: DEFAULT_STORE, migrations: MIGRATIONS });
}

export async function writeContinuityStore(store, path = continuityStorePath()) {
  const safe = { ...store, version: CONTINUITY_VERSION, entries: store.entries ?? {} };
  await withFileLock(path, () => writeJsonAtomic(path, safe));
  return path;
}

export async function mergeContinuityStore(store, path = continuityStorePath()) {
  return updateJsonStore(path, (latest) => {
    latest.entries ??= {};
    for (const [key, value] of Object.entries(store.entries ?? {})) latest.entries[key] = value;
    return latest;
  }, { version: CONTINUITY_VERSION, defaultValue: DEFAULT_STORE, migrations: MIGRATIONS });
}

export function continuityEntry(store, key) {
  return key ? store.entries?.[key] ?? null : null;
}

export function setContinuityEntry(store, key, value) {
  if (!key) return;
  store.entries ??= {};
  store.entries[key] = { ...store.entries[key], ...value, updatedAt: new Date().toISOString() };
}

export function clearContinuityEntry(store, key) {
  if (key && store.entries) delete store.entries[key];
}
