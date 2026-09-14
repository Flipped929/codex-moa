import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, stat, writeFile, mkdir } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { resolveZCodeSelection, syncZCodeSelection } from "../src/lib/zcode-model.mjs";

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), "codex-moa-zcode-"));
  const desktopConfig = join(root, "desktop.json");
  const settingsPath = join(root, "settings.json");
  const cliConfig = join(root, "cli.json");
  await writeFile(desktopConfig, JSON.stringify({
    provider: {
      "builtin:test": {
        name: "Test Provider",
        kind: "anthropic",
        enabled: true,
        options: { baseURL: "https://example.invalid", apiKey: "test-key" },
        models: {
          "GLM-5.3": { id: "GLM-5.3", name: "GLM-5.3" },
          "GLM-5.3-Flash": { id: "GLM-5.3-Flash", name: "GLM-5.3-Flash" }
        }
      },
      "builtin:headless": {
        name: "Headless Provider",
        kind: "anthropic",
        enabled: true,
        options: { baseURL: "https://headless.invalid", apiKey: "headless-key" },
        models: {
          "GLM-5.3": { id: "GLM-5.3", name: "GLM-5.3" },
          "GLM-5.3-Flash": { id: "GLM-5.3-Flash", name: "GLM-5.3-Flash" }
        }
      }
    }
  }), "utf8");
  await writeFile(settingsPath, JSON.stringify({
    modelProviderFamilySelectedKeys: { bigmodel: "coding-plan:builtin:test" }
  }), "utf8");
  await mkdir(join(root, "cli"), { recursive: true });
  return { root, desktopConfig, settingsPath, cliConfig: join(root, "cli", "config.json") };
}

test("resolves GLM model to the selected provider", async () => {
  const paths = await fixture();
  const selection = await resolveZCodeSelection({
    model: "GLM-5.3-Flash",
    config: { zcode: paths }
  });
  assert.equal(selection.providerId, "builtin:test");
  assert.equal(selection.modelKey, "GLM-5.3-Flash");
});

test("headlessProvider overrides the UI-selected provider only for codex-moa", async () => {
  const paths = await fixture();
  const selection = await resolveZCodeSelection({
    model: "GLM-5.3-Flash",
    config: { zcode: { ...paths, headlessProvider: "builtin:headless" } }
  });
  assert.equal(selection.providerId, "builtin:headless");
});

test("syncs provider and model into the CLI config with restrictive permissions", async () => {
  const paths = await fixture();
  const result = await syncZCodeSelection({
    model: "GLM-5.3",
    reasoningEffort: "high",
    config: { zcode: paths }
  });
  assert.equal(result.modelRef, "builtin:test/GLM-5.3");
  const written = JSON.parse(await readFile(paths.cliConfig, "utf8"));
  assert.equal(written.model, "builtin:test/GLM-5.3");
  assert.equal(written.provider["builtin:test"].kind, "anthropic");
  assert.equal(written.thoughtLevel, "high");
  assert.equal(written.provider["builtin:test"].models["GLM-5.3"].reasoning.defaultVariant, "high");
  const mode = (await stat(paths.cliConfig)).mode & 0o777;
  assert.equal(mode, 0o600);
});
