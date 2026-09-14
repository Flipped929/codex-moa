import readline from "node:readline";

const rl = readline.createInterface({ input: process.stdin });
let sessionId = "fake-session";
let pendingPrompt = null;
let cancelled = false;

function send(message) {
  process.stdout.write(`${JSON.stringify(message)}\n`);
}

rl.on("line", (line) => {
  if (!line.trim()) return;
  const message = JSON.parse(line);
  if (message.method === "initialize") {
    send({ jsonrpc: "2.0", id: message.id, result: {
      protocolVersion: 1,
      agentCapabilities: { sessionCapabilities: { resume: {} } },
      agentInfo: { name: "fake-acp", version: "1.0.0" },
      authMethods: []
    } });
    return;
  }
  if (message.method === "session/new") {
    send({ jsonrpc: "2.0", id: message.id, result: { sessionId } });
    return;
  }
  if (message.method === "session/prompt") {
    if (cancelled) {
      send({ jsonrpc: "2.0", id: message.id, result: { stopReason: "cancelled" } });
      return;
    }
    send({ jsonrpc: "2.0", method: "session/update", params: { sessionId, update: { sessionUpdate: "agent_message_chunk", content: { type: "text", text: "FAKE_ACP_" } } } });
    if (process.env.FAKE_ACP_HANG === "1") {
      pendingPrompt = message.id;
      return;
    }
    send({ jsonrpc: "2.0", method: "session/update", params: { sessionId, update: { sessionUpdate: "agent_message_chunk", content: { type: "text", text: "OK" } } } });
    send({ jsonrpc: "2.0", method: "session/update", params: { sessionId, update: { sessionUpdate: "usage_update", used: 1234, size: 10000 } } });
    send({ jsonrpc: "2.0", id: message.id, result: { stopReason: "end_turn", usage: { totalTokens: 7, inputTokens: 5, outputTokens: 2 } } });
    return;
  }
  if (message.method === "session/cancel") {
    cancelled = true;
    send({ jsonrpc: "2.0", method: "session/update", params: { sessionId, update: { sessionUpdate: "agent_message_chunk", content: { type: "text", text: "CANCELLED" } } } });
    if (pendingPrompt !== null) send({ jsonrpc: "2.0", id: pendingPrompt, result: { stopReason: "cancelled" } });
  }
});
process.on("SIGTERM", () => process.exit(cancelled ? 0 : 0));
