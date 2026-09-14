#!/usr/bin/env node
import { ccswitchRoutingAudit, readCcSwitchSnapshot } from "../src/lib/ccswitch.mjs";

const snapshot = await readCcSwitchSnapshot();
console.log(JSON.stringify(ccswitchRoutingAudit(snapshot), null, 2));
