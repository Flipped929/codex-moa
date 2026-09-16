#!/usr/bin/env node
import { capabilityMatrix, liveCapabilityProbe } from "../src/lib/capability-probe.mjs";

const args = process.argv.slice(2);
const valueAfter = (name) => {
  const index = args.indexOf(name);
  return index >= 0 ? args[index + 1] : null;
};
if (!args.includes("--live")) {
  console.log(JSON.stringify(await capabilityMatrix(), null, 2));
  process.exit(0);
}
const model = valueAfter("--model");
if (!model) throw new Error("--model is required with --live");
const result = await liveCapabilityProbe({
  model,
  harness: valueAfter("--harness") ?? "pi",
  cwd: valueAfter("--cwd") ?? process.cwd(),
  reasoningEffort: valueAfter("--effort") ?? undefined,
  timeoutMs: Number(valueAfter("--timeout-ms") ?? 60000),
  feature: valueAfter("--feature") ?? "text-tool"
});
console.log(JSON.stringify(result, null, 2));
process.exit(result.status === "done" && result.passed ? 0 : 1);
