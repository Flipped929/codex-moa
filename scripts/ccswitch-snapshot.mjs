#!/usr/bin/env node
import { bindModelsToCcSwitch, ccSwitchSkillStatus, readCcSwitchSnapshot, writeCcSwitchSnapshot } from "../src/lib/ccswitch.mjs";

const snapshot = await readCcSwitchSnapshot();
const output = {
  ...snapshot,
  codexMoaSkill: ccSwitchSkillStatus(snapshot, "codex-moa"),
  modelBindings: bindModelsToCcSwitch(snapshot)
};
await writeCcSwitchSnapshot(output);
console.log(JSON.stringify(output, null, 2));
