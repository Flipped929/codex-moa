import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { pendingCancellationFor, readControlStore, requestCancellation, resolveControlRequest } from "../src/lib/control-store.mjs";

test("persists and resolves scoped cancellation requests", async () => {
  const root = await mkdtemp(join(tmpdir(), "codex-moa-control-"));
  const previous = process.env.CODEX_MOA_CONTROL_PATH;
  process.env.CODEX_MOA_CONTROL_PATH = join(root, "control.json");
  try {
    const request = await requestCancellation({ taskId: "task-1", seat: "executor", reason: "test" });
    const pending = await pendingCancellationFor({ taskId: "task-1", seat: "executor", key: "key-1" });
    assert.equal(pending.id, request.id);
    await resolveControlRequest(request.id, { status: "fulfilled", detail: { ok: true } });
    const store = await readControlStore();
    assert.equal(store.requests[0].status, "fulfilled");
    assert.equal((await pendingCancellationFor({ taskId: "task-1", seat: "executor" })), null);
  } finally {
    if (previous === undefined) delete process.env.CODEX_MOA_CONTROL_PATH;
    else process.env.CODEX_MOA_CONTROL_PATH = previous;
  }
});
