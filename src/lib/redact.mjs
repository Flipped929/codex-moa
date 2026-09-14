const PATTERNS = [
  [/\b(sk-[A-Za-z0-9_-]{12,})\b/g, "sk-***REDACTED***"],
  [/\b(gh[pousr]_[A-Za-z0-9]{20,})\b/g, "gh*_***REDACTED***"],
  [/\b(Bearer\s+)[A-Za-z0-9._~+/=-]{12,}/gi, "$1***REDACTED***"],
  [/((?:api[_-]?key|token|secret|password|credential)\s*[:=]\s*)["']?[^"'\s,}]+/gi, "$1***REDACTED***"],
  [/\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b/g, "***JWT_REDACTED***"]
];

export function redactText(value) {
  let text = typeof value === "string" ? value : JSON.stringify(value);
  for (const [pattern, replacement] of PATTERNS) text = text.replace(pattern, replacement);
  return text;
}

export function redactValue(value) {
  if (typeof value === "string") return redactText(value);
  if (Array.isArray(value)) return value.map(redactValue);
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, redactValue(item)]));
  }
  return value;
}
