import { appendFileSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { expandHome } from "./config.mjs";
import { redactText, redactValue } from "./redact.mjs";

export function createTaskId(prefix = "moa") {
  const stamp = new Date().toISOString().replace(/[-:.TZ]/g, "").slice(0, 14);
  return `${prefix}-${stamp}-${randomUUID().slice(0, 8)}`;
}

export function createWorkspace(baseDir, taskId = createTaskId()) {
  if (!/^[A-Za-z0-9._-]{1,120}$/.test(String(taskId))) throw new Error(`Invalid taskId: ${taskId}`);
  const root = join(expandHome(baseDir), taskId);
  const dirs = {
    root,
    results: join(root, "results"),
    artifacts: join(root, "artifacts"),
    logs: join(root, "logs")
  };
  for (const path of Object.values(dirs)) mkdirSync(path, { recursive: true });
  return { taskId, dirs };
}

export function writeJson(path, value, options = {}) {
  const payload = options.redact === false ? value : redactValue(value);
  writeFileSync(path, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
}

export function appendEvent(path, event) {
  const payload = { time: new Date().toISOString(), ...redactValue(event) };
  appendFileSync(path, `${JSON.stringify(payload)}\n`, "utf8");
}

export function writeText(path, value) {
  writeFileSync(path, redactText(String(value)), "utf8");
}
