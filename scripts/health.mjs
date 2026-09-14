#!/usr/bin/env node
import { buildStatusSummary } from "../src/lib/status-summary.mjs";
import { listAcpSeats } from "../src/lib/acp-seat.mjs";
import { routingExperimentStatus } from "../src/lib/routing-experiment.mjs";

const summary = await buildStatusSummary();
console.log(JSON.stringify({ ...summary, acpProcesses: listAcpSeats(), routingExperiments: await routingExperimentStatus() }, null, 2));
