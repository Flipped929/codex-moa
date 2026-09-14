import readline from "node:readline";

const rl = readline.createInterface({ input: process.stdin });
const sessionId = "sess_fake_zcode";
let createId = null;
let pendingStop = false;
let sent = false;
let readCount = 0;

function send(message) {
  process.stdout.write(`${JSON.stringify(message)}\n`);
}

rl.on("line", (line) => {
  if (!line.trim()) return;
  const message = JSON.parse(line);
  if (message.method === "session/create") {
    createId = message.id;
    send({ id: "server-1", method: "session/requestRuntimePreferences", params: { sessionId, scope: "runtime-materialization" } });
    return;
  }
  if (message.id === "server-1" && message.result) {
    send({ id: createId, result: {
      protocol: { name: "ZCode Protocol", version: 1 },
      session: { sessionId, workspace: { workspacePath: process.cwd(), workspaceKey: process.cwd() }, status: "idle" },
      projection: { sessionId, status: "idle", turnCount: 0, totalTokenCount: 0 },
      messages: []
    } });
    return;
  }
  if (message.method === "session/subscribe") {
    send({ id: message.id, result: {} });
    return;
  }
  if (message.method === "session/send") {
    sent = true;
    send({ id: message.id, result: { accepted: true, sessionId, stateRevision: 1 } });
    return;
  }
  if (message.method === "session/read") {
    if (sent) readCount += 1;
    const running = sent && !pendingStop && readCount < 2;
    send({ id: message.id, result: {
      projection: { sessionId, status: running ? "running" : "idle", turnCount: sent ? 1 : 0, totalTokenCount: sent ? 12 : 0 },
      runtime: { eventSeq: sent ? 1 : 0 }
    } });
    return;
  }
  if (message.method === "session/messages") {
    send({ id: message.id, result: { messages: [
      { info: { role: "user" }, parts: [{ type: "text", text: "hi" }] },
      { info: { role: "assistant", tokens: { input: 8, output: 4, reasoning: 0, cache: { read: 0, write: 0 } } }, parts: [{ type: "text", text: "ZCODE_ACP_OK" }] }
    ] } });
    return;
  }
  if (message.method === "session/stop") {
    pendingStop = true;
    send({ id: message.id, result: {} });
    return;
  }
  send({ id: message.id, error: { code: -32601, message: `unsupported ${message.method}` } });
});
process.on("SIGTERM", () => process.exit(0));
