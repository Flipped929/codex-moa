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
