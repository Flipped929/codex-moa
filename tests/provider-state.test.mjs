import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { providerCircuitStatus, readProviderState, recordProviderOutcome, recoverProviders, shouldProbeProvider } from "../src/lib/provider-state.mjs";

test("opens, classifies, and recovers a provider circuit", async () => {
  const root = await mkdtemp(join(tmpdir(), "codex-moa-provider-state-"));
  const path = join(root, "state.json");
  const config = { providerHealth: { failureThreshold: 3, baseOpenMs: 1000, maxOpenMs: 5000, latencyWarningMs: 50, windowSize: 20 } };
  for (let index = 0; index < 3; index += 1) {
    await recordProviderOutcome({ provider: "zai", ok: false, latencyMs: 100 + index, statusCode: 429, error: "429 rate limit" }, path, config);
  }
  let state = await readProviderState(path);
  let circuit = providerCircuitStatus(state, "zai", config);
  assert.equal(circuit.circuit, "open");
  assert.equal(circuit.lastErrorKind, "rate_limit");
  assert.ok(circuit.p95LatencyMs >= 100);

  const future = Date.now() + 2000;
  circuit = providerCircuitStatus(state, "zai", config, future);
  assert.equal(circuit.circuit, "half-open");
  assert.equal(shouldProbeProvider(state, "zai", config, future), true);

  const recovery = await recoverProviders({ config, providers: ["zai"], force: true, deps: { statePath: path, probe: async () => ({ status: "ok" }) } });
  assert.equal(recovery.probed, 1);
  state = await readProviderState(path);
  assert.equal(providerCircuitStatus(state, "zai", config).circuit, "closed");
});
