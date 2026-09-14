import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { migrateJsonStore, readJsonStore, updateJsonStore, writeJsonAtomic } from "../src/lib/json-store.mjs";

test("migrates versioned JSON stores with defaults", async () => {
  const root = await mkdtemp(join(tmpdir(), "codex-moa-json-store-"));
  const path = join(root, "store.json");
  await writeJsonAtomic(path, { version: 1, value: 3 });
  const migrated = migrateJsonStore({ version: 1, value: 3 }, {
    version: 2,
    defaultValue: { version: 2, value: 0, added: true },
    migrations: { 1: (store) => ({ ...store, migrated: true }) }
  });
  assert.equal(migrated.version, 2);
  assert.equal(migrated.value, 3);
  assert.equal(migrated.added, true);
  assert.equal(migrated.migrated, true);
  const loaded = await readJsonStore(path, {
    version: 2,
    defaultValue: { version: 2, value: 0, added: true },
    migrations: { 1: (store) => ({ ...store, migrated: true }) }
  });
  assert.equal(loaded.migrated, true);
});

test("serializes concurrent read-modify-write updates", async () => {
  const root = await mkdtemp(join(tmpdir(), "codex-moa-json-lock-"));
  const path = join(root, "counter.json");
  await Promise.all(Array.from({ length: 20 }, () => updateJsonStore(path, async (store) => {
    store.count = (store.count ?? 0) + 1;
    await new Promise((resolveDelay) => setTimeout(resolveDelay, 1));
    return store;
  }, { defaultValue: { count: 0 } })));
  const loaded = await readJsonStore(path, { defaultValue: { count: 0 } });
  assert.equal(loaded.count, 20);
});
