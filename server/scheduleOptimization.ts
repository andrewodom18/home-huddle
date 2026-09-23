import type { ChatRequest, PlanDraft, PlanRequirements } from "../shared/contracts";
import { localNow, pastScheduleIssues } from "./pastSchedule";
import { assignedPeople, minutes, scheduleIssues } from "./scheduleValidation";

function displayTime(value: number): string {
  const hour = Math.floor(value / 60);
  const minute = value % 60;
  return `${hour % 12 || 12}:${String(minute).padStart(2, "0")} ${hour < 12 ? "AM" : "PM"}`;
}

function finishTime(draft: PlanDraft): number {
  const dates = new Map<string, number>();
  for (const item of draft.items) {
    const date = item.date ?? "single-day";
    dates.set(date, Math.max(dates.get(date) ?? 0, (minutes(item.startTime) ?? 0) + item.durationMinutes));
  }
  return [...dates.values()].reduce((sum, finish) => sum + finish, 0);
}

/** Remove avoidable idle time without changing assignments or the model's per-person task order. */
export function shortenSchedule(
  draft: PlanDraft,
  request: Pick<ChatRequest, "history" | "message" | "planDate" | "timeZone" | "currentPlan">,
  requirements: PlanRequirements,
  now?: Date,
): PlanDraft {
  const windowStart = minutes(requirements.timeWindow.startTime);
  if (windowStart === undefined || scheduleIssues(draft, request, requirements).length > 0) return draft;

  const originalFinish = finishTime(draft);
  const original = draft.items.map((item, index) => ({
    index,
    date: item.date,
    start: minutes(item.startTime)!,
    people: assignedPeople(item.assignee, draft.participants),
  }));
  const order = [...original].sort((a, b) => (a.date ?? "").localeCompare(b.date ?? "") || a.start - b.start || a.index - b.index);
  let result = draft;

  for (const slot of order) {
    const item = result.items[slot.index];
    if (requirements.tasks.some((task) => task.id === item.taskId && task.fixedStartTime)) continue;

    // Preserve the order the model chose for each person, especially around breaks.
    const dayWindow = slot.date ? requirements.timeWindows?.find((window) => window.date === slot.date) : undefined;
    const local = now ? localNow(now, request.timeZone) : undefined;
    const todayFloor = local && (slot.date ?? request.planDate) === local.date ? Math.ceil(local.minute) : 0;
    const dayStart = Math.max(todayFloor, dayWindow ? minutes(dayWindow.startTime) ?? windowStart : windowStart);
    const priorFinish = Math.max(dayStart, ...original
      .filter((other) => other.date === slot.date && other.start < slot.start && other.people.some((person) => slot.people.includes(person)))
      .map((other) => (minutes(result.items[other.index].startTime) ?? other.start) + result.items[other.index].durationMinutes));
    const currentStart = minutes(item.startTime)!;
    if (priorFinish >= currentStart) continue;

    // A first feasible start lies at the window start or at a constraint boundary.
    // Checking boundaries keeps this bounded even for a full-day time window.
    const candidates = new Set<number>([dayStart, priorFinish]);
    for (const window of requirements.availability ?? []) {
      if ((window.date === undefined || window.date === item.date) && slot.people.some((person) => person.toLowerCase() === window.participant.toLowerCase())) candidates.add(minutes(window.startTime) ?? currentStart);
    }
    const earliestTaskStart = requirements.tasks.find((task) => task.id === item.taskId)?.earliestStartTime;
    if (earliestTaskStart) candidates.add(minutes(earliestTaskStart) ?? currentStart);
    for (const other of result.items) {
      if (other.date !== item.date) continue;
      const end = (minutes(other.startTime) ?? 0) + other.durationMinutes;
      candidates.add(end);
      for (const gap of requirements.gaps ?? []) {
        if (gap.afterTaskId === other.taskId && gap.beforeTaskId === item.taskId) candidates.add(end + gap.minMinutes);
      }
    }

    for (const start of [...candidates].sort((a, b) => a - b)) {
      if (start < priorFinish || start >= currentStart || start < 0 || start >= 1440) continue;
      const candidate: PlanDraft = {
        ...result,
        items: result.items.map((entry, index) => index === slot.index
          ? { ...entry, startTime: displayTime(start) }
          : entry),
      };
      if (scheduleIssues(candidate, request, requirements).length === 0 && (!now || pastScheduleIssues(candidate, request, now).length === 0)) {
        result = candidate;
        break;
      }
    }
  }

  return finishTime(result) < originalFinish && scheduleIssues(result, request, requirements).length === 0 && (!now || pastScheduleIssues(result, request, now).length === 0)
    ? result
    : draft;
}
