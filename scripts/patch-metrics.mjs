#!/usr/bin/env node
import { readPatchMetrics, summarizePatchMetrics } from "../src/lib/patch-metrics.mjs";
console.log(JSON.stringify(summarizePatchMetrics(await readPatchMetrics()), null, 2));
