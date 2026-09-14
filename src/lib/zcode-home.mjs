import { existsSync } from "node:fs";
import { chmod, copyFile, mkdir, symlink } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";

function expandHome(value) {
  if (typeof value !== "string") return value;
  if (value === "~") return homedir();
  if (value.startsWith("~/")) return resolve(homedir(), value.slice(2));
  return resolve(value);
}

async function linkOrCopy(source, destination) {
  if (!existsSync(source) || existsSync(destination)) return;
  try {
    await symlink(source, destination);
  } catch {
    await copyFile(source, destination).catch(() => {});
  }
}

export async function prepareZCodeHome(config = {}) {
  const home = expandHome(config.zcode?.headlessHome ?? "~/.codex-moa/zcode-home");
  const cliDir = join(home, ".zcode", "cli");
  const v2Dir = join(home, ".zcode", "v2");
  await mkdir(cliDir, { recursive: true });
  await mkdir(v2Dir, { recursive: true });
  await chmod(home, 0o700).catch(() => {});

  const realV2 = dirname(expandHome(config.zcode?.desktopConfig ?? "~/.zcode/v2/config.json"));
  for (const file of ["credentials.json", "setting.json", "config.json"]) {
    await linkOrCopy(join(realV2, file), join(v2Dir, file));
  }
  return {
    home,
    cliConfigPath: join(cliDir, "config.json"),
    v2Dir
  };
}
