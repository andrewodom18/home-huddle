import { DateTime } from "luxon";
import type { ChatRequest, PlanDraft } from "../shared/contracts";
import { assignedPeople, minutes } from "./scheduleValidation";

type DateContext = Pick<ChatRequest, "planDate" | "timeZone" | "currentPlan">;

export function localNow(instant: Date, timeZone: string | undefined): { date: string; minute: number; zone: string } {
  const zone = timeZone ?? "UTC";
  const local = DateTime.fromJSDate(instant, { zone });
  if (!local.isValid || !local.toISODate()) throw new Error("Invalid planning time zone");
  return { date: local.toISODate()!, minute: local.hour * 60 + local.minute + local.second / 60 + local.millisecond / 60_000, zone };
}

export function pastEventIssue(
  task: string,
  date: string | undefined,
  startTime: string,
  instant: Date,
  timeZone: string | undefined,
): string | undefined {
  if (!date) return undefined;
  const current = localNow(instant, timeZone);
  const start = minutes(startTime);
  if (start !== undefined) {
    const local = DateTime.fromISO(`${date}T${String(Math.floor(start / 60)).padStart(2, "0")}:${String(start % 60).padStart(2, "0")}`, { zone: current.zone });
    if (!local.isValid || local.hour * 60 + local.minute !== start) return `${task}: this local time does not exist because of a daylight-saving change. Choose another time.`;
    if (local.getPossibleOffsets().length > 1) return `${task}: this local time occurs twice because of a daylight-saving change. Choose an unambiguous time.`;
  }
  if (date < current.date || (date === current.date && start !== undefined && start < current.minute)) {
    return `${task}: ${date} at ${startTime} has already passed in ${current.zone}. Choose a future date or time.`;
  }
  return undefined;
}

export function pastScheduleIssues(draft: PlanDraft, request: DateContext, instant: Date): string[] {
  const issues: string[] = [];
  const historicalIds = new Set<string>();
  for (const previous of request.currentPlan?.items ?? []) {
    const priorDate = previous.date ?? request.planDate;
    const local = localNow(instant, request.timeZone);
    const start = minutes(previous.startTime);
    const historical = priorDate && (priorDate < local.date || priorDate === local.date && start !== undefined && start < local.minute);
    if (!historical) continue;
    const key = previous.taskId ?? previous.id;
    historicalIds.add(key);
    const next = draft.items.find((item) => item.taskId === key);
    const sameAssignees = next && JSON.stringify(assignedPeople(next.assignee, draft.participants).sort()) === JSON.stringify(assignedPeople(previous.assignee, request.currentPlan!.participants).sort());
    if (!next || (next.date ?? request.planDate) !== priorDate || minutes(next.startTime) !== start || next.durationMinutes !== previous.durationMinutes || next.task !== previous.task || !sameAssignees) issues.push(`${previous.task}: keep this already-started activity unchanged and edit remaining work.`);
  }
  for (const item of draft.items) {
    if (item.taskId && historicalIds.has(item.taskId)) continue;
    const date = item.date ?? request.planDate;
    if (!date) { issues.push(`${item.task}: choose a YYYY-MM-DD date and time zone before scheduling an event.`); continue; }
    const issue = pastEventIssue(item.task, date, item.startTime, instant, request.timeZone);
    if (issue) { issues.push(issue); continue; }
    const startMinutes = minutes(item.startTime);
    if (startMinutes !== undefined) {
      const start = DateTime.fromISO(`${date}T${String(Math.floor(startMinutes / 60)).padStart(2, "0")}:${String(startMinutes % 60).padStart(2, "0")}`, { zone: request.timeZone ?? "UTC" });
      if (start.isValid && start.plus({ minutes: item.durationMinutes }).offset !== start.offset) issues.push(`${item.task}: this activity crosses a daylight-saving clock change. Choose a time entirely before or after the change.`);
    }
  }
  return issues;
}
