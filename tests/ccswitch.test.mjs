import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { bindModelsToCcSwitch, ccswitchRoutingAudit, readCcSwitchSnapshot } from "../src/lib/ccswitch.mjs";

let DatabaseSync;
try {
  ({ DatabaseSync } = await import("node:sqlite"));
} catch {}

test("reads cc-switch providers and skills without exposing credentials", { skip: !DatabaseSync }, async () => {
  const root = await mkdtemp(join(tmpdir(), "codex-moa-ccswitch-"));
  await mkdir(join(root, "skills"), { recursive: true });
  await writeFile(join(root, "settings.json"), JSON.stringify({
    currentProviderCodex: "codex-glm",
    currentProviderClaude: null,
    enableLocalProxy: false,
    proxyConfirmed: true,
    skillStorageLocation: "cc_switch",
    skillSyncMethod: "auto"
  }), "utf8");
  const db = new DatabaseSync(join(root, "cc-switch.db"));
  db.exec(`
    CREATE TABLE providers (
      id TEXT PRIMARY KEY, app_type TEXT, name TEXT, category TEXT,
      is_current INTEGER, sort_index INTEGER, settings_config TEXT, meta TEXT
    );
    CREATE TABLE skills (
      id TEXT PRIMARY KEY, name TEXT, description TEXT, directory TEXT,
      repo_owner TEXT, repo_name TEXT, enabled_claude INTEGER,
      enabled_codex INTEGER, enabled_gemini INTEGER, enabled_opencode INTEGER,
      enabled_hermes INTEGER, enabled_grokbuild INTEGER
    );
  `);
  db.prepare("INSERT INTO providers VALUES (?, ?, ?, ?, ?, ?, ?, ?)").run(
    "codex-glm", "codex", "Zhipu GLM", "cn_official", 1, 1,
    JSON.stringify({
      auth: "secret",
      config: 'model_provider = "custom"\n[model_providers.custom]\nbase_url = "https://open.bigmodel.cn/api/v1"\nwire_api = "responses"',
      modelCatalog: { models: [{ model: "glm-5.3" }] }
    }),
    JSON.stringify({ apiFormat: "openai_responses" })
  );
  db.prepare("INSERT INTO skills VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)").run(
    "local:codex-moa", "codex-moa", "", "codex-moa", null, null,
    0, 1, 0, 0, 0, 0
  );
  db.close();

  const previous = process.env.CC_SWITCH_HOME;
  const previousCodexHome = process.env.CODEX_HOME;
  process.env.CC_SWITCH_HOME = root;
  process.env.CODEX_HOME = join(root, "codex-home");
  try {
    const snapshot = await readCcSwitchSnapshot();
    assert.equal(snapshot.available, true);
    assert.equal(snapshot.currentProviders.codex.name, "Zhipu GLM");
    assert.deepEqual(snapshot.providers[0].models, ["glm-5.3"]);
    assert.equal(snapshot.providers[0].apiFormat, "openai_responses");
    assert.equal(snapshot.providers[0].transport.routingMode, "direct");
    assert.equal(snapshot.settings.localProxyEnabled, false);
    assert.equal(JSON.stringify(snapshot).includes("secret"), false);
    assert.equal(snapshot.skills[0].enabled.codex, true);
    const bindings = bindModelsToCcSwitch(snapshot, {
      models: { "GLM-5.3": { id: "GLM-5.3", providerModel: "glm-5.3", displayName: "GLM-5.3" } },
      aliases: {},
      tiers: {},
      seats: {}
    });
    assert.equal(bindings["GLM-5.3"][0].name, "Zhipu GLM");
    const routing = ccswitchRoutingAudit(snapshot, {
      models: { "GLM-5.3": { id: "GLM-5.3", providerModel: "glm-5.3", displayName: "GLM-5.3" } },
      aliases: {},
      tiers: {},
      seats: {}
    });
    assert.equal(routing.models["GLM-5.3"].status, "direct_ready");
  } finally {
    if (previous === undefined) delete process.env.CC_SWITCH_HOME;
    else process.env.CC_SWITCH_HOME = previous;
    if (previousCodexHome === undefined) delete process.env.CODEX_HOME;
    else process.env.CODEX_HOME = previousCodexHome;
  }
});
