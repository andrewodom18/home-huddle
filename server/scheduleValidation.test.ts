// @vitest-environment node
import { describe, expect, it } from "vitest";
import type { PlanDraft } from "../shared/contracts";
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
      { taskId: "dinner", startTime: "5:30 PM", durationMinutes: 30, task: "Dinner", assignee: "All" },
      { taskId: "math-help", startTime: "6:00 PM", durationMinutes: 45, task: "Math help", assignee: "Maya and Casey" },
      { taskId: "jordan-call", startTime: "6:30 PM", durationMinutes: 20, task: "Jordan's call", assignee: "Jordan" },
      { taskId: "reading", startTime: "6:45 PM", durationMinutes: 20, task: "Reading", assignee: "Leo and Casey" },
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
      { taskId: "outbound-travel", startTime: "10:00 AM", durationMinutes: 25, task: "Travel out", assignee: "All" },
      { taskId: "garden", startTime: "10:25 AM", durationMinutes: 75, task: "Garden", assignee: "All" },
      { taskId: "break-before-lunch", startTime: "11:40 AM", durationMinutes: 10, task: "Seated break", assignee: "Grandma Jo" },
      { taskId: "lunch", startTime: "11:50 AM", durationMinutes: 45, task: "Lunch", assignee: "All" },
      { taskId: "break-after-lunch", startTime: "12:35 PM", durationMinutes: 10, task: "Seated break", assignee: "Grandma Jo" },
      { taskId: "return-travel", startTime: "12:45 PM", durationMinutes: 25, task: "Travel home", assignee: "All" },
    ],
  },
};

describe("canonical scenarios", () => {
  it.each(Object.keys(presetSchedules) as Array<keyof typeof presetSchedules>)("validates %s", (id) => {
    expect(scheduleIssues(presetSchedules[id], { message: "Plan this", history: [] }, SCENARIO_REQUIREMENTS[id])).toEqual([]);
  });

  it("detects a missing preset task", () => {
    const draft = { ...presetSchedules.weekday, items: presetSchedules.weekday.items.filter((item) => item.taskId !== "math-help") };
    expect(scheduleIssues(draft, { message: "Plan this", history: [] }, SCENARIO_REQUIREMENTS.weekday)).toContainEqual(expect.stringContaining("math-help"));
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

  it("enforces outing order and deadline", () => {
    const draft = { ...presetSchedules.outing, items: presetSchedules.outing.items.map((item) => item.taskId === "return-travel" ? { ...item, startTime: "1:50 PM" } : item) };
    expect(scheduleIssues(draft, { message: "Plan this", history: [] }, SCENARIO_REQUIREMENTS.outing)).toContainEqual(expect.stringContaining("must finish by 2:00 PM"));
  });
});
