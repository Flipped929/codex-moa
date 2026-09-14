#!/usr/bin/env node
import { loadConfig } from "../src/lib/config.mjs";
import { smokeAcpHarnesses } from "../src/lib/acp-smoke.mjs";

function option(name, fallback = null) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] ?? fallback : fallback;
}

const harnesses = String(option("--harness", "all")).split(",").map((item) => item.trim()).filter(Boolean);
const timeoutMs = Number(option("--timeout", 180000));
const prompt = option("--prompt", "Reply with exactly ACP_SMOKE_OK and nothing else.");
const result = await smokeAcpHarnesses({ harnesses, config: loadConfig(), timeoutMs, prompt, cwd: process.cwd() });

if (process.argv.includes("--json")) {
  console.log(JSON.stringify(result, null, 2));
} else {
  for (const item of result.results) {
    const icon = item.status === "pass" ? "PASS" : "FAIL";
    console.log(`[${icon}] ${item.harness} transport=${item.transportOk ? "ok" : "failed"} stop=${item.stopReason ?? "n/a"} ${Math.round(item.durationMs / 100)/10}s`);
    if (item.text) console.log(`  ${item.text.slice(0, 300)}`);
    if (item.error) console.log(`  error: ${item.error.slice(0, 500)}`);
  }
}
process.exit(result.ok ? 0 : 1);
