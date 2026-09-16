#!/usr/bin/env node
import { notifyJobCompletion, publicJob, readJob, updateJob } from "../src/lib/jobs.mjs";

const [jobId, originThreadId] = process.argv.slice(2);
if (!jobId || !originThreadId) {
  console.error("Usage: watch-job-notification.mjs <job-id> <origin-thread-id>");
  process.exit(2);
}

const terminal = new Set(["completed", "partial", "failed", "cancelled", "paused"]);
const initial = await readJob(jobId);
if (!initial) throw new Error(`Job not found: ${jobId}`);

await updateJob(jobId, (current) => ({
  ...current,
  notification: current.notification?.originThreadId ? current.notification : {
    state: "pending",
    originThreadId,
    attempts: 0,
    lastAttemptAt: null,
    acceptedAt: null,
    acknowledgedAt: null,
    lastError: null
  }
}));

while (true) {
  const job = await readJob(jobId);
  if (!job) throw new Error(`Job disappeared: ${jobId}`);
  if (terminal.has(job.status)) {
    const notified = await notifyJobCompletion(jobId);
    console.log(JSON.stringify({ job: publicJob(notified), notification: notified.notification }, null, 2));
    break;
  }
  await new Promise((resolveDelay) => setTimeout(resolveDelay, 2000));
}
