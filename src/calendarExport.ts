import { createEvents, type EventAttributes } from "ics";
import { DateTime, IANAZone } from "luxon";
import type { HouseholdPlan } from "../shared/contracts";

const TIME_PATTERN = /^(\d{1,2}):(\d{2})\s*(AM|PM)$/i;

function localStart(date: string, time: string, durationMinutes: number, timeZone: string): number {
  const match = TIME_PATTERN.exec(time.trim());
  if (!match) throw new Error(`Invalid plan time: ${time}`);
  const hour12 = Number(match[1]);
  const minute = Number(match[2]);
  if (hour12 < 1 || hour12 > 12 || minute > 59) {
    throw new Error(`Invalid plan time: ${time}`);
  }
  const hour = (hour12 % 12) + (match[3].toUpperCase() === "PM" ? 12 : 0);
  const day = DateTime.fromISO(date, { zone: timeZone });
  if (!day.isValid || day.toISODate() !== date) {
    throw new Error("Choose a valid calendar date.");
  }
  const start = DateTime.fromObject(
    { year: day.year, month: day.month, day: day.day, hour, minute },
    { zone: timeZone },
  );
  if (!start.isValid || start.hour !== hour || start.minute !== minute) {
    throw new Error(`${time} does not exist on ${date} in ${timeZone}.`);
  }
  if (start.getPossibleOffsets().length > 1) {
    throw new Error(`${time} occurs twice on ${date} in ${timeZone}. Choose an unambiguous time before exporting.`);
  }
  if (start.plus({ minutes: durationMinutes }).offset !== start.offset) {
    throw new Error(`The activity starting at ${time} on ${date} in ${timeZone} crosses a daylight-saving change. Choose a time entirely before or after the clock change before exporting.`);
  }
  return start.toMillis();
}

export function createCalendarFile(
  plan: HouseholdPlan,
  date: string,
  timeZone: string,
): string {
  if (!IANAZone.isValidZone(timeZone)) {
    throw new Error("Choose a valid time zone.");
  }

  const events: EventAttributes[] = plan.items.map((item) => {
    const eventDate = item.date ?? date;
    const stableId = (item.taskId || item.id).replace(/[^A-Za-z0-9-]/g, "-");
    return {
      start: localStart(eventDate, item.startTime, item.durationMinutes, timeZone),
      startInputType: "utc",
      startOutputType: "utc",
      duration: { minutes: item.durationMinutes },
      title: item.task,
      description: `Assigned to: ${item.assignee}. Home Huddle plan v${plan.version}.${item.details ? `\nDetails: ${item.details}` : ""}`,
      uid: `${eventDate}-${stableId}@home-huddle.local`,
      sequence: plan.version,
      status: "CONFIRMED",
    };
  });

  const result = createEvents(events, { calName: "Home Huddle" });
  if (result.error || !result.value) {
    throw new Error("The calendar file could not be created.");
  }
  return result.value;
}

export function downloadCalendarFile(
  plan: HouseholdPlan,
  date: string,
  timeZone: string,
): void {
  const contents = createCalendarFile(plan, date, timeZone);
  const url = URL.createObjectURL(new Blob([contents], { type: "text/calendar;charset=utf-8" }));
  const link = document.createElement("a");
  link.href = url;
  link.download = `home-huddle-${date}.ics`;
  document.body.append(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}
