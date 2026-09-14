import { existsSync, readdirSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const roleRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..", "roles");
const ALLOWED_KEYS = ["description", "mode", "modelTier", "runtime", "reasoningEffort", "contextBudget", "outputBudget"];

function loadDir(dir, origin, roles) {
  if (!existsSync(dir)) return;
  for (const file of readdirSync(dir)) {
    if (!file.endsWith(".json")) continue;
    try {
      const raw = JSON.parse(readFileSync(join(dir, file), "utf8"));
      if (!raw.name || typeof raw.name !== "string") continue;
      const defaults = {};
      for (const key of ALLOWED_KEYS) if (raw.defaults?.[key] !== undefined) defaults[key] = raw.defaults[key];
      roles.set(raw.name, { name: raw.name, description: raw.description ?? "", defaults, origin });
    } catch {}
  }
}

export function loadRoles() {
  const roles = new Map();
  loadDir(roleRoot, "package", roles);
  loadDir(resolve(homedir(), ".codex-moa", "roles"), "user", roles);
  return roles;
}

export function applyRoleDefaults(seat, roles) {
  const role = roles.get(seat.role);
  return role ? { ...role.defaults, ...seat } : seat;
}
