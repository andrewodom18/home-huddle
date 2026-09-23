import type { ChatRequest, PlanRequirements } from "./contracts";

export const SCENARIO_REQUIREMENTS: Record<NonNullable<ChatRequest["scenarioId"]>, PlanRequirements> = {
  weekday: {
    source: "scenario",
    timeWindow: { startTime: "5:30 PM", endTime: "8:00 PM" },
    tasks: [
      ...([21, 22, 23, 24, 25] as const).map((day) => ({ id: `dinner-${day}`, date: `2026-09-${day}`, label: "Family dinner", durationMinutes: 30, requiredParticipants: ["Maya", "Leo", "Jordan", "Casey"] })),
      { id: "math-mon", date: "2026-09-21", label: "Maya's math help", durationMinutes: 45, requiredParticipants: ["Maya"], atLeastOneOf: ["Jordan", "Casey"] },
      { id: "jordan-call", date: "2026-09-21", fixedDate: true, label: "Jordan's fixed call", durationMinutes: 20, requiredParticipants: ["Jordan"], fixedStartTime: "6:30 PM" },
      { id: "reading-tue", date: "2026-09-22", label: "Leo's reading", durationMinutes: 20, requiredParticipants: ["Leo"] },
      { id: "math-wed", date: "2026-09-23", label: "Maya's math help", durationMinutes: 45, requiredParticipants: ["Maya"], atLeastOneOf: ["Jordan", "Casey"] },
      { id: "reading-thu", date: "2026-09-24", label: "Leo's reading", durationMinutes: 20, requiredParticipants: ["Leo"] },
      { id: "math-fri", date: "2026-09-25", label: "Maya's math help", durationMinutes: 45, requiredParticipants: ["Maya"], atLeastOneOf: ["Jordan", "Casey"] },
    ],
  },
  chores: {
    source: "scenario",
    timeWindow: { startTime: "9:00 AM", endTime: "11:00 AM" },
    tasks: [
      { id: "kitchen", label: "Clean the kitchen", durationMinutes: 35, allowedParticipants: ["Alex", "Sam"] },
      { id: "vacuum", label: "Vacuum the floors", durationMinutes: 30, allowedParticipants: ["Alex", "Sam"] },
      { id: "start-laundry", label: "Sort and start laundry", durationMinutes: 20 },
      { id: "fold-laundry", label: "Fold and put away laundry", durationMinutes: 20 },
      { id: "shared-break", label: "Shared break", durationMinutes: 15, kind: "break", requiredParticipants: ["Alex", "Sam", "Riley"] },
    ],
    ordering: [
      { beforeTaskId: "kitchen", afterTaskId: "shared-break" },
      { beforeTaskId: "vacuum", afterTaskId: "shared-break" },
      { beforeTaskId: "start-laundry", afterTaskId: "shared-break" },
    ],
    workload: { participants: ["Alex", "Sam", "Riley"], minMinutes: 30, maxMinutes: 40, excludeTaskIds: ["shared-break"] },
  },
  outing: {
    source: "scenario",
    timeWindow: { startTime: "10:00 AM", endTime: "2:00 PM" },
    tasks: [
      { id: "outbound-travel", date: "2026-09-22", label: "Travel to botanical garden", durationMinutes: 25, kind: "travel", requiredParticipants: ["Noor", "Eli", "Grandma Jo"] },
      { id: "garden", date: "2026-09-22", label: "Botanical garden, first walk", durationMinutes: 35, requiredParticipants: ["Noor", "Eli", "Grandma Jo"] },
      { id: "garden-rest", date: "2026-09-22", label: "Seated rest during garden visit", durationMinutes: 10, kind: "break", requiredParticipants: ["Grandma Jo"] },
      { id: "garden-finish", date: "2026-09-22", label: "Botanical garden, second walk", durationMinutes: 40, requiredParticipants: ["Noor", "Eli", "Grandma Jo"] },
      { id: "lunch", date: "2026-09-22", label: "Lunch", durationMinutes: 45, requiredParticipants: ["Noor", "Eli", "Grandma Jo"] },
      { id: "return-travel", date: "2026-09-22", label: "Travel home", durationMinutes: 25, kind: "travel", requiredParticipants: ["Noor", "Eli", "Grandma Jo"] },
      { id: "library", date: "2026-09-24", label: "Accessible library visit", durationMinutes: 60, requiredParticipants: ["Noor", "Eli", "Grandma Jo"] },
      { id: "library-rest", date: "2026-09-24", label: "Seated rest after library visit", durationMinutes: 10, kind: "break", requiredParticipants: ["Grandma Jo"] },
      { id: "picnic", date: "2026-10-10", label: "Family picnic", durationMinutes: 90, requiredParticipants: ["Noor", "Eli", "Grandma Jo"] },
    ],
    ordering: [
      { beforeTaskId: "outbound-travel", afterTaskId: "garden" },
      { beforeTaskId: "garden", afterTaskId: "garden-rest" },
      { beforeTaskId: "garden-rest", afterTaskId: "garden-finish" },
      { beforeTaskId: "garden-finish", afterTaskId: "lunch" },
      { beforeTaskId: "lunch", afterTaskId: "return-travel" },
      { beforeTaskId: "library", afterTaskId: "library-rest" },
    ],
  },
};

