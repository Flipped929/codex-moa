import readline from "node:readline";

const sessionId = process.argv.includes("--session-id") ? process.argv[process.argv.indexOf("--session-id") + 1] : "pi-test-session";
const messages = [];
const rl = readline.createInterface({ input: process.stdin });

function send(value) {
  process.stdout.write(`${JSON.stringify(value)}\n`);
}

rl.on("line", (line) => {
  const request = JSON.parse(line);
  if (request.type === "get_state") {
    send({ id: request.id, type: "response", command: "get_state", success: true, data: { sessionId, messageCount: messages.length, isStreaming: false } });
  } else if (request.type === "get_messages") {
    send({ id: request.id, type: "response", command: "get_messages", success: true, data: { messages } });
  } else if (request.type === "prompt") {
    messages.push({ role: "user", content: request.message });
    messages.push({ role: "assistant", content: [{ type: "text", text: "FAKE_PI_RPC_OK" }], usage: { inputTokens: 4, outputTokens: 3, totalTokens: 7 } });
    send({ id: request.id, type: "response", command: "prompt", success: true });
    setTimeout(() => send({ type: "agent_end" }), 5);
  } else if (request.type === "clear_queue" || request.type === "abort") {
    send({ id: request.id, type: "response", command: request.type, success: true, data: {} });
  } else {
    send({ id: request.id, type: "response", command: request.type, success: false, error: "unsupported" });
  }
});

