const TEXT_KEYS = ["final_answer", "answer", "result", "text", "content", "message", "summary", "output"];
const SKIP_KEYS = new Set(["usage", "tools", "tool_calls", "reasoning", "thinking", "metadata", "events"]);

function addString(output, value) {
  const text = String(value ?? "").trim();
  if (text && !output.includes(text)) output.push(text);
}

function walk(value, output, key = "", depth = 0) {
  if (depth > 10 || value == null) return;
  if (typeof value === "string") {
    if (!key || TEXT_KEYS.includes(key)) addString(output, value);
    return;
  }
  if (Array.isArray(value)) {
    for (const item of value) walk(item, output, key, depth + 1);
    return;
  }
  if (typeof value !== "object") return;
  for (const [childKey, childValue] of Object.entries(value)) {
    if (SKIP_KEYS.has(childKey)) continue;
    walk(childValue, output, childKey, depth + 1);
  }
}

function extractObject(value) {
  const output = [];
  walk(value, output);
  return output.join("\n").trim();
}

export function extractOutput(stdout) {
  const raw = String(stdout ?? "").trim();
  if (!raw) return "";
  try {
    return extractObject(JSON.parse(raw)) || raw;
  } catch {}

  const parsedLines = [];
  for (const line of raw.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed.startsWith("{") && !trimmed.startsWith("[")) continue;
    try { parsedLines.push(JSON.parse(trimmed)); } catch {}
  }
  if (parsedLines.length > 0) {
    const output = [];
    for (const event of parsedLines) {
      const text = extractObject(event);
      if (text) addString(output, text);
    }
    if (output.length > 0) return output.join("\n").trim();
  }
  return raw;
}

function jsonEvents(stdout) {
  const raw = String(stdout ?? "").trim();
  if (!raw) return [];
  const events = [];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [parsed];
  } catch {}
  for (const line of raw.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed.startsWith("{") && !trimmed.startsWith("[")) continue;
    try {
      const parsed = JSON.parse(trimmed);
      if (Array.isArray(parsed)) events.push(...parsed);
      else events.push(parsed);
    } catch {}
  }
  return events;
}

function messageText(message) {
  if (!message || message.role !== "assistant") return "";
  if (typeof message.content === "string") return message.content.trim();
  if (!Array.isArray(message.content)) return "";
  return message.content
    .filter((item) => item?.type === "text" && typeof item.text === "string")
    .map((item) => item.text.trim())
    .filter(Boolean)
    .join("\n")
    .trim();
}

// Pi JSON mode emits the complete user, assistant, and tool transcript as JSONL.
// Only the last completed assistant message is the seat's answer.
export function extractPiOutput(stdout) {
  const assistantMessages = jsonEvents(stdout)
    .filter((event) => event?.type === "message_end")
    .map((event) => event.message)
    .filter((message) => message?.role === "assistant");
  for (let index = assistantMessages.length - 1; index >= 0; index -= 1) {
    const text = messageText(assistantMessages[index]);
    if (text) return text;
  }
  if (assistantMessages.length > 0) return "";
  return extractOutput(stdout);
}

export function extractClaudeOutput(stdout) {
  const events = jsonEvents(stdout);
  for (let index = events.length - 1; index >= 0; index -= 1) {
    const event = events[index];
    if (event?.type === "result" && typeof event.result === "string" && event.result.trim()) return event.result.trim();
    const text = messageText(event?.message ?? event);
    if (text) return text;
  }
  return extractOutput(stdout);
}

export function extractCodexOutput(stdout) {
  const events = jsonEvents(stdout);
  for (let index = events.length - 1; index >= 0; index -= 1) {
    const event = events[index];
    const item = event?.item ?? event;
    if (["agent_message", "message"].includes(item?.type) && typeof item.text === "string" && item.text.trim()) {
      return item.text.trim();
    }
    if (event?.type === "turn.completed" && typeof event.final_output === "string" && event.final_output.trim()) {
      return event.final_output.trim();
    }
  }
  return extractOutput(stdout);
}

export function extractPiError(stdout) {
  const assistantMessages = jsonEvents(stdout)
    .filter((event) => event?.type === "message_end")
    .map((event) => event.message)
    .filter((message) => message?.role === "assistant");
  const last = assistantMessages.at(-1);
  if (!last) return null;
  if (last.stopReason === "error" || last.errorMessage) {
    return String(last.errorMessage || "Pi assistant stopped with an error");
  }
  return null;
}

