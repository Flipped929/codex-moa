#!/usr/bin/env node
import { runJobWorker } from "../src/lib/jobs.mjs";
import { stopAcpSeats } from "../src/lib/acp-seat.mjs";

const jobId = process.argv[2];
if (!jobId) {
  console.error("Usage: moa-job-worker.mjs <job-id>");
  process.exit(2);
}

let job;
try {
  job = await runJobWorker(jobId);
} finally {
  await stopAcpSeats();
}
const code = job.status === "completed" || job.status === "partial" || job.status === "cancelled" ? 0 : 1;
process.exit(code);
