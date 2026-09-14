import test from "node:test";
import assert from "node:assert/strict";
import { getScheduleState } from "../src/lib/scheduler.mjs";

const schedule = {
  timezone: "Asia/Shanghai",
  deepseek: {
    peakWeekdays: [
      { start: "09:00", end: "12:00" },
      { start: "14:00", end: "18:00" }
    ]
  },
  glmNightCampaign: {
    startDate: "2026-09-03",
    endDate: "2026-09-20",
    startTime: "23:00",
    endTime: "09:00"
  }
};

test("GLM night campaign is active at 23:30 Beijing", () => {
  const state = getScheduleState(new Date("2026-09-14T15:30:00Z"), schedule);
  assert.equal(state.localTime, "23:30");
  assert.equal(state.glmNightCampaignActive, true);
  assert.equal(state.deepSeekOffPeak, true);
});

test("DeepSeek is peak at 10:00 Beijing on Monday", () => {
  const state = getScheduleState(new Date("2026-09-14T02:00:00Z"), schedule);
  assert.equal(state.localTime, "10:00");
  assert.equal(state.deepSeekOffPeak, false);
});

test("GLM campaign is inactive after its end date", () => {
  const state = getScheduleState(new Date("2026-09-21T15:30:00Z"), schedule);
  assert.equal(state.glmNightCampaignActive, false);
});
