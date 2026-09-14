#!/usr/bin/env node
import { listControlRequests, readControlStore, requestCancellation } from "../src/lib/control-store.mjs";
import { cancelAcpSeats, listAcpSeats } from "../src/lib/acp-seat.mjs";

function option(name, fallback = null) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] ?? fallback : fallback;
}

const command = process.argv[2] ?? "status";
if (command === "status") {
  const store = await readControlStore();
  console.log(JSON.stringify({ seats: listAcpSeats(), requests: listControlRequests(store).slice(0, 50) }, null, 2));
} else if (command === "cancel") {
  const target = {
    taskId: option("--task-id"),
    seat: option("--seat"),
    key: option("--key"),
    reason: option("--reason", "operator request")
  };
  if (!target.taskId && !target.seat && !target.key) {
    console.error("Pass at least one of --task-id, --seat, or --key.");
    process.exit(2);
  }
  const direct = await cancelAcpSeats(target);
  const request = direct.some((item) => item.cancelled) ? null : await requestCancellation(target);
  console.log(JSON.stringify({ direct, queued: request, seats: listAcpSeats() }, null, 2));
} else {
  console.error("Usage: moa-control.mjs status | cancel [--task-id id] [--seat name] [--key key]");
  process.exit(2);
}
