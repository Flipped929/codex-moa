#!/usr/bin/env node
import { providerCircuitStatus, readProviderState, recoverProviders } from "../src/lib/provider-state.mjs";

const force = process.argv.includes("--force");
const probe = process.argv.includes("--probe");
if (probe) {
  console.log(JSON.stringify(await recoverProviders({ force }), null, 2));
} else {
  const state = await readProviderState();
  console.log(JSON.stringify({ providers: Object.fromEntries(["kimi", "zai", "deepseek"].map((id) => [id, providerCircuitStatus(state, id)])) }, null, 2));
}
