import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { continuityEntry, makeContinuityKey, readContinuityStore, setContinuityEntry, writeContinuityStore } from "../src/lib/continuity.mjs";

test("stores and reloads continuity sessions", async () => {
  const root = await mkdtemp(join(tmpdir(), "codex-moa-continuity-"));
  const path = join(root, "continuity.json");
  const key = makeContinuityKey({ group: "task-1", seat: "executor", harness: "zcode", model: "GLM-5.3", cwd: "/repo" });
  const store = { version: 1, entries: {} };
  setContinuityEntry(store, key, { model: "GLM-5.3", sessionId: "sess_123", harness: "zcode" });
  await writeContinuityStore(store, path);
  const reloaded = await readContinuityStore(path);
  assert.equal(continuityEntry(reloaded, key).sessionId, "sess_123");
  assert.match(await readFile(path, "utf8"), /sess_123/);
});
