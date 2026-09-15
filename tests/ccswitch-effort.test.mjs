import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  patchCodexLiveReasoningEffort,
  patchCodexReasoningEffort,
  setCodexProviderReasoningEffort
} from "../src/lib/ccswitch-effort.mjs";

test("patches Codex reasoning effort in provider settings and live TOML", () => {
  const provider = patchCodexReasoningEffort(JSON.stringify({
    auth: { OPENAI_API_KEY: "secret-value" },
    config: 'model = "deepseek-flash"\nmodel_reasoning_effort = "high"\n'
  }), "max");
  assert.equal(provider.changed, true);
  assert.equal(provider.settings.auth.OPENAI_API_KEY, "secret-value");
  assert.match(provider.settings.config, /^model_reasoning_effort = "max"$/m);

  const live = patchCodexLiveReasoningEffort('model = "deepseek-flash"\nmodel_reasoning_effort = "high"\n', "low");
  assert.equal(live.changed, true);
  assert.match(live.raw, /^model_reasoning_effort = "low"$/m);
});

let DatabaseSync;
try { ({ DatabaseSync } = await import("node:sqlite")); } catch {}

test("拒写 CC Switch 卡与 live config，只返回只读差异", { skip: !DatabaseSync }, async () => {
  const root = await mkdtemp(join(tmpdir(), "codex-moa-effort-"));
  const dbPath = join(root, "cc-switch.db");
  const codexConfigPath = join(root, "config.toml");
  const db = new DatabaseSync(dbPath);
  db.exec("CREATE TABLE providers (id TEXT PRIMARY KEY, app_type TEXT, name TEXT, settings_config TEXT)");
  db.prepare("INSERT INTO providers VALUES (?, ?, ?, ?)").run(
    "deepseek", "codex", "DeepSeek",
    JSON.stringify({ auth: { OPENAI_API_KEY: "secret" }, config: 'model = "deepseek-flash"\nmodel_reasoning_effort = "high"\n' })
  );
  db.close();
  const before = 'model = "deepseek-flash"\nmodel_reasoning_effort = "high"\n';
  await writeFile(codexConfigPath, before, "utf8");

  // 写模式必须被拒（用户裁决 2026-09-15：codex-moa 不写 CC Switch）
  await assert.rejects(
    () => setCodexProviderReasoningEffort({
      databasePath: dbPath,
      codexConfigPath,
      backupRoot: join(root, "backups"),
      providerName: "DeepSeek",
      effort: "max",
      write: true
    }),
    /只读/
  );

  // 只读审计仍给出差异
  const result = await setCodexProviderReasoningEffort({
    databasePath: dbPath,
    codexConfigPath,
    backupRoot: join(root, "backups"),
    providerName: "DeepSeek",
    effort: "max",
    write: false
  });
  assert.equal(result.readOnly, true);
  assert.equal(result.providerChanged, true);
  assert.equal(result.liveConfigChanged, true);

  // 库与 live config 均未被改动
  const verify = new DatabaseSync(dbPath);
  const settings = JSON.parse(verify.prepare("SELECT settings_config FROM providers WHERE id = ?").get("deepseek").settings_config);
  verify.close();
  assert.match(settings.config, /^model_reasoning_effort = "high"$/m);
  assert.equal(settings.auth.OPENAI_API_KEY, "secret");
  assert.equal(await readFile(codexConfigPath, "utf8"), before);
});
