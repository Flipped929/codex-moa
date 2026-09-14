import test from "node:test";
import assert from "node:assert/strict";
import { extractOutput, extractSessionId, extractUsage, truncateMiddle } from "../src/lib/parser.mjs";

test("extracts final answer from JSONL events", () => {
  const output = extractOutput([
    JSON.stringify({ type: "agent.thinking", content: "hidden" }),
    JSON.stringify({ type: "agent.message", content: "final answer" })
  ].join("\n"));
  assert.match(output, /final answer/);
});

test("extracts plain text unchanged", () => {
  assert.equal(extractOutput("plain answer\n"), "plain answer");
});

test("truncates middle", () => {
  const output = truncateMiddle("a".repeat(1000), 100);
  assert.ok(output.length <= 100);
  assert.match(output, /truncated/);
});

test("extracts session id from JSONL events", () => {
  const sessionId = extractSessionId('{"type":"session.started","session_id":"sess_abc"}\n');
  assert.equal(sessionId, "sess_abc");
});

test("extracts token usage from JSONL events", () => {
  const usage = extractUsage('{"type":"agent.message","usage":{"input_tokens":12,"output_tokens":4}}\n');
  assert.deepEqual(usage, { inputTokens: 12, outputTokens: 4, totalTokens: null });
});
