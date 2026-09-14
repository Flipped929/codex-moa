import test from "node:test";
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { prepareZCodeHome } from "../src/lib/zcode-home.mjs";

test("prepares an isolated ZCode home and links shared credentials", async () => {
  const root = await mkdtemp(join(tmpdir(), "codex-moa-zcode-home-"));
  const realV2 = join(root, "real-v2");
  await mkdir(realV2, { recursive: true });
  await writeFile(join(realV2, "credentials.json"), "{}\n", "utf8");
  const home = join(root, "isolated");
  const result = await prepareZCodeHome({
    zcode: {
      headlessHome: home,
      desktopConfig: join(realV2, "config.json")
    }
  });
  assert.equal(result.home, home);
  assert.equal(result.cliConfigPath, join(home, ".zcode", "cli", "config.json"));
  assert.equal(existsSync(join(home, ".zcode", "v2", "credentials.json")), true);
});
