// @vitest-environment node
import { describe, expect, it } from "vitest";
import type { PlanRequirements } from "../shared/contracts";
import { nextWeekCaptureIssues, requestedNextWeek } from "./relativeWeek";

const request = "Plan next week: a piano lesson on Monday at noon, a date on Tuesday at 7:30 PM and a doctor appointment on Thursday at 4 PM. Grocery shopping on Thursday and pick up the dog on Tuesday at 9 AM.";
const tasks = [
  ["Piano lesson", "2026-10-12"],
  ["Date", "2026-10-13"],
  ["Doctor appointment", "2026-10-15"],
  ["Grocery shopping", "2026-10-15"],
  ["Pick up the dog", "2026-10-13"],
] as const;
const requirements: PlanRequirements = {
  source: "interpreted", timeWindow: { startTime: "8:00 AM", endTime: "10:00 PM" },
  tasks: tasks.map(([label, date], index) => ({ id: `task_${index}`, label, date, durationMinutes: 30 })),
};

describe("next-week date grounding", () => {
  it.each(["2026-10-05", "2026-10-11"])('uses the household calendar week after %s', (today) => {
    expect(requestedNextWeek(request, today)).toEqual({ start: "2026-10-12", end: "2026-10-18" });
  });

  it("checks independently named weekdays rather than just the seven-day range", () => {
    const week = requestedNextWeek(request, "2026-10-05")!;
    expect(nextWeekCaptureIssues(requirements, request, week)).toEqual([]);
    const wrong = { ...requirements, tasks: requirements.tasks.map((task) => task.label === "Grocery shopping" ? { ...task, date: "2026-10-16" } : task) };
    expect(nextWeekCaptureIssues(wrong, request, week)).toContain("Grocery shopping: thursday next week is 2026-10-15, not 2026-10-16");
  });

  it("leaves a genuinely flexible task unassigned to a nearby weekday", () => {
    const week = requestedNextWeek(request, "2026-10-05")!;
    const flexible = { ...requirements, tasks: [{ id: "groceries", label: "Buy groceries", date: "2026-10-14", durationMinutes: 30 }] };
    expect(nextWeekCaptureIssues(flexible, "Next week, buy groceries whenever there is time. Piano lesson on Monday.", week)).toEqual([]);
  });
});
