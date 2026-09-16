import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

test("MCP server exposes expected tools", async () => {
  const root = await mkdtemp(join(tmpdir(), "codex-moa-mcp-"));
  const client = new Client({ name: "codex-moa-test", version: "1.0.0" });
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: ["mcp/server.bundle.mjs", "--stdio"],
    cwd: process.cwd(),
    env: {
      ...process.env,
      CODEX_THREAD_ID: "",
      CODEX_MOA_JOB_HOME: join(root, "jobs"),
      CODEX_MOA_BLACKBOARD: join(root, "blackboard"),
      CODEX_MOA_SEAT_REGISTRY: join(root, "seats.json"),
      CODEX_MOA_COST_LEDGER: join(root, "cost.jsonl"),
      CODEX_MOA_FAILURE_MEMORY: join(root, "failures.jsonl"),
      CODEX_MOA_CONTINUITY_PATH: join(root, "continuity.json"),
      CODEX_MOA_MEMORY_HOME: join(root, "memory"),
      CODEX_MOA_EVOLUTION_HOME: join(root, "evolution"),
      CODEX_MOA_POLICY_PATH: join(root, "evolution-policy.json"),
      CODEX_MOA_CONTROL_PATH: join(root, "control.json"),
      CODEX_MOA_ROUTING_EXPERIMENT_PATH: join(root, "routing.json"),
      CODEX_MOA_MODE_PATH: join(root, "mode.json")
    }
  });
  await client.connect(transport);
  try {
    const tools = await client.listTools();
    const names = tools.tools.map((tool) => tool.name).sort();
    assert.deepEqual(names, ["moa_audit", "moa_audit_metrics", "moa_capabilities", "moa_captain", "moa_captain_usage", "moa_ccswitch", "moa_compat", "moa_context", "moa_delegate", "moa_doctor", "moa_evolve", "moa_health", "moa_interrupt", "moa_job_ack", "moa_job_cancel", "moa_job_notify", "moa_job_pause", "moa_job_resume", "moa_job_status", "moa_job_steer", "moa_job_wait", "moa_memory", "moa_mode", "moa_models", "moa_patch_metrics", "moa_plan", "moa_provider_recovery", "moa_quota", "moa_retention", "moa_run", "moa_schedule", "moa_seats", "moa_start", "moa_worktrees"]);
    const mode = await client.callTool({ name: "moa_mode", arguments: { action: "status" } });
    assert.equal(JSON.parse(mode.content[0].text).mode, "auto");
    const result = await client.callTool({
      name: "moa_plan",
      arguments: { task: "explain this function", stakes: "low" }
    });
    assert.match(result.content[0].text, /"level": "L0"/);
    const models = await client.callTool({ name: "moa_models", arguments: {} });
    assert.equal(JSON.parse(models.content[0].text).models.length, 5);
    const compat = await client.callTool({ name: "moa_compat", arguments: {} });
    assert.equal(JSON.parse(compat.content[0].text).plugin, "codex-moa");
    const quota = await client.callTool({ name: "moa_quota", arguments: { refresh: false } });
    assert.ok(quota.content[0].text.length > 0);
    const ccswitch = await client.callTool({ name: "moa_ccswitch", arguments: {} });
    assert.ok(ccswitch.content[0].text.length > 0);
    const capabilities = await client.callTool({ name: "moa_capabilities", arguments: {} });
    assert.equal(JSON.parse(capabilities.content[0].text).models.length, 5);
    const captain = await client.callTool({ name: "moa_captain", arguments: { captainModel: "DeepSeek-flash" } });
    assert.equal(JSON.parse(captain.content[0].text).canonicalModel, "DeepSeek-flash");
    const evolution = await client.callTool({ name: "moa_evolve", arguments: { action: "status" } });
    assert.ok(JSON.parse(evolution.content[0].text).analysis);
    const drafted = await client.callTool({
      name: "moa_evolve",
      arguments: {
        action: "propose",
        draft: { title: "MCP gated proposal", problem: "Test the approval gate", policyPatch: { timeouts: { deepMs: 1234 } } }
      }
    });
    const proposalId = JSON.parse(drafted.content[0].text).id;
    const premature = await client.callTool({ name: "moa_evolve", arguments: { action: "apply", proposalId, confirmation: `APPLY ${proposalId}` } });
    assert.equal(premature.isError, true);
    const approved = await client.callTool({ name: "moa_evolve", arguments: { action: "approve", proposalId, confirmation: `APPROVE ${proposalId}` } });
    assert.equal(JSON.parse(approved.content[0].text).status, "approved");
    const applied = await client.callTool({ name: "moa_evolve", arguments: { action: "apply", proposalId, confirmation: `APPLY ${proposalId}` } });
    assert.equal(JSON.parse(applied.content[0].text).status, "applied");
    const memory = await client.callTool({ name: "moa_memory", arguments: { action: "load", memoryKey: "test-memory" } });
    assert.ok(JSON.parse(memory.content[0].text).pack !== undefined);
    const health = await client.callTool({ name: "moa_health", arguments: {} });
    assert.ok(JSON.parse(health.content[0].text).providerHealth);
    const interrupt = await client.callTool({ name: "moa_interrupt", arguments: { action: "status" } });
    assert.ok(Array.isArray(JSON.parse(interrupt.content[0].text).seats));
    const retention = await client.callTool({ name: "moa_retention", arguments: { action: "plan" } });
    assert.ok(JSON.parse(retention.content[0].text).plan);
    const patchMetrics = await client.callTool({ name: "moa_patch_metrics", arguments: {} });
    assert.ok(JSON.parse(patchMetrics.content[0].text).actions !== undefined);
    const recovery = await client.callTool({ name: "moa_provider_recovery", arguments: { action: "status" } });
    assert.ok(JSON.parse(recovery.content[0].text).providers);
    const worktrees = await client.callTool({ name: "moa_worktrees", arguments: { action: "list", cwd: process.cwd() } });
    assert.ok(Array.isArray(JSON.parse(worktrees.content[0].text).worktrees));
    const jobs = await client.callTool({ name: "moa_job_status", arguments: {} });
    assert.ok(Array.isArray(JSON.parse(jobs.content[0].text).jobs));
    const started = await client.callTool({ name: "moa_start", arguments: { task: "explain this function", cwd: process.cwd(), stakes: "low", respectQuota: false, routingExperiment: false, contextPack: false } });
    const startedPayload = JSON.parse(started.content[0].text);
    const jobId = startedPayload.jobId;
    assert.equal(startedPayload.interaction.captainShouldYield, true);
    assert.equal(startedPayload.interaction.maxWaitMs, 10000);
    const waited = await client.callTool({ name: "moa_job_wait", arguments: { jobId, timeoutMs: 10000 } });
    const waitedPayload = JSON.parse(waited.content[0].text);
    assert.equal(waitedPayload.job.status, "completed");
    assert.equal(waitedPayload.interaction.captainShouldYield, false);
  } finally {
    await client.close();
  }
});
