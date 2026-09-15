import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { applyReasoningPatch, patchCodexCatalog, patchProviderConfig } from "../src/lib/ccswitch-patch.mjs";

test("fills missing codex modelCatalog reasoning metadata without overwriting values", () => {
  const raw = JSON.stringify({
    auth: { OPENAI_API_KEY: "secret-value" },
    modelCatalog: {
      models: [
        { model: "glm-5.3", displayName: "GLM-5.3" },
        {
          model: "glm-5.3-flash",
          displayName: "glm-5.3-flash",
          reasoningLevels: ["medium", "max"],
          defaultReasoningLevel: "high"
        }
      ]
    }
  });
  const patched = patchProviderConfig("codex", "Zhipu GLM", raw);
  assert.equal(patched.changed, true);
  assert.deepEqual(patched.config.modelCatalog.models[0].reasoningLevels, ["low", "high", "max"]);
  assert.equal(patched.config.modelCatalog.models[0].defaultReasoningLevel, "max");
  assert.deepEqual(patched.config.modelCatalog.models[1].reasoningLevels, ["medium", "max", "low", "high"]);
  assert.equal(patched.config.modelCatalog.models[1].defaultReasoningLevel, "high");
  assert.equal(patched.config.auth.OPENAI_API_KEY, "secret-value");
  const pi = patchProviderConfig("pi", "Kimi For Coding", JSON.stringify({
    apiKey: "secret",
    models: [{ id: "k3", reasoning: false, thinkingLevelMap: { max: "max" } }]
  }));
  assert.equal(pi.config.models[0].reasoning, false);
  assert.deepEqual(pi.config.models[0].thinkingLevelMap, { max: "max", low: "low", high: "high" });
  assert.equal(pi.config.models[0].contextWindow, 1048576);
  assert.equal(pi.config.models[0].maxTokens, 131072);
});

test("does not rewrite Codex transport or metadata", () => {
  const config = 'model_provider = "custom"\nmodel = "k3"\n[model_providers.custom]\nbase_url = "https://api.kimi.com/coding/v1"\nwire_api = "responses"';
  const meta = {
    apiFormat: "openai_chat",
    promptCacheRouting: "enabled",
    codexChatReasoning: { supportsThinking: true }
  };
  const raw = JSON.stringify({
    auth: { OPENAI_API_KEY: "secret-value" },
    config
  });
  const patched = patchProviderConfig("codex", "Kimi For Coding", raw, JSON.stringify(meta));
  assert.equal(patched.changed, false);
  assert.equal(patched.metaChanged, false);
  assert.equal(patched.config.config, config);
  assert.deepEqual(patched.meta, meta);
  assert.equal(patched.metaRaw, JSON.stringify(meta));
});

test("fills Kimi Code reasoning levels with harness-specific defaults", () => {
  const patched = patchProviderConfig("codex", "Kimi For Coding", JSON.stringify({
    modelCatalog: { models: [{ model: "k3" }, { model: "kimi-for-coding" }] }
  }));
  assert.deepEqual(patched.config.modelCatalog.models[0].reasoningLevels, ["low", "high", "max"]);
  assert.equal(patched.config.modelCatalog.models[0].defaultReasoningLevel, "high");
  assert.equal(patched.config.modelCatalog.models[1].defaultReasoningLevel, "max");
});

test("fills derived Codex catalog gaps without removing custom levels or defaults", () => {
  const patched = patchCodexCatalog(JSON.stringify({
    models: [{
      slug: "deepseek-flash",
      supported_reasoning_levels: [{ effort: "medium" }, { effort: "high" }],
      default_reasoning_level: "low"
    }]
  }));
  assert.equal(patched.changed, true);
  const model = JSON.parse(patched.raw).models[0];
  assert.deepEqual(model.supported_reasoning_levels.map((item) => item.effort), ["medium", "high", "none", "low", "max"]);
  assert.equal(model.default_reasoning_level, "low");
});

let DatabaseSync;
try { ({ DatabaseSync } = await import("node:sqlite")); } catch {}

test("拒写 CC Switch 库，只读审计仍报出待补字段", { skip: !DatabaseSync }, async () => {
  const root = await mkdtemp(join(tmpdir(), "codex-moa-patch-"));
  const dbPath = join(root, "cc-switch.db");
  const catalogPath = join(root, "cc-switch-model-catalog.json");
  await writeFile(catalogPath, JSON.stringify({ models: [] }), "utf8");
  const db = new DatabaseSync(dbPath);
  db.exec("CREATE TABLE providers (id TEXT PRIMARY KEY, app_type TEXT, name TEXT, settings_config TEXT, meta TEXT)");
  db.prepare("INSERT INTO providers VALUES (?, ?, ?, ?, ?)").run(
    "pi-deepseek", "pi", "deepseek",
    JSON.stringify({ apiKey: "secret", models: [{ id: "deepseek-v4-flash", reasoning: true, thinkingLevelMap: { max: "max" } }] }),
    JSON.stringify({ apiFormat: "openai_responses" })
  );
  db.close();

  await assert.rejects(
    () => applyReasoningPatch({ databasePath: dbPath, codexCatalogPath: catalogPath, write: true, backupRoot: join(root, "backups") }),
    /只读/
  );

  const audit = await applyReasoningPatch({ databasePath: dbPath, codexCatalogPath: catalogPath, write: false, backupRoot: join(root, "backups") });
  assert.equal(audit.readOnly, true);
  assert.equal(audit.changed, 1);

  // 库与 catalog 均未被改动
  const verify = new DatabaseSync(dbPath);
  const config = JSON.parse(verify.prepare("SELECT settings_config FROM providers WHERE id = ?").get("pi-deepseek").settings_config);
  const meta = verify.prepare("SELECT meta FROM providers WHERE id = ?").get("pi-deepseek").meta;
  verify.close();
  assert.deepEqual(config.models[0].thinkingLevelMap, { max: "max" });
  assert.equal(config.apiKey, "secret");
  assert.deepEqual(JSON.parse(meta), { apiFormat: "openai_responses" });
  assert.deepEqual(JSON.parse(await readFile(catalogPath, "utf8")), { models: [] });
});
