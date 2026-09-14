import test from "node:test";
import assert from "node:assert/strict";
import { parseDeepSeekQuota, parseKimiQuota, parseZaiQuota } from "../src/lib/quota.mjs";

test("parses Kimi 5-hour and weekly quota", () => {
  const windows = parseKimiQuota({
    usage: { limit: "100", used: "76", remaining: "24", resetTime: "2026-09-15T08:03:44Z" },
    usages: {
      limit_5h: { used_ratio: 0.1, reset_time: "2026-09-14T21:03:43Z" },
      limit_7d: { used_ratio: 0.76, reset_time: "2026-09-15T08:03:43Z" }
    }
  });
  assert.equal(windows.find((window) => window.kind === "session").remainingPercent, 90);
  assert.ok(Math.abs(windows.find((window) => window.kind === "weekly").remainingPercent - 24) < 0.001);
});

test("parses Z.ai session and weekly quota", () => {
  const windows = parseZaiQuota({
    data: {
      level: "pro",
      limits: [
        { type: "CREDIT_LIMIT", unit: 3, number: 5, usage: 12000, remaining: 12000, percentage: 0 },
        { type: "CREDIT_LIMIT", unit: 6, number: 7, usage: 60000, remaining: 1500, percentage: 97.5 }
      ]
    }
  });
  assert.equal(windows.find((window) => window.kind === "session").remainingPercent, 100);
  assert.equal(windows.find((window) => window.kind === "weekly").remainingPercent, 2.5);
});

test("parses DeepSeek balance", () => {
  const windows = parseDeepSeekQuota({
    is_available: true,
    balance_infos: [{ currency: "CNY", total_balance: "98.21", granted_balance: "0", topped_up_balance: "98.21" }]
  });
  assert.equal(windows[0].currency, "CNY");
  assert.equal(windows[0].remaining, 98.21);
});
