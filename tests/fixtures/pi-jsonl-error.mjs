const user = { type: "message_end", message: { role: "user", content: [{ type: "text", text: "prompt" }] } };
const assistant = {
  type: "message_end",
  message: {
    role: "assistant",
    content: [],
    stopReason: "error",
    errorMessage: "401: authentication failed",
    usage: { input: 0, output: 0, totalTokens: 0 }
  }
};
process.stdout.write(`${JSON.stringify(user)}\n${JSON.stringify(assistant)}\n`);
