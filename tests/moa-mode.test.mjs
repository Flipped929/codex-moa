import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { readMoAMode, resolveMoAMode, setMoAMode } from "../src/lib/moa-mode.mjs";

test("MOA mode defaults to auto and persists changes", async () => {
  const root = await mkdtemp(join(tmpdir(), "codex-moa-mode-"));
  const path = join(root, "mode.json");
  assert.equal((await readMoAMode(path)).mode, "auto");
  assert.equal((await setMoAMode("off", path)).mode, "off");
  assert.equal((await resolveMoAMode(null, path)).mode, "off");
  assert.equal((await resolveMoAMode("force", path)).source, "explicit");
});

test("MOA mode rejects unknown values", async () => {
  await assert.rejects(() => setMoAMode("sometimes"), /Invalid MOA mode/);
});
