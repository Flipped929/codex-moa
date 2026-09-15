import { homedir } from "node:os";
import { resolve } from "node:path";
import { readJsonStore, writeJsonAtomic } from "./json-store.mjs";

export const MOA_MODES = ["off", "auto", "force"];

function modePath() {
  return process.env.CODEX_MOA_MODE_PATH
    ? resolve(process.env.CODEX_MOA_MODE_PATH)
    : resolve(homedir(), ".codex-moa", "mode.json");
}

function normalizeMode(mode) {
  const normalized = String(mode ?? "auto").trim().toLowerCase();
  if (!MOA_MODES.includes(normalized)) {
    throw new Error(`Invalid MOA mode "${mode}". Expected one of: ${MOA_MODES.join(", ")}`);
  }
  return normalized;
}

export async function readMoAMode(path = modePath()) {
  const state = await readJsonStore(path, {
    version: 1,
    defaultValue: { version: 1, mode: "auto", updatedAt: null }
  });
  return { ...state, mode: normalizeMode(state.mode), path };
}

export async function setMoAMode(mode, path = modePath()) {
  const state = {
    version: 1,
    mode: normalizeMode(mode),
    updatedAt: new Date().toISOString()
  };
  await writeJsonAtomic(path, state);
  return { ...state, path };
}

export async function resolveMoAMode(override, path = modePath()) {
  if (override) return { mode: normalizeMode(override), source: "explicit", path };
  const persisted = await readMoAMode(path);
  return { ...persisted, source: persisted.updatedAt ? "persistent" : "default" };
}
