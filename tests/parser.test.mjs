import test from "node:test";
import assert from "node:assert/strict";
import { extractOutput, extractPiError, extractPiOutput, extractPiUsage, extractSessionId, extractUsage, truncateMiddle } from "../src/lib/parser.mjs";

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

test("extracts only the final Pi assistant message and sums billed usage", () => {
  const output = [
    { type: "message_end", message: { role: "user", content: [{ type: "text", text: "secret prompt" }] } },
    { type: "message_end", message: { role: "assistant", content: [{ type: "text", text: "intermediate" }], usage: { input: 10, output: 2, totalTokens: 12 } } },
    { type: "message_end", message: { role: "toolResult", content: [{ type: "text", text: "tool noise" }] } },
    { type: "message_end", message: { role: "assistant", content: [{ type: "thinking", thinking: "hidden" }, { type: "text", text: "final answer" }], usage: { input: 20, output: 3, cacheRead: 4, totalTokens: 23 } } }
  ].map(JSON.stringify).join("\n");
  assert.equal(extractPiOutput(output), "final answer");
  assert.deepEqual(extractPiUsage(output), {
    inputTokens: 30,
    outputTokens: 5,
    totalTokens: 35,
    cacheReadTokens: 4,
    cacheWriteTokens: 0,
    contextTokens: 23
  });
});

test("treats a Pi assistant error with an empty response as a failure", () => {
  const output = [
    { type: "message_end", message: { role: "user", content: [{ type: "text", text: "prompt" }] } },
    { type: "message_end", message: { role: "assistant", content: [], stopReason: "error", errorMessage: "401: authentication failed", usage: { input: 0, output: 0 } } }
  ].map(JSON.stringify).join("\n");
  assert.equal(extractPiOutput(output), "");
  assert.equal(extractPiError(output), "401: authentication failed");
});
