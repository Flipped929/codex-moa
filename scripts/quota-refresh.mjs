#!/usr/bin/env node
import { refreshQuota } from "../src/lib/quota.mjs";

const snapshot = await refreshQuota();
const summary = {
  updatedAt: snapshot.updatedAt,
  providers: Object.fromEntries(Object.entries(snapshot.providers).map(([name, provider]) => [name, {
    status: provider.status,
    plan: provider.plan ?? null,
    windows: provider.windows.map((window) => ({
      kind: window.kind,
      label: window.label,
      remainingPercent: window.remainingPercent ?? null,
      remaining: window.remaining ?? null,
      currency: window.currency ?? null,
      resetAt: window.resetAt ?? null
    }))
  }]))
};
console.log(JSON.stringify(summary, null, 2));
process.exit(Object.values(snapshot.providers).some((provider) => provider.status === "ok") ? 0 : 1);
