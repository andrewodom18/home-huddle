import type { ChatRequest, PlanDraft, PlanRequirements } from "../shared/contracts";
import { localNow, pastScheduleIssues } from "./pastSchedule";
import { requirementsIssues } from "./requirements";
import { assignedPeople, minutes, scheduleIssues } from "./scheduleValidation";

type RequestContext = Pick<ChatRequest, "history" | "message" | "planDate" | "timeZone" | "currentPlan">;
type Budget = { maxAttempts?: number; maxMilliseconds?: number };

/** A bounded feasibility search for new plans with valid activities but overlapping
 * times. It changes startTime only. Failure leaves the model draft untouched so the
 * normal repair/clarification path can continue; this is not an optimality claim. */
export function repairScheduleTiming(
  draft: PlanDraft,
  request: RequestContext,
  requirements: PlanRequirements,
  instant: Date,
  budget: Budget = {},
): PlanDraft {
  if (request.currentPlan || draft.items.length > 20 || requirementsIssues(requirements, draft.participants).length) return draft;
  const originalIssues = scheduleIssues(draft, request, requirements);
  if (!originalIssues.some((issue) => /overlap for|simultaneous use exceeds/.test(issue))) return draft;
  const started = performance.now();
  const maxAttempts = Math.min(Math.max(budget.maxAttempts ?? 20_000, 0), 20_000);
  const maxMilliseconds = Math.min(Math.max(budget.maxMilliseconds ?? 150, 0), 150);
  const current = localNow(instant, request.timeZone);
  const indexedRules = new Map(requirements.tasks.map((task) => [task.id, task]));
  if (draft.items.length !== indexedRules.size || new Set(draft.items.map((item) => item.taskId)).size !== draft.items.length) return draft;
  const slots = draft.items.map((item, index) => {
    const rule = indexedRules.get(item.taskId ?? "");
    const date = item.date ?? request.planDate;
    const people = assignedPeople(item.assignee, draft.participants);
    if (!rule || !date || date < current.date || rule.date && rule.date !== date || item.durationMinutes !== rule.durationMinutes || minutes(item.startTime) === undefined || !people.length) return undefined;
    const has = (person: string) => people.some((name) => name.toLowerCase() === person.toLowerCase());
    if (rule.requiredParticipants?.some((person) => !has(person)) || rule.atLeastOneOf?.length && !rule.atLeastOneOf.some(has)) return undefined;
    if (people.some((person) => rule.allowedParticipants && !rule.allowedParticipants.some((name) => name.toLowerCase() === person.toLowerCase()) || rule.forbiddenParticipants?.some((name) => name.toLowerCase() === person.toLowerCase()))) return undefined;
    const window = requirements.timeWindows?.find((window) => window.date === date) ?? requirements.timeWindow;
    const low = Math.max(minutes(window.startTime)!, rule.earliestStartTime ? minutes(rule.earliestStartTime)! : 0, date === current.date ? Math.ceil(current.minute) : 0);
    const high = Math.min(minutes(window.endTime)!, rule.latestEndTime ? minutes(rule.latestEndTime)! : 1440) - item.durationMinutes;
    const fixed = rule.fixedStartTime ? minutes(rule.fixedStartTime) : undefined;
    if (low > high || fixed !== undefined && (fixed < low || fixed > high)) return undefined;
    const availability = people.map((person) => {
      const all = (requirements.availability ?? []).filter((window) => window.participant.toLowerCase() === person.toLowerCase());
      if (!all.length) return undefined;
      const specific = all.filter((window) => window.date === date);
      return (specific.length ? specific : all.filter((window) => !window.date)).map((window) => ({ start: minutes(window.startTime)!, end: minutes(window.endTime)! }));
    });
    let flexibility = 0;
    for (let start = low; start <= high; start += 1) {
      if (availability.every((windows) => !windows || windows.some((window) => start >= window.start && start + item.durationMinutes <= window.end))) flexibility += 1;
    }
    if (!flexibility) return undefined;
    return { index, item, rule, date, day: Date.parse(`${date}T00:00:00Z`) / 60_000, people, low, high, fixed, availability, flexibility };
  });
  if (slots.some((slot) => !slot)) return draft;
  const tasks = slots as NonNullable<(typeof slots)[number]>[];
  const indexFor = new Map(tasks.map((task) => [task.rule.id, task.index]));
  const edges = [
    ...(requirements.ordering ?? []).map((edge) => ({ before: indexFor.get(edge.beforeTaskId)!, after: indexFor.get(edge.afterTaskId)!, gap: 0 })),
    ...(requirements.gaps ?? []).map((edge) => ({ before: indexFor.get(edge.afterTaskId)!, after: indexFor.get(edge.beforeTaskId)!, gap: edge.minMinutes })),
  ];
  const resourceCapacity = new Map((requirements.resources ?? []).map((resource) => [resource.id, resource.capacity]));
  const placed = new Map<number, number>();
  let attempts = 0;
  let solution: PlanDraft | undefined;
  const expired = () => attempts >= maxAttempts || performance.now() - started >= maxMilliseconds;
  const fits = (index: number, start: number): boolean => {
    const task = tasks[index]; const end = start + task.item.durationMinutes;
    if (task.availability.some((windows) => windows && !windows.some((window) => start >= window.start && end <= window.end))) return false;
    for (const [otherIndex, otherStart] of placed) {
      const other = tasks[otherIndex];
      if (task.date === other.date && start < otherStart + other.item.durationMinutes && otherStart < end && task.people.some((person) => other.people.includes(person))) return false;
    }
    for (const edge of edges) {
      const beforeStart = edge.before === index ? start : placed.get(edge.before);
      const afterStart = edge.after === index ? start : placed.get(edge.after);
      if (beforeStart !== undefined && afterStart !== undefined && tasks[edge.before].day + beforeStart + tasks[edge.before].item.durationMinutes + edge.gap > tasks[edge.after].day + afterStart) return false;
    }
    for (const use of task.rule.resources ?? []) {
      const others = [...placed].flatMap(([otherIndex, otherStart]) => {
        const other = tasks[otherIndex];
        const units = other.rule.resources?.find((resource) => resource.resourceId === use.resourceId)?.units;
        return units && other.date === task.date && otherStart < end && start < otherStart + other.item.durationMinutes ? [{ start: otherStart, end: otherStart + other.item.durationMinutes, units }] : [];
      });
      for (const point of [start, ...others.filter((other) => other.start >= start).map((other) => other.start)]) {
        if (use.units + others.filter((other) => other.start <= point && point < other.end).reduce((sum, other) => sum + other.units, 0) > resourceCapacity.get(use.resourceId)!) return false;
      }
    }
    return true;
  };
  const bounds = (index: number): [number, number] => {
    const task = tasks[index]; let low = task.low; let high = task.high;
    for (const edge of edges) {
      if (edge.after === index && placed.has(edge.before)) low = Math.max(low, tasks[edge.before].day + placed.get(edge.before)! + tasks[edge.before].item.durationMinutes + edge.gap - task.day);
      if (edge.before === index && placed.has(edge.after)) high = Math.min(high, tasks[edge.after].day + placed.get(edge.after)! - edge.gap - task.day - task.item.durationMinutes);
    }
    return [low, high];
  };
  const search = (): boolean => {
    if (expired()) return false;
    if (placed.size === tasks.length) {
      const candidate = { ...draft, items: draft.items.map((item, index) => {
        const start = placed.get(index)!; const hour = Math.floor(start / 60);
        return { ...item, startTime: `${hour % 12 || 12}:${String(start % 60).padStart(2, "0")} ${hour >= 12 ? "PM" : "AM"}` };
      }) };
      if (!scheduleIssues(candidate, request, requirements).length && !pastScheduleIssues(candidate, request, instant).length) { solution = candidate; return true; }
      return false;
    }
    const remaining = tasks.filter((task) => !placed.has(task.index));
    const fixed = remaining.filter((task) => task.fixed !== undefined);
    const ready = fixed.length ? fixed : remaining.filter((task) => edges.every((edge) => edge.after !== task.index || placed.has(edge.before)));
    ready.sort((a, b) => a.date.localeCompare(b.date) || a.flexibility - b.flexibility || b.people.length - a.people.length || a.index - b.index);
    // Shared activities first within a date reserve scarce common time. Fixed
    // starts are already placed; explicit dependencies define the ready set.
    if (!fixed.length) ready.sort((a, b) => a.date.localeCompare(b.date) || b.people.length - a.people.length || a.flexibility - b.flexibility || a.index - b.index);
    const task = ready[0];
    if (!task) return false;
    const [low, high] = bounds(task.index);
    for (let start = task.fixed ?? low; start <= (task.fixed ?? high); start += 1) {
      if (expired()) return false;
      attempts += 1;
      if (start < low || start > high || !fits(task.index, start)) continue;
      placed.set(task.index, start);
      if (search()) return true;
      placed.delete(task.index);
    }
    return false;
  };
  search();
  return solution ?? draft;
}
