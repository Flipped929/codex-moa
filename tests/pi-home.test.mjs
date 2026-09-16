import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { preparePiHome } from "../src/lib/pi-home.mjs";

let DatabaseSync;
try { ({ DatabaseSync } = await import("node:sqlite")); } catch {}

test("projects CC Switch Pi providers into a private isolated Pi home", { skip: !DatabaseSync }, async () => {
  const root = await mkdtemp(join(tmpdir(), "codex-moa-pi-home-"));
  await writeFile(join(root, "settings.json"), "{}\n", "utf8");
  const db = new DatabaseSync(join(root, "cc-switch.db"));
  db.exec("CREATE TABLE providers (id TEXT PRIMARY KEY, name TEXT, app_type TEXT, settings_config TEXT)");
  db.prepare("INSERT INTO providers VALUES (?, ?, ?, ?)").run(
    "cc-switch-kimi", "Kimi", "pi",
    JSON.stringify({ baseUrl: "https://example.invalid", api: "anthropic-messages", apiKey: "secret", models: [{ id: "k3", contextWindow: 10, maxTokens: 2 }] })
  );
  db.close();
  const previous = process.env.CC_SWITCH_HOME;
  process.env.CC_SWITCH_HOME = root;
  try {
    const result = await preparePiHome({ pi: { headlessHome: join(root, "pi-home"), providerAllowlist: ["cc-switch-kimi"] } });
    assert.deepEqual(result.providerIds, ["cc-switch-kimi"]);
    const projected = JSON.parse(await readFile(result.modelsPath, "utf8"));
    assert.equal(projected.providers["cc-switch-kimi"].apiKey, "secret");
    assert.equal((await stat(result.modelsPath)).mode & 0o777, 0o600);
    assert.equal((await stat(result.home)).mode & 0o777, 0o700);
  } finally {
    if (previous === undefined) delete process.env.CC_SWITCH_HOME;
    else process.env.CC_SWITCH_HOME = previous;
  }
});
