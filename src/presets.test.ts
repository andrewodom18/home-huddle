import { describe, expect, it } from "vitest";
import type { HouseholdPlan } from "../shared/contracts";
import { SCENARIO_REQUIREMENTS, scenarioRequirements } from "../shared/scenarios";
import { presetScenarios, revisionPromptsFor } from "./presets";

describe("presetScenarios", () => {
  it("keeps each displayed full prompt aligned with its anchored checklist", () => {
    const presets = presetScenarios("2026-12-31");
    expect(presets.map((preset) => preset.id)).toEqual(["weekday", "chores", "outing"]);
    expect(presets[0].prompt).toContain("2027-01-04 through 2027-01-08");
    expect(presets[1].prompt).toContain("Saturday 2027-01-02");
    expect(presets[2].prompt).toContain("2027-01-05 and 2027-01-07, then 2027-02-13");
    expect(presets[2].prompt).toContain("split the 75-minute garden visit into a 35-minute first walk and a 40-minute second walk");
    expect(presets[2].prompt).toContain("visit the accessible library together");
    expect(presets[2].prompt).toContain("a separate 10-minute seated rest");
    expect(presets[2].prompt).not.toMatch(/seated breaks? before and after lunch/i);
    expect(presets[2].prompt).toContain("Grandma Jo's 10-minute seated rest between them");
    expect(presets[2].prompt.indexOf("visit the accessible library together")).toBeLessThan(presets[2].prompt.indexOf("a separate 10-minute seated rest"));
    for (const preset of presets.slice(1)) {
      const required = scenarioRequirements(preset.id as "chores" | "outing", "2026-12-31")!;
      for (const date of new Set(required.tasks.map((task) => task.date))) expect(preset.prompt).toContain(date);
    }
  });
});

describe("revisionPromptsFor", () => {
  it("names a movable activity instead of an ambiguous first task", () => {
    const plan: HouseholdPlan = {
      scenarioId: "weekday",
      title: "Evening",
      objective: "Dinner and homework",
      participants: ["Maya", "Leo", "Jordan", "Casey"],
      items: [
        { id: "task-jordan-call", taskId: "jordan-call", startTime: "6:30 PM", durationMinutes: 20, task: "Jordan's fixed call", assignee: "Jordan" },
        { id: "task-math-help", taskId: "math-help", startTime: "6:00 PM", durationMinutes: 45, task: "Maya's math help", assignee: "Maya, Casey" },
      ],
      requirements: SCENARIO_REQUIREMENTS.weekday,
      notes: [], version: 1, updatedAt: "2026-09-17T18:00:00.000Z",
    };

    expect(revisionPromptsFor(plan)[0]).toBe("Move “Maya's math help” 15 minutes later");
  });

  it("adds a date when the suggested activity repeats across days", () => {
    const plan: HouseholdPlan = {
      scenarioId: "weekday", title: "Week", objective: "Dinner", participants: ["Maya"],
      items: [
        { id: "task-dinner-21", taskId: "dinner-21", date: "2026-09-21", startTime: "5:30 PM", durationMinutes: 30, task: "Family dinner", assignee: "Maya" },
        { id: "task-dinner-22", taskId: "dinner-22", date: "2026-09-22", startTime: "5:30 PM", durationMinutes: 30, task: "Family dinner", assignee: "Maya" },
      ],
      requirements: SCENARIO_REQUIREMENTS.weekday, notes: [], version: 1, updatedAt: "2026-09-17T18:00:00.000Z",
    };
    expect(revisionPromptsFor(plan)[0]).toBe("Move “Family dinner” on September 21, 2026 15 minutes later");
  });
});
