import test from "node:test";
import assert from "node:assert/strict";
import { applyRoleDefaults, loadRoles } from "../src/lib/roles.mjs";

test("loads default role files and applies defaults", () => {
  const roles = loadRoles();
  assert.ok(roles.get("auditor"));
  const seat = applyRoleDefaults({ seat: "audit-1", role: "auditor", model: "DeepSeek-flash" }, roles);
  assert.equal(seat.mode, "plan");
  // 2026-09-15 用户裁决：角色默认值不再携带 reasoningEffort，交给模型默认
  assert.equal(seat.reasoningEffort, undefined);
});

test("role defaults never inject reasoningEffort", () => {
  const roles = loadRoles();
  for (const role of roles.values()) {
    assert.equal(role.defaults.reasoningEffort, undefined, `role ${role.name} must not default reasoningEffort`);
  }
});
