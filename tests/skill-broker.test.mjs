import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import { realpathSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { resolveSkillPaths } from "../src/lib/skill-broker.mjs";

test("skill broker resolves named skills only from allowlisted roots", async () => {
  const root = await mkdtemp(join(tmpdir(), "codex-moa-skills-"));
  const skill = join(root, "example");
  await mkdir(skill);
  await writeFile(join(skill, "SKILL.md"), "---\nname: example\n---\n");
  const config = { skills: { searchRoots: [root], allowedRoots: [root] } };
  assert.deepEqual(resolveSkillPaths(["example"], config), [realpathSync(skill)]);
  assert.throws(() => resolveSkillPaths(["/tmp"], config), /outside configured allowed roots/);
});
