import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { prepareDshHome } from "../src/lib/dsh-home.mjs";

test("prepares an isolated DSH home with selected reasoning effort", async () => {
  const root = await mkdtemp(join(tmpdir(), "codex-moa-dsh-"));
  const sourceHome = join(root, "source");
  const targetRoot = join(root, "homes");
  await mkdir(join(sourceHome, "profiles"), { recursive: true });
  await mkdir(join(sourceHome, "skills"), { recursive: true });
  await writeFile(join(sourceHome, ".credentials.yaml"), "version: 1\n", "utf8");
  await writeFile(join(sourceHome, "settings.yaml"), [
    "agent-default-model:",
    "  provider: deepseek-official",
    "  model: deepseek-flash",
    "  reasoningEffort: max",
    "llm-deepseek:",
    "  thinking: enabled",
    "  reasoningEffort: max"
  ].join("\n"), "utf8");

  const prepared = await prepareDshHome("high", { sourceHome, targetRoot });
  const settings = await readFile(join(prepared.home, "settings.yaml"), "utf8");
  assert.match(settings, /agent-default-model:[\s\S]*reasoningEffort: high/);
  assert.match(settings, /llm-deepseek:[\s\S]*reasoningEffort: high/);
  assert.equal(prepared.effort, "high");
});
