import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { estimateUsageCost, makeCostEntry, normalizeUsage, readCostLedger, recordCostEntry, summarizeCostLedger } from "../src/lib/cost-ledger.mjs";
import { summarizeProviderHealth } from "../src/lib/provider-health.mjs";

test("normalizes ACP and CLI token usage", () => {
  assert.deepEqual(normalizeUsage({ inputTokens: 10, outputTokens: 4, thoughtTokens: 2 }), {
    inputTokens: 10,
    outputTokens: 4,
    totalTokens: null,
    reasoningTokens: 2,
    cacheReadTokens: null,
    cacheWriteTokens: null,
    contextUsed: null,
    contextWindow: null
  });
  assert.equal(normalizeUsage({ input_tokens: 20, output_tokens: 5, total_tokens: 25 }).totalTokens, 25);
});

test("prices DeepSeek cache hits and peak/off-peak windows separately", () => {
  const pricing = { currency: "USD", models: { "DeepSeek-flash": { rates: {
    peak: { cacheHitInputPerMillion: 0.006, cacheMissInputPerMillion: 0.3, outputPerMillion: 1.2 },
    "off-peak": { cacheHitInputPerMillion: 0.003, cacheMissInputPerMillion: 0.15, outputPerMillion: 0.6 }
  } } } };
  const usage = { inputTokens: 1_000_000, cacheReadTokens: 500_000, outputTokens: 1_000_000 };
  const peak = estimateUsageCost("DeepSeek-flash", usage, pricing, new Date("2026-09-14T02:00:00Z"));
  const offPeak = estimateUsageCost("DeepSeek-flash", usage, pricing, new Date("2026-09-14T04:30:00Z"));
  assert.equal(peak.pricingPeriod, "peak");
  assert.equal(offPeak.pricingPeriod, "off-peak");
  assert.equal(peak.estimatedUsd, offPeak.estimatedUsd * 2);
});

test("records and summarizes cost entries with provider health", async () => {
  const root = await mkdtemp(join(tmpdir(), "codex-moa-cost-"));
  const path = join(root, "ledger.jsonl");
  const pricing = { currency: "USD", models: { "GLM-5.3-flash": { inputPerMillion: 1, outputPerMillion: 2 } } };
  const seat = { seat: "executor", role: "executor", harness: "zcode", runtime: "acp", model: "GLM-5.3-flash" };
  const result = { status: "done", durationMs: 1000, usage: { inputTokens: 1_000_000, outputTokens: 500_000, totalTokens: 1_500_000, contextUsed: 12345, contextWindow: 200000 } };
  const entry = makeCostEntry({ taskId: "task-1", seat, result, quota: { provider: "zai" }, pricing });
  assert.equal(entry.estimatedUsd, 2);
  assert.equal(entry.throughput.outputTps, 500_000);
  assert.equal(makeCostEntry({ taskId: "task-0", seat, result, pricing: { models: { "GLM-5.3-flash": { inputPerMillion: null, outputPerMillion: null } } } }).estimatedUsd, null);
  await recordCostEntry(entry, path);
  const entries = await readCostLedger(path);
  const summary = summarizeCostLedger(entries);
  assert.equal(summary.totalTokens, 1_500_000);
  assert.equal(summary.estimatedUsd, 2);
  assert.equal(summary.peakContextUsed, 12345);
  assert.equal(summary.routes["GLM-5.3-flash@zcode"].outputTps, 500_000);
  assert.equal(summary.routes["GLM-5.3-flash@zcode"].successRate, 1);
  assert.equal(summary.routes["GLM-5.3-flash@zcode"].sampleSufficient, false);

  const health = summarizeProviderHealth({
    snapshot: { updatedAt: new Date().toISOString(), providers: { kimi: { status: "ok", windows: [] }, zai: { status: "ok", windows: [] }, deepseek: { status: "not_configured", windows: [] } } },
    ledger: entries
  });
  assert.equal(health.providers.zai.status, "healthy");
  assert.equal(health.providers.deepseek.status, "inactive");
});
