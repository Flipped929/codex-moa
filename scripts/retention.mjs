#!/usr/bin/env node
import { applyRetention, planRetention } from "../src/lib/retention.mjs";

const apply = process.argv.includes("--apply");
const write = process.argv.includes("--write");
if (apply && !write) {
  console.error("Pass --write with --apply to allow actual deletion/compaction.");
  process.exit(2);
}
const result = apply ? await applyRetention({ dryRun: !write }) : { plan: await planRetention() };
console.log(JSON.stringify(result, null, 2));
