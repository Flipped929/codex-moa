#!/usr/bin/env node
import { ccswitchReasoningAudit, readCcSwitchSnapshot } from "../src/lib/ccswitch.mjs";

const snapshot = await readCcSwitchSnapshot();
console.log(JSON.stringify(ccswitchReasoningAudit(snapshot), null, 2));
