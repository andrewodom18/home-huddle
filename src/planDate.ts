import { DateTime } from "luxon";
import type { HouseholdPlan } from "../shared/contracts";

function localDate(value: Date): string {
  return `${value.getFullYear()}-${String(value.getMonth() + 1).padStart(2, "0")}-${String(value.getDate()).padStart(2, "0")}`;
}

const weekdays = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"];
const months = ["january", "february", "march", "april", "may", "june", "july", "august", "september", "october", "november", "december"];

function isoDate(year: number, month: number, day: number): string | undefined {
  const value = `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
  return isValidPlanDate(value) ? value : undefined;
}

export function isValidPlanDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = new Date(`${value}T12:00:00.000Z`);
  return !Number.isNaN(parsed.valueOf()) && parsed.toISOString().slice(0, 10) === value;
}

export function formatPlanDate(value: string): string {
  return new Intl.DateTimeFormat("en-US", { dateStyle: "full", timeZone: "UTC" }).format(new Date(`${value}T12:00:00Z`));
}

export function todayInZone(timeZone: string, now = new Date()): string {
  return DateTime.fromJSDate(now).setZone(timeZone).toISODate() ?? localDate(now);
}

export function isPastEventStart(date: string, startTime: string, timeZone: string, now = new Date()): boolean {
  const match = /^(\d{1,2}):(\d{2})\s*(AM|PM)$/i.exec(startTime);
  if (!isValidPlanDate(date) || !match) return false;
  const hour = Number(match[1]) % 12 + (match[3].toUpperCase() === "PM" ? 12 : 0);
  const start = DateTime.fromISO(`${date}T${String(hour).padStart(2, "0")}:${match[2]}`, { zone: timeZone });
  return start.isValid && start.toMillis() < now.valueOf();
}

function localEventTimeIssue(date: string, startTime: string, durationMinutes: number, timeZone: string): string | undefined {
  const match = /^(\d{1,2}):(\d{2})\s*(AM|PM)$/i.exec(startTime);
  if (!isValidPlanDate(date) || !match || Number(match[1]) < 1 || Number(match[1]) > 12 || Number(match[2]) > 59) {
    return "Choose a valid activity date and time.";
  }
  const hour = Number(match[1]) % 12 + (match[3].toUpperCase() === "PM" ? 12 : 0);
  const start = DateTime.fromISO(`${date}T${String(hour).padStart(2, "0")}:${match[2]}`, { zone: timeZone });
  if (!start.isValid) return "Choose a valid time zone.";
  if (start.toISODate() !== date || start.hour !== hour || start.minute !== Number(match[2])) {
    return `${startTime} does not exist on ${date} in ${timeZone} because of a daylight-saving change. Choose another date or time.`;
  }
  if (start.getPossibleOffsets().length > 1) {
    return `${startTime} occurs twice on ${date} in ${timeZone} because of a daylight-saving change. Choose an unambiguous date or time.`;
  }
  if (start.plus({ minutes: durationMinutes }).offset !== start.offset) {
    return `The activity starting at ${startTime} on ${date} in ${timeZone} crosses a daylight-saving change. Choose a time entirely before or after the clock change.`;
  }
  return undefined;
}

export function pastPlanMoveIssue(plan: HouseholdPlan, date: string, timeZone: string, now = new Date()): string | undefined {
  for (const item of plan.items) {
    const timeIssue = localEventTimeIssue(date, item.startTime, item.durationMinutes, timeZone);
    if (timeIssue) return `“${item.task}”: ${timeIssue}`;
  }
  const event = plan.items.find((item) => isPastEventStart(date, item.startTime, timeZone, now));
  return event
    ? `You’re trying to move “${event.task}” to ${formatPlanDate(date)} at ${event.startTime}, which is in the past in ${timeZone}. Choose a future date or time.`
    : undefined;
}

/** A draft may become stale while the user is reviewing its requirements. */
export function newPlanTimeIssue(plan: HouseholdPlan, fallback: string, timeZone: string, now = new Date()): string | undefined {
  for (const item of plan.items) {
    const date = item.date ?? fallback;
    const timeIssue = localEventTimeIssue(date, item.startTime, item.durationMinutes, timeZone);
    if (timeIssue) return `“${item.task}”: ${timeIssue}`;
    if (isPastEventStart(date, item.startTime, timeZone, now)) {
      return `“${item.task}” starts in the past in ${timeZone}. Ask for a new draft with future times.`;
    }
  }
  return undefined;
}

export function planDates(plan: HouseholdPlan, fallback: string): string[] {
  return [...new Set(plan.items.map((item) => item.date && isValidPlanDate(item.date) ? item.date : fallback))].sort();
}

/** Only an explicit whole-plan date command changes this single-day calendar. */
export function requestedPlanDate(message: string, currentDate: string): string | undefined {
  if (!isValidPlanDate(currentDate)) return undefined;
  const match = /^(?:(?:can|could|would) you\s+)?(?:please\s+)?(?:move|reschedule|change|set|shift)\s+(?:(?:the|my|our)\s+)?(?:(?:whole|entire)\s+)?(?:plan|schedule|calendar|date|day|all\s+(?:events|activities))\s+(?:date\s+)?(?:to|on|for)\s+(.+?)[.!?]?$/i.exec(message.trim());
  if (!match) return undefined;
  const target = match[1].trim();
  if (isValidPlanDate(target)) return target;
  const slash = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(target);
  if (slash) return isoDate(Number(slash[3]), Number(slash[1]), Number(slash[2]));
  const monthName = /^([A-Za-z]+)\s+(\d{1,2})(?:,?\s+(\d{4}))?$/.exec(target);
  if (monthName) {
    const month = months.indexOf(monthName[1].toLowerCase()) + 1;
    if (month) {
      const currentYear = Number(currentDate.slice(0, 4));
      const explicitYear = monthName[3] ? Number(monthName[3]) : undefined;
      const candidate = isoDate(explicitYear ?? currentYear, month, Number(monthName[2]));
      if (!explicitYear && candidate && candidate < currentDate) return isoDate(currentYear + 1, month, Number(monthName[2]));
      return candidate;
    }
  }
  const named = /^(next\s+)?(sunday|monday|tuesday|wednesday|thursday|friday|saturday)$/i.exec(target);
  if (!named) return undefined;
  const current = new Date(`${currentDate}T12:00:00.000Z`);
  const desired = weekdays.indexOf(named[2].toLowerCase());
  let daysAhead = (desired - current.getUTCDay() + 7) % 7;
  if (named[1] && daysAhead === 0) daysAhead = 7;
  current.setUTCDate(current.getUTCDate() + daysAhead);
  return current.toISOString().slice(0, 10);
}

export function asksToMoveDate(message: string): boolean {
  return /\b(move|reschedule|change|set|shift)\b/i.test(message)
    && /\b(sunday|monday|tuesday|wednesday|thursday|friday|saturday|january|february|march|april|may|june|july|august|september|october|november|december|tomorrow|today)\b|\b\d{4}-\d{2}-\d{2}\b|\b\d{1,2}\/\d{1,2}\/\d{4}\b/i.test(message);
}

export function asksToMoveWholePlanDate(message: string): boolean {
  return asksToMoveDate(message)
    && /\b(?:plan|schedule|calendar|date|day|all\s+(?:events|activities))\b/i.test(message);
}

/** Suggest the next occurrence of one explicitly named weekday, without guessing for ambiguous requests. */
export function suggestedPlanDate(message: string, now = new Date(), timeZone?: string): string | undefined {
  const matches = [...message.matchAll(/\b(sunday|monday|tuesday|wednesday|thursday|friday|saturday)\b/gi)];
  if (matches.length !== 1) return undefined;
  const match = matches[0];
  const previousWord = message.slice(0, match.index).trim().split(/\s+/).at(-1)?.toLowerCase();
  if (["last", "previous", "not"].includes(previousWord ?? "")) return undefined;

  const anchor = timeZone ? todayInZone(timeZone, now) : localDate(now);
  const date = new Date(`${anchor}T12:00:00`);
  const desiredDay = weekdays.indexOf(match[1].toLowerCase());
  let daysAhead = (desiredDay - date.getDay() + 7) % 7;
  if (previousWord === "next" && daysAhead === 0) daysAhead = 7;
  date.setDate(date.getDate() + daysAhead);
  return localDate(date);
}

/** Recheck elapsed time at the user's decision, which can be later than generation. */
export function revisionTimeIssue(current: HouseholdPlan, proposal: HouseholdPlan, fallback: string, timeZone: string, now = new Date()): string | undefined {
  const identity = (item: HouseholdPlan["items"][number]) => item.taskId ?? item.id;
  const unchanged = (before: HouseholdPlan["items"][number], after: HouseholdPlan["items"][number]) =>
    (before.date ?? fallback) === (after.date ?? fallback) && before.startTime === after.startTime
    && before.durationMinutes === after.durationMinutes && before.assignee === after.assignee && before.task === after.task;
  for (const item of current.items) {
    if (!isPastEventStart(item.date ?? fallback, item.startTime, timeZone, now)) continue;
    const replacement = proposal.items.find((next) => identity(next) === identity(item));
    if (!replacement || !unchanged(item, replacement)) return `“${item.task}” has already started. Keep its recorded schedule and ask for a new revision of future activities.`;
  }
  for (const item of proposal.items) {
    const prior = current.items.find((before) => identity(before) === identity(item));
    if (prior && unchanged(prior, item)) continue;
    const timeIssue = localEventTimeIssue(item.date ?? fallback, item.startTime, item.durationMinutes, timeZone);
    if (timeIssue) return `“${item.task}”: ${timeIssue}`;
    if (isPastEventStart(item.date ?? fallback, item.startTime, timeZone, now)) return `The proposed time for “${item.task}” is now in the past in ${timeZone}. Keep the current plan and ask for a later time.`;
  }
  return undefined;
}
