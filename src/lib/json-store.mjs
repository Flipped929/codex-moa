import { existsSync } from "node:fs";
import { chmod, mkdir, open, readFile, rename, stat, unlink, writeFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { dirname } from "node:path";

export async function withFileLock(filePath, fn, { timeoutMs = 10000, staleMs = 30000, pollMs = 20 } = {}) {
  const lockPath = `${filePath}.lock`;
  await mkdir(dirname(filePath), { recursive: true });
  const started = Date.now();
  let handle;
  while (!handle) {
    try {
      handle = await open(lockPath, "wx", 0o600);
    } catch (error) {
      if (error?.code !== "EEXIST") throw error;
      try {
        const info = await stat(lockPath);
        if (Date.now() - info.mtimeMs > staleMs) {
          await unlink(lockPath).catch(() => {});
          continue;
        }
      } catch {}
      if (Date.now() - started > timeoutMs) throw new Error(`Timed out waiting for lock: ${filePath}`);
      await new Promise((resolveDelay) => setTimeout(resolveDelay, pollMs));
    }
  }
  try {
    await handle.writeFile(`${process.pid}\n`);
    return await fn();
  } finally {
    await handle.close().catch(() => {});
    await unlink(lockPath).catch(() => {});
  }
}

export async function writeJsonAtomic(path, value, { mode = 0o600 } = {}) {
  await mkdir(dirname(path), { recursive: true });
  const temporary = `${path}.${randomUUID()}.tmp`;
  await writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`, { mode });
  await rename(temporary, path);
  await chmod(path, mode).catch(() => {});
  return path;
}

export function migrateJsonStore(value, { version, defaultValue, migrations = {} }) {
  let current = value && typeof value === "object" ? { ...value } : structuredClone(defaultValue);
  if (current.__invalid__) return structuredClone(defaultValue);
  let currentVersion = Number(current.version ?? 1);
  while (currentVersion < version) {
    const nextVersion = currentVersion + 1;
    const migrate = migrations[currentVersion] ?? migrations[`${currentVersion}->${nextVersion}`];
    current = migrate ? migrate(current) : current;
    current.version = nextVersion;
    currentVersion = nextVersion;
  }
  return { ...structuredClone(defaultValue), ...current, version };
}

export async function readJsonStore(path, { version = 1, defaultValue = {}, migrations = {} } = {}) {
  if (!existsSync(path)) return migrateJsonStore(structuredClone(defaultValue), { version, defaultValue, migrations });
  try {
    const parsed = JSON.parse(await readFile(path, "utf8"));
    return migrateJsonStore(parsed, { version, defaultValue, migrations });
  } catch {
    return migrateJsonStore({ __invalid__: true }, { version, defaultValue, migrations });
  }
}

export async function updateJsonStore(path, updater, options = {}) {
  const {
    version = 1,
    defaultValue = {},
    migrations = {},
    mode = 0o600,
    lock = {}
  } = options;
  return withFileLock(path, async () => {
    const current = await readJsonStore(path, { version, defaultValue, migrations });
    const next = await updater(current);
    await writeJsonAtomic(path, next, { mode });
    return next;
  }, lock);
}
