import test from "node:test";
import assert from "node:assert/strict";
import { applyRoleDefaults, loadRoles } from "../src/lib/roles.mjs";

test("loads default role files and applies defaults", () => {
  const roles = loadRoles();
  assert.ok(roles.get("auditor"));
  const seat = applyRoleDefaults({ seat: "audit-1", role: "auditor", model: "DeepSeek-flash" }, roles);
  assert.equal(seat.mode, "plan");
  assert.equal(seat.reasoningEffort, "high");
});
