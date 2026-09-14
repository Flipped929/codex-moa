import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { applyReasoningPatch, patchCodexCatalog, patchProviderConfig } from "../src/lib/ccswitch-patch.mjs";

test("patches codex modelCatalog reasoning metadata without touching secrets", () => {
  const raw = JSON.stringify({
    auth: { OPENAI_API_KEY: "secret-value" },
    modelCatalog: { models: [{ model: "glm-5.3-flash", displayName: "glm-5.3-flash" }] }
  });
  const patched = patchProviderConfig("codex", "Zhipu GLM", raw);
  assert.equal(patched.changed, true);
  assert.deepEqual(patched.config.modelCatalog.models[0].reasoningLevels, ["low", "high", "max"]);
  assert.equal(patched.config.modelCatalog.models[0].defaultReasoningLevel, "max");
  assert.equal(patched.config.auth.OPENAI_API_KEY, "secret-value");
  const pi = patchProviderConfig("pi", "Kimi For Coding", JSON.stringify({ apiKey: "secret", models: [{ id: "k3", reasoning: true, thinkingLevelMap: {} }] }));
  assert.equal(pi.config.models[0].contextWindow, 1048576);
  assert.equal(pi.config.models[0].maxTokens, 131072);
});

test("patches stale Codex transport metadata to native Responses", () => {
  const raw = JSON.stringify({
    auth: { OPENAI_API_KEY: "secret-value" },
    config: 'model_provider = "custom"\nmodel = "glm-5.3"\n[model_providers.custom]\nbase_url = "https://open.bigmodel.cn/api/coding/paas/v4"\nwire_api = "responses"'
  });
  const patched = patchProviderConfig("codex", "Zhipu GLM", raw, JSON.stringify({
    apiFormat: "openai_chat",
    codexChatReasoning: { supportsThinking: true }
  }));
  assert.equal(patched.changed, true);
  assert.equal(patched.metaChanged, true);
  assert.match(patched.config.config, /base_url = "https:\/\/open\.bigmodel\.cn\/api\/v1"/);
  assert.equal(patched.meta.apiFormat, "openai_responses");
  assert.equal("codexChatReasoning" in patched.meta, false);
  assert.equal(patched.config.auth.OPENAI_API_KEY, "secret-value");

  const kimi = patchProviderConfig("codex", "Kimi For Coding", JSON.stringify({
    config: 'model_provider = "custom"\n[model_providers.custom]\nbase_url = "https://api.kimi.com/coding/v1"\nwire_api = "responses"'
  }), JSON.stringify({ apiFormat: "openai_chat", promptCacheRouting: "enabled", codexChatReasoning: {} }));
  assert.equal(kimi.meta.apiFormat, "openai_responses");
  assert.equal("promptCacheRouting" in kimi.meta, false);
  assert.equal("codexChatReasoning" in kimi.meta, false);

  const deepseek = patchProviderConfig("codex", "DeepSeek", JSON.stringify({
    config: 'model_provider = "custom"\nmodel = "deepseek-v4.1-flash-expires-on-0910"\n[model_providers.custom]\nbase_url = "https://api.deepseek.com"\nwire_api = "responses"'
  }), JSON.stringify({ apiFormat: "openai_responses" }));
  assert.match(deepseek.config.config, /^model = "deepseek-flash"$/m);
});

test("patches derived Codex catalog reasoning levels", () => {
  const patched = patchCodexCatalog(JSON.stringify({
    models: [{ slug: "deepseek-flash", supported_reasoning_levels: [{ effort: "none" }, { effort: "high" }] }]
  }));
  assert.equal(patched.changed, true);
  assert.deepEqual(JSON.parse(patched.raw).models[0].supported_reasoning_levels.map((item) => item.effort), ["none", "low", "high", "max"]);
});

let DatabaseSync;
try { ({ DatabaseSync } = await import("node:sqlite")); } catch {}

test("applies cc-switch reasoning patch idempotently", { skip: !DatabaseSync }, async () => {
  const root = await mkdtemp(join(tmpdir(), "codex-moa-ccswitch-patch-"));
  const dbPath = join(root, "cc-switch.db");
  const db = new DatabaseSync(dbPath);
  db.exec("CREATE TABLE providers (id TEXT PRIMARY KEY, app_type TEXT, name TEXT, settings_config TEXT, meta TEXT)");
  db.prepare("INSERT INTO providers VALUES (?, ?, ?, ?, ?)").run(
    "pi-deepseek", "pi", "deepseek",
    JSON.stringify({ apiKey: "secret", models: [{ id: "deepseek-v4-flash", reasoning: true, thinkingLevelMap: { max: "max" } }] }),
    JSON.stringify({ apiFormat: "openai_responses" })
  );
  db.close();

  const first = await applyReasoningPatch({ databasePath: dbPath, write: true, backupRoot: join(root, "backups") });
  assert.equal(first.changed, 1);
  assert.ok(first.backup);
  const second = await applyReasoningPatch({ databasePath: dbPath, write: true, backupRoot: join(root, "backups") });
  assert.equal(second.changed, 0);

  const verify = new DatabaseSync(dbPath);
  const config = JSON.parse(verify.prepare("SELECT settings_config FROM providers WHERE id = ?").get("pi-deepseek").settings_config);
  verify.close();
  assert.deepEqual(config.models[0].thinkingLevelMap, { off: "off", low: "low", high: "high", max: "max" });
  assert.equal(config.apiKey, "secret");
});
