#!/usr/bin/env node
import { applyReasoningPatch } from "../src/lib/ccswitch-patch.mjs";

const write = process.argv.includes("--write");
const result = await applyReasoningPatch({ write });
console.log(JSON.stringify(result, null, 2));
if (!write && result.changed > 0) {
  console.log("Dry run only. Re-run with --write to apply and back up cc-switch.db.");
}
