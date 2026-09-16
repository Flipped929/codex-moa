import { chmod, mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { readCcSwitchPiProviderConfigs } from "./ccswitch.mjs";

function expandHome(value) {
  if (value === "~") return homedir();
  if (typeof value === "string" && value.startsWith("~/")) return resolve(homedir(), value.slice(2));
  return resolve(value);
}

async function readJson(path) {
  try { return JSON.parse(await readFile(path, "utf8")); } catch (error) {
    if (error?.code === "ENOENT") return {};
    throw error;
  }
}

async function atomicWritePrivate(path, value) {
  await mkdir(dirname(path), { recursive: true, mode: 0o700 });
  const temporary = join(dirname(path), `.${path.split("/").pop()}.${randomUUID()}.tmp`);
  await writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`, { encoding: "utf8", mode: 0o600 });
  await rename(temporary, path);
  await chmod(path, 0o600);
}

export async function preparePiHome(config = {}) {
  const home = expandHome(config.pi?.headlessHome ?? "~/.codex-moa/pi-home");
  await mkdir(home, { recursive: true, mode: 0o700 });
  await chmod(home, 0o700).catch(() => {});
  const modelsPath = join(home, "models.json");
  const existing = await readJson(modelsPath);
  const snapshot = await readCcSwitchPiProviderConfigs();
  if (!snapshot.available) throw new Error(`CC Switch Pi provider sync unavailable: ${snapshot.reason}`);
  const allowlist = config.pi?.providerAllowlist ?? [];
  const allProviders = snapshot.providers ?? {};
  const providers = allowlist.length > 0
    ? Object.fromEntries(allowlist.filter((id) => allProviders[id]).map((id) => [id, allProviders[id]]))
    : allProviders;
  const missing = allowlist.filter((id) => !allProviders[id]);
  if (missing.length > 0) throw new Error(`CC Switch Pi provider(s) not configured: ${missing.join(", ")}`);
  await atomicWritePrivate(modelsPath, { ...existing, providers });
  return {
    home,
    modelsPath,
    providerIds: Object.keys(providers),
    errors: snapshot.errors ?? []
  };
}
