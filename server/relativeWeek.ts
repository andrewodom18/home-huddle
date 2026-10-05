import { DateTime } from "luxon";
import type { PlanRequirements } from "../shared/contracts";

const WEEKDAYS = ["monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday"];
const DAY_PATTERN = /\b(monday|tuesday|wednesday|thursday|friday|saturday|sunday)\b/i;
const CLAUSE_END = /[,.;]|\band\b/i;

export function requestedNextWeek(message: string, localDate: string): { start: string; end: string } | undefined {
  if (!/\bnext\s+week\b/i.test(message)) return undefined;
  const monday = DateTime.fromISO(localDate).startOf("week").plus({ weeks: 1 });
  return { start: monday.toISODate()!, end: monday.plus({ days: 6 }).toISODate()! };
}

function namedDayForTask(message: string, label: string): string | undefined {
  const tokens = [...new Set(label.toLowerCase().match(/[a-z]{3,}/g) ?? [])]
    .filter((token) => !["the", "for", "and", "with", "from"].includes(token))
    .sort((left, right) => right.length - left.length);
  for (const token of tokens) {
    const prefix = token.slice(0, Math.min(4, token.length));
    const matches = [...message.matchAll(new RegExp(`\\b${prefix}[a-z]*\\b`, "gi"))];
    for (const match of matches) {
      const after = message.slice(match.index! + match[0].length, match.index! + match[0].length + 70).split(CLAUSE_END)[0];
      const namedAfter = DAY_PATTERN.exec(after)?.[1];
      if (namedAfter) return namedAfter.toLowerCase();
      const before = message.slice(Math.max(0, match.index! - 45), match.index!).split(/[,.;]|\band\b/i).at(-1)!;
      const namedBefore = DAY_PATTERN.exec(before)?.[1];
      if (namedBefore) return namedBefore.toLowerCase();
    }
  }
  return undefined;
}

export function nextWeekCaptureIssues(requirements: PlanRequirements, message: string, week: { start: string; end: string }): string[] {
  const issues: string[] = [];
  const monday = DateTime.fromISO(week.start);
  for (const task of requirements.tasks) {
    if (!task.date || task.date < week.start || task.date > week.end) {
      issues.push(`${task.label}: next week is ${week.start} through ${week.end}; use a date in that range`);
      continue;
    }
    const day = namedDayForTask(message, task.label);
    if (!day) continue;
    const expected = monday.plus({ days: WEEKDAYS.indexOf(day) }).toISODate();
    if (task.date !== expected) issues.push(`${task.label}: ${day} next week is ${expected}, not ${task.date}`);
  }
  return issues;
}
