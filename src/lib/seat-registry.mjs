import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { resolve } from "node:path";
import { migrateJsonStore, updateJsonStore, writeJsonAtomic, withFileLock } from "./json-store.mjs";

function expandHome(value) {
  if (typeof value !== "string") return value;
  if (value === "~") return homedir();
  if (value.startsWith("~/")) return resolve(homedir(), value.slice(2));
  return resolve(value);
}

const SEAT_REGISTRY_VERSION = 2;
const DEFAULT_REGISTRY = { version: SEAT_REGISTRY_VERSION, seats: {} };
const MIGRATIONS = {
  1: (registry) => ({ ...registry, seats: registry.seats ?? {} })
};

export function seatRegistryPath() {
  return expandHome(process.env.CODEX_MOA_SEAT_REGISTRY || "~/.codex-moa/seats.json");
}

export function readSeatRegistry(path = seatRegistryPath()) {
  if (!existsSync(path)) return migrateJsonStore(structuredClone(DEFAULT_REGISTRY), { version: SEAT_REGISTRY_VERSION, defaultValue: DEFAULT_REGISTRY, migrations: MIGRATIONS });
  try {
    return migrateJsonStore(JSON.parse(readFileSync(path, "utf8")), { version: SEAT_REGISTRY_VERSION, defaultValue: DEFAULT_REGISTRY, migrations: MIGRATIONS });
  } catch {
    return migrateJsonStore({ __invalid__: true }, { version: SEAT_REGISTRY_VERSION, defaultValue: DEFAULT_REGISTRY, migrations: MIGRATIONS });
  }
}

export async function writeSeatRegistry(registry, path = seatRegistryPath()) {
  const safe = migrateJsonStore(registry, { version: SEAT_REGISTRY_VERSION, defaultValue: DEFAULT_REGISTRY, migrations: MIGRATIONS });
  await withFileLock(path, () => writeJsonAtomic(path, safe));
  return path;
}

export async function updateSeatRegistry(updater, path = seatRegistryPath()) {
  return updateJsonStore(path, async (registry) => updater(registry), {
    version: SEAT_REGISTRY_VERSION,
    defaultValue: DEFAULT_REGISTRY,
    migrations: MIGRATIONS
  });
}

export async function upsertSeatAtomic(path, seatKey, value) {
  return updateSeatRegistry((registry) => {
    upsertSeat(registry, seatKey, value);
    return registry;
  }, path);
}

export function upsertSeat(registry, seatKey, value) {
  registry.seats ??= {};
  registry.seats[seatKey] = { ...registry.seats[seatKey], ...value, updatedAt: new Date().toISOString() };
  return registry.seats[seatKey];
}

export function listSeats(registry) {
  return Object.entries(registry.seats ?? {}).map(([key, value]) => ({ key, ...value }));
}
