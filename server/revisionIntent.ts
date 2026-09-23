import type { HouseholdPlan, PlanDraft, PlanRequirements, ScheduleEdit } from "../shared/contracts";
import { assignedPeople, minutes } from "./scheduleValidation";

export type RevisionIntent = {
  taskId: string;
  date?: string;
  start?: { kind: "exact" | "offset" | "direction"; value: number };
  durationMinutes?: number;
  assignees?: string[];
};

function normalized(value: string): string {
  return value.toLowerCase().replace(/['’]s\b/g, "").replace(/[“”'’.?!]/g, "").replace(/[-_]/g, " ").replace(/\s+/g, " ").trim().replace(/^the /, "");
}

function taskFor(fragment: string, plan: HouseholdPlan): HouseholdPlan["items"][number] | undefined {
  const qualified = /^(.+?)\s+on\s+((?:[A-Za-z]+\s+\d{1,2},?\s+\d{4})|(?:\d{4}-\d{2}-\d{2}))$/i.exec(fragment.trim());
  const date = qualified ? calendarDate(qualified[2]) : undefined;
  if (qualified && !date) return undefined;
  const target = normalized(qualified?.[1] ?? fragment);
  if (target === "first task" || target === "first event") return plan.items[0];
  if (target === "second task" || target === "second event") return plan.items[1];
  if (target.length < 3) return undefined;
  const matches = plan.items.filter((item) => {
    if (date && item.date !== date) return false;
    const aliases = [item.taskId, item.task, plan.requirements?.tasks.find((task) => task.id === item.taskId)?.label]
      .filter((label): label is string => Boolean(label))
      .map(normalized);
    return aliases.some((alias) => alias === target || alias.endsWith(` ${target}`) || alias.startsWith(`${target} `));
  });
  return matches.length === 1 ? matches[0] : undefined;
}

function clock(value: string): number | undefined {
  const match = /^(\d{1,2})(?::(\d{2}))?\s*([AP])\.?M\.?$/i.exec(value.trim());
  return match ? minutes(`${match[1]}:${match[2] ?? "00"} ${match[3].toUpperCase()}M`) : undefined;
}

function names(value: string, plan: HouseholdPlan): string[] | undefined {
  const people = assignedPeople(value.replace(/[.!?]+$/, "").trim(), plan.participants);
  return people.length > 0 ? people : undefined;
}

function calendarDate(value: string): string | undefined {
  const clean = value.replace(/[.!?]+$/, "").trim();
  const iso = /^\d{4}-\d{2}-\d{2}$/.test(clean) ? clean : undefined;
  if (iso) {
    const parsed = new Date(`${iso}T00:00:00Z`);
    return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === iso ? iso : undefined;
  }
  const named = /^(January|February|March|April|May|June|July|August|September|October|November|December)\s+(\d{1,2}),?\s+(\d{4})$/i.exec(clean);
  if (!named) return undefined;
  const month = "january february march april may june july august september october november december".split(" ").indexOf(named[1].toLowerCase());
  const year = Number(named[3]);
  const day = Number(named[2]);
  const parsed = new Date(Date.UTC(year, month, day));
  return parsed.getUTCFullYear() === year && parsed.getUTCMonth() === month && parsed.getUTCDate() === day
    ? parsed.toISOString().slice(0, 10)
    : undefined;
}

/** An explicit but unparsed event edit must not fall back to an unchecked model proposal. */
export function isUnverifiedEventEditRequest(message: string, plan: HouseholdPlan): boolean {
  const text = ` ${normalized(message)} `;
  // Even an activity nickname we cannot match must not turn an explicit date
  // move into an unchecked replacement plan.
  const dateMove = /\b(?:move|reschedule|shift|set|change|put)\b/i.test(message)
    && /\b(?:to|for|on|later|earlier)\b/i.test(message)
    && /\b(?:today|tomorrow|yesterday|monday|tuesday|wednesday|thursday|friday|saturday|sunday|january|february|march|april|may|june|july|august|september|october|november|december)\b|\b\d{4}-\d{2}-\d{2}\b|\b\d{1,2}\/\d{1,2}\/\d{4}\b/i.test(message);
  if (dateMove) return true;
  const namesAnEvent = plan.items.some((item) => [item.taskId, item.task, plan.requirements?.tasks.find((task) => task.id === item.taskId)?.label]
    .filter((label): label is string => Boolean(label))
    .some((label) => text.includes(` ${normalized(label)} `)))
    || /\b(?:first|second) (?:task|event)\b/.test(text);
  if (!namesAnEvent || !/\b(move|reschedule|shift|assign|reassign|set|change|make|give|have)\b/i.test(message)) return false;
  return /\b(?:start|end|duration|earlier|later|assignee|assign|reassign|minutes?|date|today|tomorrow|yesterday|weekdays?|weekends?|weeks?|months?|days?|\d{1,2}(?::\d{2})?\s*[ap]m|\d{4}-\d{2}-\d{2}|(?:monday|tuesday|wednesday|thursday|friday|saturday|sunday)|(?:january|february|march|april|may|june|july|august|september|october|november|december))\b/i.test(message)
    || plan.participants.some((person) => text.includes(` ${normalized(person)} `));
}