export function extractPiUsage(stdout) {
  const usages = jsonEvents(stdout)
    .filter((event) => event?.type === "message_end" && event.message?.role === "assistant")
    .map((event) => event.message.usage)
    .filter((usage) => usage && typeof usage === "object");
  if (usages.length === 0) return extractUsage(stdout);
  const number = (value) => Number.isFinite(Number(value)) ? Number(value) : 0;
  const inputTokens = usages.reduce((sum, usage) => sum + number(usage.input ?? usage.inputTokens ?? usage.input_tokens), 0);
  const outputTokens = usages.reduce((sum, usage) => sum + number(usage.output ?? usage.outputTokens ?? usage.output_tokens), 0);
  const cacheReadTokens = usages.reduce((sum, usage) => sum + number(usage.cacheRead ?? usage.cacheReadTokens ?? usage.cache_read_tokens), 0);
  const cacheWriteTokens = usages.reduce((sum, usage) => sum + number(usage.cacheWrite ?? usage.cacheWriteTokens ?? usage.cache_write_tokens), 0);
  return {
    inputTokens,
    outputTokens,
    totalTokens: inputTokens + outputTokens,
    cacheReadTokens,
    cacheWriteTokens,
    contextTokens: number(usages.at(-1)?.totalTokens ?? usages.at(-1)?.contextTokens) || null
  };
}

function findSessionId(value, depth = 0) {
  if (depth > 8 || value == null) return null;
  if (typeof value !== "object") return null;
  for (const key of ["session_id", "sessionId", "thread_id", "threadId", "conversation_id", "conversationId"]) {
    if (typeof value[key] === "string" && value[key]) return value[key];
  }
  for (const item of Array.isArray(value) ? value : Object.values(value)) {
    const found = findSessionId(item, depth + 1);
    if (found) return found;
  }
  return null;
}

function numericUsage(value) {
  if (!value || typeof value !== "object") return null;
  const pick = (...keys) => {
    for (const key of keys) {
      const number = Number(value[key]);
      if (Number.isFinite(number)) return number;
    }
    return null;
  };
  const inputTokens = pick("input_tokens", "inputTokens", "prompt_tokens", "promptTokens");
  const outputTokens = pick("output_tokens", "outputTokens", "completion_tokens", "completionTokens");
  const totalTokens = pick("total_tokens", "totalTokens");
  if (inputTokens === null && outputTokens === null && totalTokens === null) return null;
  return { inputTokens, outputTokens, totalTokens };
}

export function extractUsage(stdout) {
  const raw = String(stdout ?? "").trim();
  if (!raw) return null;
  const candidates = [];
  try { candidates.push(JSON.parse(raw)); } catch {}
  for (const line of raw.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed.startsWith("{") && !trimmed.startsWith("[")) continue;
    try { candidates.push(JSON.parse(trimmed)); } catch {}
  }
  const walk = (value, depth = 0) => {
    if (depth > 8 || value == null) return null;
    if (typeof value !== "object") return null;
    const direct = numericUsage(value.usage) ?? numericUsage(value);
    if (direct) return direct;
    for (const item of Array.isArray(value) ? value : Object.values(value)) {
      const found = walk(item, depth + 1);
      if (found) return found;
    }
    return null;
  };
  for (const candidate of candidates) {
    const usage = walk(candidate);
    if (usage) return usage;
  }
  return null;
}

export function extractSessionId(stdout) {
  const raw = String(stdout ?? "").trim();
  if (!raw) return null;
  try { return findSessionId(JSON.parse(raw)); } catch {}
  for (const line of raw.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed.startsWith("{") && !trimmed.startsWith("[")) continue;
    try {
      const found = findSessionId(JSON.parse(trimmed));
      if (found) return found;
    } catch {}
  }
  return null;
}

export function truncateMiddle(value, maxChars) {
  const text = String(value ?? "");
  if (!Number.isFinite(maxChars) || text.length <= maxChars) return text;
  const half = Math.max(0, Math.floor((maxChars - 32) / 2));
  return `${text.slice(0, half)}\n...<truncated>...\n${text.slice(-half)}`;
}
