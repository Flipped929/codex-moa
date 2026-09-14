#!/usr/bin/env node
import { ccswitchLimitsAudit, readCcSwitchSnapshot } from "../src/lib/ccswitch.mjs";

const snapshot = await readCcSwitchSnapshot();
console.log(JSON.stringify(ccswitchLimitsAudit(snapshot), null, 2));
