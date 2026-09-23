// @vitest-environment node
import { describe, expect, it } from "vitest";
import type { HouseholdPlan, PlanDraft, PlanRequirements } from "../shared/contracts";
import { SCENARIO_REQUIREMENTS } from "../shared/scenarios";
import { scheduleIssues } from "./scheduleValidation";

const draft: PlanDraft = {
  title: "Evening",
  objective: "Dinner and homework",
  participants: ["Maya", "Leo", "Jordan", "Casey"],
  items: [
    { startTime: "5:30 PM", durationMinutes: 30, task: "Dinner", assignee: "All" },
    { startTime: "6:10 PM", durationMinutes: 45, task: "Math help", assignee: "Casey" },
    { startTime: "6:30 PM", durationMinutes: 20, task: "Jordan's call", assignee: "Jordan" },
    { startTime: "7:05 PM", durationMinutes: 20, task: "Reading", assignee: "Casey" },
  ],
  notes: [],
};

const request = {
  message: "Add a 10-minute transition buffer",
  history: [{ role: "user" as const, text: "Jordan has a fixed call from 6:30 PM to 6:50 PM." }],
};

describe("scheduleIssues", () => {
  it("accepts a fixed call, separate assignments, and real transition gaps", () => {
    expect(scheduleIssues(draft, request)).toEqual([]);
  });

  it("detects overlapping work assigned to one person", () => {
    const changed = { ...draft, items: [...draft.items, { startTime: "6:15 PM", durationMinutes: 20, task: "Reading help", assignee: "Casey" }] };
    expect(scheduleIssues(changed, request)).toContain("Math help and Reading help overlap for Casey");
  });

  it("rejects a moved fixed call", () => {
    const changed = { ...draft, items: draft.items.map((item, index) => ({ ...item, startTime: ["5:30 PM", "6:00 PM", "6:50 PM", "7:10 PM"][index] })) };
    expect(scheduleIssues(changed, request)).toContainEqual(
      expect.stringContaining("Keep Jordan's call at 6:30 PM"),
    );
  });

  it("finds a participant's buffer even with parallel work during the gap", () => {
    const changed = {
      ...draft,
      items: [
        { startTime: "6:00 PM", durationMinutes: 20, task: "Math", assignee: "Casey" },
        { startTime: "6:25 PM", durationMinutes: 20, task: "Reading", assignee: "Jordan" },
        { startTime: "6:30 PM", durationMinutes: 20, task: "Practice", assignee: "Casey" },
      ],
    };
    expect(scheduleIssues(changed, { message: request.message, history: [] })).toEqual([]);
  });

  it("does not count an unrelated gap as a transition buffer", () => {
    const changed = {
      ...draft,
      items: [
        { startTime: "6:00 PM", durationMinutes: 20, task: "Math", assignee: "Casey" },
        { startTime: "6:20 PM", durationMinutes: 20, task: "Practice", assignee: "Casey" },
        { startTime: "7:00 PM", durationMinutes: 20, task: "Reading", assignee: "Jordan" },
      ],
    };
    expect(scheduleIssues(changed, { message: request.message, history: [] })).toContain(
      "Add a real 10-minute gap between scheduled activities",
    );
  });
});

