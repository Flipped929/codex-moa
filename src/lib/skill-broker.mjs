import { existsSync, realpathSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { isAbsolute, join, relative, resolve } from "node:path";

function expandHome(value) {
  if (value === "~") return homedir();
  if (String(value).startsWith("~/")) return resolve(homedir(), String(value).slice(2));
  return resolve(String(value));
}

function within(path, root) {
  const rel = relative(root, path);
  return rel === "" || (!rel.startsWith("..") && !isAbsolute(rel));
}

export function resolveSkillPaths(skillRefs = [], config = {}) {
  if (!Array.isArray(skillRefs)) throw new Error("skills must be an array");
  const roots = (config.skills?.allowedRoots ?? [
    "~/.cc-switch/skills",
    "~/.codex/skills",
    "~/.agents/skills",
    "~/.pi/agent/skills",
    "~/.codex/plugins"
  ]).map(expandHome).filter(existsSync).map((path) => realpathSync(path));
  const searchRoots = (config.skills?.searchRoots ?? ["~/.cc-switch/skills", "~/.pi/agent/skills"]).map(expandHome);
  const output = [];

  for (const raw of skillRefs) {
    const ref = String(raw ?? "").trim();
    if (!ref) continue;
    const candidates = ref.includes("/") || isAbsolute(ref)
      ? [expandHome(ref)]
      : searchRoots.map((root) => join(root, ref));
    const found = candidates.find(existsSync);
    if (!found) throw new Error(`Skill not found: ${ref}`);
    const resolved = realpathSync(found);
    if (!roots.some((root) => within(resolved, root))) {
      throw new Error(`Skill path is outside configured allowed roots: ${resolved}`);
    }
    if (!statSync(resolved).isDirectory() && !resolved.endsWith("SKILL.md")) {
      throw new Error(`Skill reference must be a directory or SKILL.md: ${resolved}`);
    }
    if (!output.includes(resolved)) output.push(resolved);
  }
  return output;
}
