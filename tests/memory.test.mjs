import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { buildMemoryPack, distillMemory, loadMemory, remember } from "../src/lib/memory.mjs";

test("stores and builds a durable memory pack", async () => {
  const root = await mkdtemp(join(tmpdir(), "codex-moa-memory-"));
  process.env.CODEX_MOA_MEMORY_HOME = root;
  try {
    await remember({ key: "parser", cwd: "/repo", kind: "decision", text: "Keep the public API stable" });
    await remember({ key: "parser", cwd: "/repo", kind: "failed_attempt", text: "Rewriting the parser", evidence: "broke tests" });
    const memory = await loadMemory({ key: "parser", cwd: "/repo" });
    const pack = buildMemoryPack(memory);
    assert.match(pack, /Keep the public API stable/);
    assert.match(pack, /Rewriting the parser/);
    const distilled = await distillMemory({ key: "parser", cwd: "/repo" });
    assert.equal(distilled.stats.decisions, 1);
  } finally {
    delete process.env.CODEX_MOA_MEMORY_HOME;
  }
});