function utcDate(value: string): Date {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) throw new Error("Scenario anchor must be a YYYY-MM-DD date");
  const date = new Date(`${value}T12:00:00Z`);
  if (Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== value) {
    throw new Error("Scenario anchor must be a valid YYYY-MM-DD date");
  }
  return date;
}

function addDays(date: Date, days: number): Date {
  const result = new Date(date);
  result.setUTCDate(result.getUTCDate() + days);
  return result;
}

function isoDate(date: Date): string {
  return date.toISOString().slice(0, 10);
}

export function scenarioDates(anchorDate: string): {
  weekday: [string, string, string, string, string];
  chores: string;
  outing: [string, string, string];
} {
  const anchor = utcDate(anchorDate);
  const weekday = anchor.getUTCDay();
  // Always use the next complete school week, even if today is Monday.
  const monday = addDays(anchor, weekday === 0 ? 1 : 8 - weekday);
  const saturday = addDays(anchor, ((6 - weekday + 7) % 7) || 7);
  const firstOuting = addDays(monday, 1);
  const secondOuting = addDays(monday, 3);
  const nextMonth = new Date(Date.UTC(firstOuting.getUTCFullYear(), firstOuting.getUTCMonth() + 1, 1, 12));
  const firstSaturday = (6 - nextMonth.getUTCDay() + 7) % 7;
  const laterOuting = addDays(nextMonth, firstSaturday + 7);
  return {
    weekday: [0, 1, 2, 3, 4].map((offset) => isoDate(addDays(monday, offset))) as [string, string, string, string, string],
    chores: isoDate(saturday),
    outing: [isoDate(firstOuting), isoDate(secondOuting), isoDate(laterOuting)],
  };
}

export function scenarioRequirements(scenarioId: ChatRequest["scenarioId"], anchorDate?: string): PlanRequirements | undefined {
  if (!scenarioId) return undefined;
  const requirements = structuredClone(SCENARIO_REQUIREMENTS[scenarioId]);
  // Omission preserves the historical example definition for plans saved before
  // rolling dates were introduced. New plans always pass an explicit anchor.
  if (!anchorDate) return requirements;
  const dates = scenarioDates(anchorDate);
  if (scenarioId === "weekday") {
    const byTaskId: Record<string, string> = {
      "dinner-21": dates.weekday[0], "dinner-22": dates.weekday[1],
      "dinner-23": dates.weekday[2], "dinner-24": dates.weekday[3],
      "dinner-25": dates.weekday[4], "math-mon": dates.weekday[0],
      "jordan-call": dates.weekday[0], "reading-tue": dates.weekday[1],
      "math-wed": dates.weekday[2], "reading-thu": dates.weekday[3],
      "math-fri": dates.weekday[4],
    };
    requirements.tasks = requirements.tasks.map((task) => ({ ...task, date: byTaskId[task.id] }));
  } else if (scenarioId === "chores") {
    requirements.tasks = requirements.tasks.map((task) => ({ ...task, date: dates.chores }));
  } else {
    const firstDay = new Set(["outbound-travel", "garden", "garden-rest", "garden-finish", "lunch", "return-travel"]);
    requirements.tasks = requirements.tasks.map((task) => ({
      ...task,
      date: firstDay.has(task.id) ? dates.outing[0] : task.id === "library" || task.id === "library-rest" ? dates.outing[1] : dates.outing[2],
    }));
  }
  return requirements;
}
