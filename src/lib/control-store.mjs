import { randomUUID } from "node:crypto";
import { homedir } from "node:os";
import { resolve } from "node:path";
import { readJsonStore, updateJsonStore, writeJsonAtomic, withFileLock } from "./json-store.mjs";

const CONTROL_VERSION = 2;
const DEFAULT_STORE = { version: CONTROL_VERSION, requests: [] };
const MIGRATIONS = {
  1: (store) => ({ ...store, requests: store.requests ?? [], updatedAt: store.updatedAt ?? new Date().toISOString() })
};

function expandHome(value) {
  if (typeof value !== "string") return value;
  if (value === "~") return homedir();
  if (value.startsWith("~/")) return resolve(homedir(), value.slice(2));
  return resolve(value);
}

export function controlStorePath() {
  return expandHome(process.env.CODEX_MOA_CONTROL_PATH || "~/.codex-moa/control.json");
}

async function readStore(path) {
  return readJsonStore(path, { version: CONTROL_VERSION, defaultValue: DEFAULT_STORE, migrations: MIGRATIONS });
}

export async function readControlStore(path = controlStorePath()) {
  return readStore(path);
}

function normalizeStore(store) {
  return {
    version: CONTROL_VERSION,
    updatedAt: new Date().toISOString(),
    requests: (store.requests ?? []).slice(-200)
  };
}

export async function writeControlStore(store, path = controlStorePath()) {
  const safe = normalizeStore(store);
  await withFileLock(path, () => writeJsonAtomic(path, safe));
  return path;
}

async function updateStore(path, updater) {
  return updateJsonStore(path, async (store) => normalizeStore(await updater(store)), {
    version: CONTROL_VERSION,
    defaultValue: DEFAULT_STORE,
    migrations: MIGRATIONS
  });
}

export async function requestCancellation({ taskId = null, seat = null, key = null, reason = null, expiresInMs = 300000 } = {}) {
  let request;
  await updateStore(controlStorePath(), (store) => {
    const now = Date.now();
    request = {
      id: `ctl-${now.toString(36)}-${randomUUID().slice(0, 8)}`,
      action: "cancel",
      taskId,
      seat,
      key,
      reason,
      status: "pending",
      requestedAt: new Date(now).toISOString(),
      expiresAt: new Date(now + expiresInMs).toISOString()
    };
    store.requests = [...(store.requests ?? []), request];
    return store;
  });
  return request;
}

function matches(request, target) {
  if (request.action !== "cancel" || request.status !== "pending") return false;
  if (request.taskId && request.taskId !== target.taskId) return false;
  if (request.seat && request.seat !== target.seat) return false;
  if (request.key && request.key !== target.key) return false;
  return Boolean(request.taskId || request.seat || request.key);
}

export async function pendingCancellationFor(target, path = controlStorePath()) {
  const store = await readStore(path);
  const now = Date.now();
  const expired = (store.requests ?? []).some((request) => request.status === "pending" && Date.parse(request.expiresAt) < now);
  if (expired) {
    await updateStore(path, (latest) => {
      for (const request of latest.requests ?? []) {
        if (request.status === "pending" && Date.parse(request.expiresAt) < now) {
          request.status = "expired";
          request.resolvedAt = new Date(now).toISOString();
        }
      }
      return latest;
    });
  }
  return (store.requests ?? []).find((request) => matches(request, target)) ?? null;
}

export async function resolveControlRequest(id, { status = "fulfilled", detail = null } = {}, path = controlStorePath()) {
  let resolved = null;
  await updateStore(path, (store) => {
    const request = (store.requests ?? []).find((item) => item.id === id);
    if (!request) return store;
    request.status = status;
    request.detail = detail;
    request.resolvedAt = new Date().toISOString();
    resolved = request;
    return store;
  });
  return resolved;
}

export function listControlRequests(store) {
  return [...(store?.requests ?? [])].sort((a, b) => String(b.requestedAt).localeCompare(String(a.requestedAt)));
}
