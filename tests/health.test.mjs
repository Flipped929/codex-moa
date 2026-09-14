import test from "node:test";
import assert from "node:assert/strict";
import { runCommand } from "../src/lib/process.mjs";

test("MCP health check exits without loading external agents", async () => {
  const result = await runCommand({
    command: process.execPath,
    args: ["mcp/server.bundle.mjs", "--health"],
    cwd: process.cwd(),
    timeoutMs: 5000
  });
  assert.equal(result.ok, true, result.stderr);
  const report = JSON.parse(result.stdout);
  assert.equal(report.plugin, "codex-moa");
  assert.equal(report.transport, "stdio");
  assert.equal(report.codexInternalApisUsed, false);
});