const presetSchedules: Record<keyof typeof SCENARIO_REQUIREMENTS, PlanDraft> = {
  weekday: {
    title: "Weekday", objective: "Dinner and homework", participants: ["Maya", "Leo", "Jordan", "Casey"], notes: [],
    items: [
      ...([21, 22, 23, 24, 25] as const).map((day) => ({ taskId: `dinner-${day}`, date: `2026-09-${day}`, startTime: "5:30 PM", durationMinutes: 30, task: "Dinner", assignee: "All" })),
      { taskId: "math-mon", date: "2026-09-21", startTime: "6:00 PM", durationMinutes: 45, task: "Math help", assignee: "Maya and Casey" },
      { taskId: "jordan-call", date: "2026-09-21", startTime: "6:30 PM", durationMinutes: 20, task: "Jordan's call", assignee: "Jordan" },
      { taskId: "reading-tue", date: "2026-09-22", startTime: "6:00 PM", durationMinutes: 20, task: "Reading", assignee: "Leo and Casey" },
      { taskId: "math-wed", date: "2026-09-23", startTime: "6:00 PM", durationMinutes: 45, task: "Math help", assignee: "Maya and Casey" },
      { taskId: "reading-thu", date: "2026-09-24", startTime: "6:00 PM", durationMinutes: 20, task: "Reading", assignee: "Leo and Casey" },
      { taskId: "math-fri", date: "2026-09-25", startTime: "6:00 PM", durationMinutes: 45, task: "Math help", assignee: "Maya and Casey" },
    ],
  },
  chores: {
    title: "Chores", objective: "Fair work", participants: ["Alex", "Sam", "Riley"], notes: [],
    items: [
      { taskId: "kitchen", startTime: "9:00 AM", durationMinutes: 35, task: "Kitchen", assignee: "Alex" },
      { taskId: "vacuum", startTime: "9:00 AM", durationMinutes: 30, task: "Vacuum", assignee: "Sam" },
      { taskId: "start-laundry", startTime: "9:00 AM", durationMinutes: 20, task: "Start laundry", assignee: "Riley" },
      { taskId: "fold-laundry", startTime: "9:25 AM", durationMinutes: 20, task: "Fold laundry", assignee: "Riley" },
      { taskId: "shared-break", startTime: "9:50 AM", durationMinutes: 15, task: "Break", assignee: "All" },
    ],
  },
  outing: {
    title: "Outing", objective: "Garden trip", participants: ["Noor", "Eli", "Grandma Jo"], notes: [],
    items: [
      { taskId: "outbound-travel", date: "2026-09-22", startTime: "10:00 AM", durationMinutes: 25, task: "Travel out", assignee: "All" },
      { taskId: "garden", date: "2026-09-22", startTime: "10:25 AM", durationMinutes: 35, task: "Garden first walk", assignee: "All" },
      { taskId: "garden-rest", date: "2026-09-22", startTime: "11:00 AM", durationMinutes: 10, task: "Garden rest", assignee: "Grandma Jo" },
      { taskId: "garden-finish", date: "2026-09-22", startTime: "11:10 AM", durationMinutes: 40, task: "Garden second walk", assignee: "All" },
      { taskId: "lunch", date: "2026-09-22", startTime: "11:50 AM", durationMinutes: 45, task: "Lunch", assignee: "All" },
      { taskId: "return-travel", date: "2026-09-22", startTime: "12:35 PM", durationMinutes: 25, task: "Travel home", assignee: "All" },
      { taskId: "library", date: "2026-09-24", startTime: "10:00 AM", durationMinutes: 60, task: "Library", assignee: "All" },
      { taskId: "library-rest", date: "2026-09-24", startTime: "11:00 AM", durationMinutes: 10, task: "Library rest", assignee: "Grandma Jo" },
      { taskId: "picnic", date: "2026-10-10", startTime: "10:00 AM", durationMinutes: 90, task: "Picnic", assignee: "All" },
    ],
  },
};

