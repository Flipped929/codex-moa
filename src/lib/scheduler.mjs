function zonedParts(date, timeZone) {
  const formatter = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    weekday: "short",
    hour12: false
  });
  const parts = Object.fromEntries(formatter.formatToParts(date).map((part) => [part.type, part.value]));
  return {
    date: `${parts.year}-${parts.month}-${parts.day}`,
    time: `${parts.hour}:${parts.minute}`,
    minutes: Number(parts.hour) * 60 + Number(parts.minute),
    weekday: parts.weekday
  };
}

function toMinutes(value) {
  const [hour, minute] = String(value).split(":").map(Number);
  return hour * 60 + minute;
}

function inWindow(minutes, start, end) {
  const from = toMinutes(start);
  const to = toMinutes(end);
  return from <= to ? minutes >= from && minutes < to : minutes >= from || minutes < to;
}

function inDateRange(date, startDate, endDate) {
  return date >= startDate && date <= endDate;
}

function isWeekday(weekday) {
  return !["Sat", "Sun"].includes(weekday);
}

export function getScheduleState(date = new Date(), schedule) {
  const timeZone = schedule.timezone || "Asia/Shanghai";
  const local = zonedParts(date, timeZone);
  const glm = schedule.glmNightCampaign;
  const glmCampaignActive = Boolean(
    glm &&
    glm.enabled !== false &&
    inDateRange(local.date, glm.startDate, glm.endDate) &&
    inWindow(local.minutes, glm.startTime, glm.endTime)
  );

  const deepseek = schedule.deepseek ?? {};
  const peak = isWeekday(local.weekday) && (deepseek.peakWeekdays ?? []).some((window) => inWindow(local.minutes, window.start, window.end));
  const deepSeekOffPeak = !peak;

  const recommendations = [];
  if (glmCampaignActive) recommendations.push("Legacy GLM night campaign is active, but Codex MOA keeps GLM on Pi unless explicitly overridden.");
  if (deepSeekOffPeak) recommendations.push("Prefer DeepSeekHarness for batch audits.");
  if (!glmCampaignActive) recommendations.push("Use Pi for GLM and Kimi; balance their subscription quotas normally.");
  if (!deepSeekOffPeak) recommendations.push("DeepSeek is in peak pricing; reserve it for urgent or high-stakes audits.");

  return {
    timeZone,
    localDate: local.date,
    localTime: local.time,
    weekday: local.weekday,
    glmNightCampaignActive: glmCampaignActive,
    glmNightCampaign: glm,
    deepSeekOffPeak,
    deepSeekPricing: deepSeekOffPeak ? "off-peak" : "peak",
    recommendations
  };
}

export function recommendedTier({ stakes = "medium", scheduleState }) {
  if (stakes === "high") return "deep";
  if (scheduleState?.glmNightCampaignActive) return "fast";
  return "fast";
}
