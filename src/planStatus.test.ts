import { describe, expect, it } from "vitest";
import type { HouseholdPlan } from "../shared/contracts";
import { SCENARIO_REQUIREMENTS, scenarioRequirements } from "../shared/scenarios";
import { isOutdatedExample } from "./planStatus";

const plan: HouseholdPlan = {
  scenarioId: "chores", title: "Chores", objective: "Share the work", participants: ["Alex", "Sam", "Riley"],
  items: [{ id: "task-kitchen", taskId: "kitchen", startTime: "9:00 AM", durationMinutes: 35, task: "Kitchen", assignee: "Alex" }],
  notes: [], version: 1, updatedAt: "2026-09-17T12:00:00.000Z", requirements: SCENARIO_REQUIREMENTS.chores,
};

describe("isOutdatedExample", () => {
  it("detects an old checklist that omitted a new hard requirement", () => {
    expect(isOutdatedExample({ ...plan, requirements: { ...SCENARIO_REQUIREMENTS.chores, ordering: undefined } })).toBe(true);
  });

  it("accepts the current checklist and additive revision constraints", () => {
    expect(isOutdatedExample(plan)).toBe(false);
    expect(isOutdatedExample({
      ...plan,
      requirements: { ...SCENARIO_REQUIREMENTS.chores, gaps: [{ afterTaskId: "kitchen", beforeTaskId: "shared-break", minMinutes: 5 }] },
    })).toBe(false);
    expect(isOutdatedExample({
      ...plan,
      requirements: {
        ...SCENARIO_REQUIREMENTS.chores,
        source: "interpreted",
        gaps: [{ afterTaskId: "kitchen", beforeTaskId: "shared-break", minMinutes: 5 }],
      },
    })).toBe(false);
  });

  it("keeps a verified example current after a movable event date changes", () => {
    const requirements = structuredClone(SCENARIO_REQUIREMENTS.weekday);
    requirements.tasks[0].date = "2026-09-28";
    expect(isOutdatedExample({ ...plan, scenarioId: "weekday", requirements })).toBe(false);
    const fixedCall = requirements.tasks.find((task) => task.id === "jordan-call");
    if (!fixedCall) throw new Error("Missing fixed call fixture");
    fixedCall.date = "2026-09-28";
    expect(isOutdatedExample({ ...plan, scenarioId: "weekday", requirements })).toBe(true);
  });

  it("recognizes a declared, validated change to a flexible example task without presenting it as untouched", () => {
    const requirements = structuredClone(SCENARIO_REQUIREMENTS.chores);
    requirements.source = "interpreted";
    const kitchen = requirements.tasks.find((task) => task.id === "kitchen");
    if (!kitchen) throw new Error("Missing kitchen fixture");
    kitchen.durationMinutes = 30;
    kitchen.requiredParticipants = ["Sam"];
    kitchen.allowedParticipants = ["Sam"];
    delete kitchen.atLeastOneOf;
    const edited: HouseholdPlan = {
      ...plan, requirements, scenarioEdits: { kitchen: { durationMinutes: 30, assignees: ["Sam"] } },
      items: [{ ...plan.items[0], durationMinutes: 30, assignee: "Sam" }],
    };
    expect(isOutdatedExample(edited)).toBe(false);
    expect(isOutdatedExample({ ...edited, scenarioEdits: undefined })).toBe(true);
    expect(isOutdatedExample({ ...edited, items: plan.items })).toBe(true);
  });

  it("checks a rolling example against its original anchor, not today's date", () => {
    const anchored = {
      ...plan,
      scenarioId: "weekday" as const,
      scenarioAnchor: "2026-12-31",
      requirements: scenarioRequirements("weekday", "2026-12-31"),
    };
    expect(isOutdatedExample(anchored)).toBe(false);
    expect(isOutdatedExample({ ...anchored, requirements: SCENARIO_REQUIREMENTS.weekday })).toBe(true);
    const withoutDates = structuredClone(anchored.requirements!);
    withoutDates.tasks = withoutDates.tasks.map((task) => ({ ...task, date: undefined }));
    expect(isOutdatedExample({ ...anchored, requirements: withoutDates })).toBe(true);
  });
});