describe("canonical scenarios", () => {
  it.each(Object.keys(presetSchedules) as Array<keyof typeof presetSchedules>)("validates %s", (id) => {
    expect(scheduleIssues(presetSchedules[id], { message: "Plan this", history: [] }, SCENARIO_REQUIREMENTS[id])).toEqual([]);
  });

  it("detects a missing preset task", () => {
    const draft = { ...presetSchedules.weekday, items: presetSchedules.weekday.items.filter((item) => item.taskId !== "math-mon") };
    expect(scheduleIssues(draft, { message: "Plan this", history: [] }, SCENARIO_REQUIREMENTS.weekday)).toContainEqual(expect.stringContaining("math-mon"));
  });

  it("rejects invalid assignees, duration, and fixed time", () => {
    const draft = { ...presetSchedules.weekday, items: presetSchedules.weekday.items.map((item) => item.taskId === "jordan-call" ? { ...item, assignee: "Nobody", durationMinutes: 10, startTime: "6:50 PM" } : item) };
    const issues = scheduleIssues(draft, { message: "Plan this", history: [] }, SCENARIO_REQUIREMENTS.weekday);
    expect(issues).toContainEqual(expect.stringContaining("assign at least one"));
    expect(issues).toContainEqual(expect.stringContaining("required 20-minute"));
    expect(issues).toContainEqual(expect.stringContaining("fixed start"));
  });

  it("does not treat a negated or ambiguous name as an assignment", () => {
    const draft = { ...presetSchedules.weekday, items: presetSchedules.weekday.items.map((item) => item.taskId === "jordan-call" ? { ...item, assignee: "Not Jordan" } : item) };
    expect(scheduleIssues(draft, { message: "Plan this", history: [] }, SCENARIO_REQUIREMENTS.weekday)).toContainEqual(expect.stringContaining("assign at least one listed participant"));
  });

  it("prevents Riley from heavy chores and enforces fairness", () => {
    const draft = { ...presetSchedules.chores, items: presetSchedules.chores.items.map((item) => item.taskId === "kitchen" ? { ...item, assignee: "Riley" } : item) };
    const issues = scheduleIssues(draft, { message: "Plan this", history: [] }, SCENARIO_REQUIREMENTS.chores);
    expect(issues).toContainEqual(expect.stringContaining("not an allowed assignee"));
    expect(issues).toContainEqual(expect.stringContaining("minutes of work"));
  });

  it("rejects a shared break before anyone has completed work", () => {
    const draft = {
      ...presetSchedules.chores,
      items: presetSchedules.chores.items.map((item) => ({
        ...item,
        startTime: item.taskId === "shared-break" ? "9:00 AM" : item.taskId === "fold-laundry" ? "9:40 AM" : "9:15 AM",
      })),
    };
    const issues = scheduleIssues(draft, { message: "Plan this", history: [] }, SCENARIO_REQUIREMENTS.chores);
    expect(issues).toContain("Kitchen must finish before Break");
    expect(issues).toContain("Vacuum must finish before Break");
    expect(issues).toContain("Start laundry must finish before Break");
  });

  it("checks that a named suggested revision actually moves that activity", () => {
    const original: HouseholdPlan = {
      ...presetSchedules.chores,
      items: presetSchedules.chores.items.map((item) => ({ ...item, id: `task-${item.taskId}` })),
      requirements: SCENARIO_REQUIREMENTS.chores,
      scenarioId: "chores",
      version: 1,
      updatedAt: "2026-09-17T18:00:00.000Z",
    };
    const request = { message: "Move “Kitchen” 15 minutes later", history: [], currentPlan: original };
    expect(scheduleIssues(presetSchedules.chores, request, SCENARIO_REQUIREMENTS.chores)).toContain(
      "Move Kitchen exactly 15 minutes later than in the current plan",
    );
    const moved = {
      ...presetSchedules.chores,
      items: presetSchedules.chores.items.map((item) => item.taskId === "kitchen" ? { ...item, startTime: "9:15 AM" } : item),
    };
    expect(scheduleIssues(moved, request, SCENARIO_REQUIREMENTS.chores)).toEqual([]);
  });

  it("requires Riley to start chores before the shared break", () => {
    const draft = {
      ...presetSchedules.chores,
      items: presetSchedules.chores.items.map((item) => ({
        ...item,
        startTime: item.taskId === "shared-break" ? "9:35 AM" : item.taskId === "start-laundry" ? "9:50 AM" : item.taskId === "fold-laundry" ? "10:10 AM" : "9:00 AM",
      })),
    };
    expect(scheduleIssues(draft, { message: "Plan this", history: [] }, SCENARIO_REQUIREMENTS.chores)).toContain(
      "Start laundry must finish before Break",
    );
  });

  it("accepts parallel chores, then a shared break, then remaining laundry", () => {
    const draft = {
      ...presetSchedules.chores,
      items: presetSchedules.chores.items.map((item) => ({
        ...item,
        startTime: item.taskId === "shared-break" ? "9:35 AM" : item.taskId === "fold-laundry" ? "9:50 AM" : "9:00 AM",
      })),
    };
    expect(scheduleIssues(draft, { message: "Plan this", history: [] }, SCENARIO_REQUIREMENTS.chores)).toEqual([]);
  });

  it("enforces outing order and deadline", () => {
    const draft = { ...presetSchedules.outing, items: presetSchedules.outing.items.map((item) => item.taskId === "return-travel" ? { ...item, startTime: "1:50 PM" } : item) };
    expect(scheduleIssues(draft, { message: "Plan this", history: [] }, SCENARIO_REQUIREMENTS.outing)).toContainEqual(expect.stringContaining("must finish by 2:00 PM"));
  });

  it("rejects seated rests on the wrong side of their exerting activity", () => {
    const lateGardenRest = {
      ...presetSchedules.outing,
      items: presetSchedules.outing.items.map((item) => item.taskId === "garden-rest" ? { ...item, startTime: "11:50 AM" } : item),
    };
    expect(scheduleIssues(lateGardenRest, { message: "Plan this", history: [] }, SCENARIO_REQUIREMENTS.outing)).toContainEqual(expect.stringContaining("Garden rest must finish before Garden second walk"));
    const prematureLibraryRest = {
      ...presetSchedules.outing,
      items: presetSchedules.outing.items.map((item) => item.taskId === "library-rest" ? { ...item, startTime: "10:10 AM" } : item),
    };
    expect(scheduleIssues(prematureLibraryRest, { message: "Plan this", history: [] }, SCENARIO_REQUIREMENTS.outing)).toContainEqual(expect.stringContaining("Library must finish before Library rest"));
  });

  it("permits the same person at the same time on different dates, but rejects a wrong required date", () => {
    expect(scheduleIssues(presetSchedules.outing, { message: "Plan this", history: [] }, SCENARIO_REQUIREMENTS.outing)).toEqual([]);
    const moved = { ...presetSchedules.outing, items: presetSchedules.outing.items.map((item) => item.taskId === "library" ? { ...item, date: "2026-09-22" } : item) };
    const issues = scheduleIssues(moved, { message: "Plan this", history: [] }, SCENARIO_REQUIREMENTS.outing);
    expect(issues).toContainEqual(expect.stringContaining("keep the required date 2026-09-24"));
    expect(issues).toContainEqual(expect.stringContaining("overlap"));
  });

  it("does not silently apply a single fallback date to a multi-day example", () => {
    const omitted = { ...presetSchedules.weekday, items: presetSchedules.weekday.items.map((item) => item.taskId === "dinner-21" ? { ...item, date: undefined } : item) };
    expect(scheduleIssues(omitted, { message: "Plan this", history: [], planDate: "2026-09-21" }, SCENARIO_REQUIREMENTS.weekday)).toContainEqual(expect.stringContaining("explicit YYYY-MM-DD date"));
  });

  it("checks date-specific windows and cross-date ordering", () => {
    const requirements = {
      ...SCENARIO_REQUIREMENTS.outing,
      timeWindows: [{ date: "2026-10-10", startTime: "11:00 AM", endTime: "1:00 PM" }],
      ordering: [...SCENARIO_REQUIREMENTS.outing.ordering!, { beforeTaskId: "library", afterTaskId: "picnic" }],
    };
    const issues = scheduleIssues(presetSchedules.outing, { message: "Plan this", history: [] }, requirements);
    expect(issues).toContain("Picnic: starts before 11:00 AM");
    const reversed = { ...presetSchedules.outing, items: presetSchedules.outing.items.map((item) => item.taskId === "picnic" ? { ...item, date: "2026-09-20" } : item) };
    expect(scheduleIssues(reversed, { message: "Plan this", history: [] }, requirements)).toContain("Library must finish before Picnic");
  });
});

