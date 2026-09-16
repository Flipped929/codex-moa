import test from "node:test";
import assert from "node:assert/strict";
import { buildTaskGraph } from "../src/lib/task-graph.mjs";

test("builds layered task graph with executor and auditor dependencies", () => {
  const graph = buildTaskGraph([
    { seat: "architect", role: "architect", model: "kimi-k3" },
    { seat: "executor", role: "executor", model: "GLM-5.3" },
    { seat: "auditor", role: "auditor", model: "DeepSeek-flash" }
  ]);
  assert.deepEqual(graph.layers[0], ["architect"]);
  assert.deepEqual(graph.layers[1], ["executor"]);
  assert.deepEqual(graph.layers[2], ["auditor"]);
  assert.deepEqual(graph.nodes.find((node) => node.id === "auditor").dependsOn, ["executor"]);
});

test("gate and shadow auditors share one parallel layer", () => {
  const graph = buildTaskGraph([
    { seat: "executor", role: "executor", model: "GLM-5.3" },
    { seat: "gate", role: "auditor", auditMode: "gate", model: "kimi-2.8" },
    { seat: "shadow", role: "auditor", auditMode: "shadow", blocking: false, model: "DeepSeek-flash" }
  ]);
  assert.deepEqual(graph.layers, [["executor"], ["gate", "shadow"]]);
  assert.equal(graph.nodes.find((node) => node.id === "shadow").blocking, false);
});