/** Keep preservation and conditional conflict-resolution context in the model request,
 * while recognizing the exact primary edit independently. Additional mutations must
 * not be discarded: those requests require clarification or a typed change. */
function primaryEditText(message: string): string | undefined {
  const parts = message.trim().split(/[.!?]\s+/);
  for (const supplement of parts.slice(1)) {
    if (!/^(?:keep|preserve)\b/i.test(supplement)) return undefined;
    const preservation = supplement.replace(/\b(?:and\s+)?(?:move|reschedule|shift)\b.+?\bif (?:needed|necessary)\b[.!?]?/gi, "");
    if (/\b(?:add|remove|cancel|delete|assign|reassign|set|change|make|move|shift|reschedule)\b/i.test(preservation)) return undefined;
  }
  return parts[0];
}

/** Only recognizes edits whose target and requested result can be checked exactly. */
export function naturalRevisionIntent(message: string, plan: HouseholdPlan): RevisionIntent | undefined {
  const primary = primaryEditText(message);
  if (!primary) return undefined;
  const text = primary.trim().replace(/^(?:(?:can|could|would) you\s+)?please\s+|^(?:can|could|would) you\s+/i, "");
  const dateMove = /^(?:move|reschedule|shift|set|change|put)\s+(.+?)\s+(?:to|for|on)\s+((?:\d{4}-\d{2}-\d{2})|(?:(?:January|February|March|April|May|June|July|August|September|October|November|December)\s+\d{1,2},?\s+\d{4}))[.!?]?$/i.exec(text);
  if (dateMove) {
    const task = taskFor(dateMove[1], plan);
    const date = calendarDate(dateMove[2]);
    if (task && date) return { taskId: task.taskId ?? task.id, date };
  }
  const time = "(\\d{1,2}(?::\\d{2})?\\s*[AP]\\.?M\\.?)";
  let match = new RegExp(`^(?:set|change)\\s+(?:the\\s+)?start(?:\\s+time)?\\s+(?:of|for)\\s+(.+?)\\s+to\\s+${time}[.!?]?$`, "i").exec(text)
    ?? new RegExp(`^(?:move|reschedule|shift|set|change|put)\\s+(.+?)\\s+(?:to|for|at|start(?:ing)?\\s+at)\\s+${time}[.!?]?$`, "i").exec(text);
  if (match) {
    const task = taskFor(match[1].replace(/\s+start(?:\s+time)?$/i, ""), plan);
    const value = clock(match[2]);
    if (task && value !== undefined) return { taskId: task.taskId ?? task.id, start: { kind: "exact", value } };
  }

  match = new RegExp(`^(?:set|change)\\s+(?:the\\s+)?end(?:\\s+time)?\\s+(?:of|for)\\s+(.+?)\\s+to\\s+${time}[.!?]?$`, "i").exec(text)
    ?? new RegExp(`^(?:make|set|change)\\s+(.+?)\\s+end\\s+at\\s+${time}[.!?]?$`, "i").exec(text);
  if (match) {
    const task = taskFor(match[1], plan);
    const end = clock(match[2]);
    const start = task ? minutes(task.startTime) : undefined;
    if (task && start !== undefined && end !== undefined) {
      return { taskId: task.taskId ?? task.id, start: { kind: "exact", value: start }, durationMinutes: end - start };
    }
  }

  match = /^(?:move|shift)\s+(.+?)\s+(\d{1,3})\s*minutes?\s+(later|earlier)[.!?]?$/i.exec(text);
  if (match) {
    const task = taskFor(match[1], plan);
    if (task) return { taskId: task.taskId ?? task.id, start: { kind: "offset", value: Number(match[2]) * (match[3].toLowerCase() === "later" ? 1 : -1) } };
  }

  match = /^(?:move|shift)\s+(.+?)\s+(later|earlier)[.!?]?$/i.exec(text);
  if (match) {
    const task = taskFor(match[1], plan);
    if (task) return { taskId: task.taskId ?? task.id, start: { kind: "direction", value: match[2].toLowerCase() === "later" ? 1 : -1 } };
  }

  match = /^(?:set|change)\s+(?:the\s+)?duration\s+of\s+(.+?)\s+to\s+(\d{1,3})\s*minutes?[.!?]?$/i.exec(text)
    ?? /^(?:make|set|change)\s+(.+?)\s+(?:(?:last|take|to|for|duration\s+to)\s+)?(\d{1,3})\s*minutes?[.!?]?$/i.exec(text);
  if (match) {
    const task = taskFor(match[1], plan);
    if (task) return { taskId: task.taskId ?? task.id, durationMinutes: Number(match[2]) };
  }

  match = /^(?:change|set)\s+(.+?)(?:'s|’s)?\s+assignee\s+to\s+(.+)$/i.exec(text)
    ?? /^(?:assign|reassign|give)\s+(.+?)\s+to\s+(.+)$/i.exec(text);
  if (match) {
    const firstTask = taskFor(match[1], plan);
    const secondTask = taskFor(match[2], plan);
    if (firstTask && !secondTask) {
      const replacement = /^(.+?)\s+(?:instead of|rather than)\s+(.+)$/i.exec(match[2]);
      if (replacement) {
        const previous = names(replacement[2], plan);
        const actual = assignedPeople(firstTask.assignee, plan.participants);
        if (!previous || !previous.every((person) => actual.includes(person))) return undefined;
      }
      const assignees = names(replacement?.[1] ?? match[2], plan);
      if (assignees) return { taskId: firstTask.taskId ?? firstTask.id, assignees };
    }
    if (secondTask && !firstTask) {
      const assignees = names(match[1], plan);
      if (assignees) return { taskId: secondTask.taskId ?? secondTask.id, assignees };
    }
  }

  match = /^have\s+(.+?)\s+(?:do|handle)\s+(.+)$/i.exec(text);
  if (match) {
    const task = taskFor(match[2], plan);
    const assignees = names(match[1], plan);
    if (task && assignees) return { taskId: task.taskId ?? task.id, assignees };
  }
  return undefined;
}

export function structuredRevisionIntent(edit: ScheduleEdit, plan: HouseholdPlan): RevisionIntent {
  const original = plan.items.find((item) => item.taskId === edit.taskId || item.id === edit.taskId);
  if (!original) throw new Error(`Event ${edit.taskId} is not in the current plan`);
  const requestedTime = edit.startTime === undefined ? undefined : clock(edit.startTime);
  if (edit.startTime !== undefined && requestedTime === undefined) throw new Error("Enter a valid start time such as 9:30 AM");
  const assignees = edit.assignees === undefined ? undefined : names(edit.assignees.join(", "), plan);
  if (edit.assignees !== undefined && (!assignees || assignees.length !== edit.assignees.length)) {
    throw new Error(`Choose assignees from ${plan.participants.join(", ")}`);
  }
  return {
    taskId: original.taskId ?? original.id,
    date: edit.date,
    start: requestedTime === undefined ? undefined : { kind: "exact", value: requestedTime },
    durationMinutes: edit.durationMinutes,
    assignees,
  };
}

export function preflightRevisionIssues(
  intent: RevisionIntent,
  plan: HouseholdPlan,
  requirements?: PlanRequirements,
  allowFlexibleAssigneeOverride = false,
  allowFixedOverride = false,
): string[] {
  const original = plan.items.find((item) => item.taskId === intent.taskId || item.id === intent.taskId);
  if (!original) return [`Event ${intent.taskId} is not in the current plan`];
  const requirement = requirements?.tasks.find((task) => task.id === original.taskId);
  const issues: string[] = [];
  if (!allowFixedOverride && requirement?.fixedDate && requirement.date && intent.date && intent.date !== requirement.date) issues.push(`${requirement.label} has a fixed date on ${requirement.date}`);
  if (!allowFixedOverride && requirement?.fixedStartTime && intent.start?.kind === "exact" && intent.start.value !== minutes(requirement.fixedStartTime)) {
    issues.push(`${requirement.label} has a fixed start at ${requirement.fixedStartTime}`);
  }
  if (!allowFixedOverride && requirement?.fixedStartTime && intent.start && intent.start.kind !== "exact") {
    issues.push(`${requirement.label} has a fixed start at ${requirement.fixedStartTime}`);
  }
  if (!allowFixedOverride && intent.durationMinutes !== undefined && requirement && (requirement.fixedDate || requirement.fixedStartTime) && intent.durationMinutes !== requirement.durationMinutes) {
    issues.push(`${requirement.label} has a required ${requirement.durationMinutes}-minute duration in this example`);
  }
  if (intent.durationMinutes !== undefined && (intent.durationMinutes < 1 || intent.durationMinutes > 480)) issues.push("Duration must be 1–480 minutes");
  if (intent.assignees) {
    if (!allowFixedOverride && (requirement?.fixedDate || requirement?.fixedStartTime) && !samePeople(intent.assignees, assignedPeople(original.assignee, plan.participants))) {
      issues.push(`${requirement.label} has fixed assignees in this example`);
    }
    for (const person of intent.assignees) {
      if (requirement?.allowedParticipants && !requirement.allowedParticipants.includes(person)) issues.push(`${requirement.label}: ${person} is not an allowed assignee`);
      if (requirement?.forbiddenParticipants?.includes(person)) issues.push(`${requirement.label}: do not assign ${person}`);
    }
    if (!allowFlexibleAssigneeOverride) {
      for (const person of requirement?.requiredParticipants ?? []) {
        if (!intent.assignees.includes(person)) issues.push(`${requirement?.label}: ${person} must stay assigned`);
      }
      if (requirement?.atLeastOneOf?.length && !requirement.atLeastOneOf.some((person) => intent.assignees?.includes(person))) {
        issues.push(`${requirement.label}: include one of ${requirement.atLeastOneOf.join(", ")}`);
      }
    }
  }
  const originalStart = minutes(original.startTime);
  const timeChanged = intent.start?.kind === "direction"
    || (intent.start?.kind === "offset" && intent.start.value !== 0)
    || (intent.start?.kind === "exact" && intent.start.value !== originalStart);
  const durationChanged = intent.durationMinutes !== undefined && intent.durationMinutes !== original.durationMinutes;
  const originalPeople = assignedPeople(original.assignee, plan.participants);
  const peopleChanged = intent.assignees !== undefined
    && (intent.assignees.length !== originalPeople.length || intent.assignees.some((person) => !originalPeople.includes(person)));
  const dateChanged = intent.date !== undefined && intent.date !== original.date;
  if (!timeChanged && !durationChanged && !peopleChanged && !dateChanged) issues.push(`${original.task} already has the requested schedule`);
  return issues;
}

function samePeople(left: string[], right: string[]): boolean {
  return left.length === right.length && left.every((person) => right.some((name) => name.toLowerCase() === person.toLowerCase()));
}

export function revisionIntentIssues(draft: PlanDraft, plan: HouseholdPlan, intent: RevisionIntent): string[] {
  const original = plan.items.find((item) => item.taskId === intent.taskId || item.id === intent.taskId);
  const revised = original?.taskId
    ? draft.items.find((item) => item.taskId === original.taskId)
    : draft.items.filter((item) => normalized(item.task) === normalized(original?.task ?? ""))[0];
  if (!original || !revised) return [`Keep event ${intent.taskId} in the revised plan`];
  const issues: string[] = [];
  const priorStart = minutes(original.startTime);
  const actualStart = minutes(revised.startTime);
  if (intent.date !== undefined && revised.date !== intent.date) issues.push(`${original.task}: move to the requested date ${intent.date}`);
  if (intent.start?.kind === "exact" && actualStart !== intent.start.value) issues.push(`${original.task}: start at the requested time`);
  if (intent.start?.kind === "offset" && (priorStart === undefined || actualStart !== priorStart + intent.start.value)) issues.push(`${original.task}: move exactly ${Math.abs(intent.start.value)} minutes ${intent.start.value >= 0 ? "later" : "earlier"}`);
  if (intent.start?.kind === "direction" && (priorStart === undefined || actualStart === undefined || (actualStart - priorStart) * intent.start.value <= 0)) issues.push(`${original.task}: move ${intent.start.value > 0 ? "later" : "earlier"}`);
  if (intent.durationMinutes !== undefined && revised.durationMinutes !== intent.durationMinutes) issues.push(`${original.task}: use the requested ${intent.durationMinutes}-minute duration`);
  if (intent.assignees) {
    const actual = assignedPeople(revised.assignee, draft.participants);
    if (actual.length !== intent.assignees.length || !intent.assignees.every((person) => actual.some((name) => name.toLowerCase() === person.toLowerCase()))) {
      issues.push(`${original.task}: assign exactly ${intent.assignees.join(", ")}`);
    }
  }
  return issues;
}