describe("interpreted multi-day checklist", () => {
  const requirements: PlanRequirements = {
    source: "interpreted",
    timeWindow: { startTime: "9:00 AM", endTime: "12:00 PM" },
    tasks: [
      { id: "prepare", date: "2026-09-30", label: "Prepare supplies", durationMinutes: 30 },
      { id: "pack", date: "2026-09-30", label: "Pack supplies", durationMinutes: 30 },
      { id: "deliver", date: "2026-10-02", label: "Deliver supplies", durationMinutes: 30 },
    ],
    ordering: [{ beforeTaskId: "prepare", afterTaskId: "deliver" }],
    gaps: [{ afterTaskId: "prepare", beforeTaskId: "pack", minMinutes: 10 }],
  };
  const plan: PlanDraft = {
    title: "Supply run", objective: "Prepare and deliver", participants: ["Alex", "Sam"], notes: [],
    requirements,
    items: [
      { taskId: "prepare", date: "2026-09-30", startTime: "9:00 AM", durationMinutes: 30, task: "Prepare supplies", assignee: "Alex" },
      { taskId: "pack", date: "2026-09-30", startTime: "9:40 AM", durationMinutes: 30, task: "Pack supplies", assignee: "Sam" },
      { taskId: "deliver", date: "2026-10-02", startTime: "9:00 AM", durationMinutes: 30, task: "Deliver supplies", assignee: "Alex" },
    ],
  };
  const context = { message: "Plan these tasks", history: [] };

  it("accepts parallel people and a cross-month dependency with a measured gap", () => {
    expect(scheduleIssues(plan, context)).toEqual([]);
    const parallel = { ...plan, items: plan.items.map((item) => item.taskId === "pack" ? { ...item, startTime: "9:00 AM" } : item) };
    expect(scheduleIssues(parallel, context)).toContain("Leave 10 minutes between Prepare supplies and Pack supplies");
    expect(scheduleIssues(parallel, context)).not.toContainEqual(expect.stringContaining("overlap for"));
  });

  it("rejects duplicate, missing, and unlisted stable IDs", () => {
    const duplicate = { ...plan, items: [...plan.items, { ...plan.items[0] }] };
    const issues = scheduleIssues(duplicate, context);
    expect(issues).toContain("Duplicate scheduled task ID: prepare");
    expect(issues).toContain("Prepare supplies: schedule exactly once with task ID prepare");

    const substituted = { ...plan, items: plan.items.map((item) => item.taskId === "pack" ? { ...item, taskId: "unknown" } : item) };
    const substitutedIssues = scheduleIssues(substituted, context);
    expect(substitutedIssues).toContain("Pack supplies: schedule exactly once with task ID pack");
    expect(substitutedIssues).toContain("Pack supplies: add this task to the displayed requirements checklist");
  });

  it("checks per-date windows, same-person conflicts, and cross-month ordering", () => {
    const perDate = { ...requirements, timeWindows: [{ date: "2026-10-02", startTime: "10:00 AM", endTime: "11:00 AM" }] };
    expect(scheduleIssues(plan, context, perDate)).toContain("Deliver supplies: starts before 10:00 AM");

    const conflict = { ...plan, items: plan.items.map((item) => item.taskId === "pack" ? { ...item, startTime: "9:15 AM", assignee: "Alex" } : item) };
    expect(scheduleIssues(conflict, context)).toContain("Prepare supplies and Pack supplies overlap for Alex");

    const reversed = { ...plan, items: plan.items.map((item) => item.taskId === "deliver" ? { ...item, date: "2026-09-29" } : item) };
    expect(scheduleIssues(reversed, context)).toContain("Prepare supplies must finish before Deliver supplies");
  });
});
