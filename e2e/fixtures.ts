import { householdPlanSchema, type ChatResponse, type HouseholdPlan } from "../shared/contracts";
import { SCENARIO_REQUIREMENTS, scenarioRequirements } from "../shared/scenarios";
import { scheduleIssues } from "../server/scheduleValidation";

type Scenario = keyof typeof SCENARIO_REQUIREMENTS;
type Item = HouseholdPlan["items"][number];

const item = (taskId: string, date: string, startTime: string, durationMinutes: number, task: string, assignee: string): Item => ({
  id: `event-${taskId}`, taskId, date, startTime, durationMinutes, task, assignee,
});

const scenarioItems: Record<Scenario, Item[]> = {
  weekday: [
    item("dinner-21", "2026-09-21", "7:00 PM", 30, "Family dinner", "Maya, Leo, Jordan, Casey"),
    item("dinner-22", "2026-09-22", "6:00 PM", 30, "Family dinner", "Maya, Leo, Jordan, Casey"),
    item("dinner-23", "2026-09-23", "6:30 PM", 30, "Family dinner", "Maya, Leo, Jordan, Casey"),
    item("dinner-24", "2026-09-24", "6:00 PM", 30, "Family dinner", "Maya, Leo, Jordan, Casey"),
    item("dinner-25", "2026-09-25", "6:30 PM", 30, "Family dinner", "Maya, Leo, Jordan, Casey"),
    item("math-mon", "2026-09-21", "5:30 PM", 45, "Maya's math help", "Maya, Casey"),
    item("jordan-call", "2026-09-21", "6:30 PM", 20, "Jordan's fixed call", "Jordan"),
    item("reading-tue", "2026-09-22", "5:30 PM", 20, "Leo's reading", "Leo"),
    item("math-wed", "2026-09-23", "5:30 PM", 45, "Maya's math help", "Maya, Jordan"),
    item("reading-thu", "2026-09-24", "5:30 PM", 20, "Leo's reading", "Leo"),
    item("math-fri", "2026-09-25", "5:30 PM", 45, "Maya's math help", "Maya, Casey"),
  ],
  chores: [
    item("kitchen", "2026-09-19", "9:00 AM", 35, "Clean the kitchen", "Alex"),
    item("vacuum", "2026-09-19", "9:00 AM", 30, "Vacuum the floors", "Sam"),
    item("start-laundry", "2026-09-19", "9:00 AM", 20, "Sort and start laundry", "Riley"),
    item("fold-laundry", "2026-09-19", "9:20 AM", 20, "Fold and put away laundry", "Riley"),
    item("shared-break", "2026-09-19", "9:45 AM", 15, "Shared break", "Alex, Sam, Riley"),
  ],
  outing: [
    item("outbound-travel", "2026-09-22", "10:00 AM", 25, "Travel to botanical garden", "Noor, Eli, Grandma Jo"),
    item("garden", "2026-09-22", "10:25 AM", 35, "Botanical garden, first walk", "Noor, Eli, Grandma Jo"),
    item("garden-rest", "2026-09-22", "11:00 AM", 10, "Seated rest during garden visit", "Grandma Jo"),
    item("garden-finish", "2026-09-22", "11:10 AM", 40, "Botanical garden, second walk", "Noor, Eli, Grandma Jo"),
    item("lunch", "2026-09-22", "11:50 AM", 45, "Lunch", "Noor, Eli, Grandma Jo"),
    item("return-travel", "2026-09-22", "12:35 PM", 25, "Travel home", "Noor, Eli, Grandma Jo"),
    item("library", "2026-09-24", "10:00 AM", 60, "Accessible library visit", "Noor, Eli, Grandma Jo"),
    item("library-rest", "2026-09-24", "11:00 AM", 10, "Seated rest after library visit", "Grandma Jo"),
    item("picnic", "2026-10-10", "10:00 AM", 90, "Family picnic", "Noor, Eli, Grandma Jo"),
  ],
};

const participants: Record<Scenario, string[]> = {
  weekday: ["Maya", "Leo", "Jordan", "Casey"],
  chores: ["Alex", "Sam", "Riley"],
  outing: ["Noor", "Eli", "Grandma Jo"],
};

export function fixturePlan(scenario: Scenario, anchorDate = new Date().toISOString().slice(0, 10)): HouseholdPlan {
  const requirements = scenarioRequirements(scenario, anchorDate)!;
  return householdPlanSchema.parse({
    scenarioId: scenario,
    scenarioAnchor: anchorDate,
    title: { weekday: "School-week rhythm", chores: "Saturday chores", outing: "Three family outings" }[scenario],
    objective: "Make room for everyone's activities.",
    participants: participants[scenario],
    items: scenarioItems[scenario].map((entry) => ({
      ...entry,
      date: requirements.tasks.find((task) => task.id === entry.taskId)?.date ?? entry.date,
    })),
    requirements,
    notes: [], version: 1, updatedAt: "2026-09-17T12:00:00.000Z",
  });
}

export function fixtureResponse(plan: HouseholdPlan, reply = "Here's a checked plan for the household."): ChatResponse {
  return { reply, plan, meta: { provider: "Amazon Bedrock", modelId: "fixture", toolUsed: true, latencyMs: 10 } };
}

export function validateFixture(plan: HouseholdPlan): void {
  householdPlanSchema.parse(plan);
  const issues = scheduleIssues(plan, { history: [], message: "", planDate: plan.items[0].date });
  if (issues.length) throw new Error(`Invalid browser fixture: ${issues.join("; ")}`);
}

for (const scenario of ["weekday", "chores", "outing"] as const) validateFixture(fixturePlan(scenario));
