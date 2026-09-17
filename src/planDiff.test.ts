import { describe, expect, it } from "vitest";
import type { HouseholdPlan } from "../shared/contracts";
import { preservedFixedCommitments, reviewChanges } from "./planDiff";

const current: HouseholdPlan = {
  title: "Evening", objective: "Finish together", participants: ["Maya", "Jordan"],
  items: [
    { id: "task-call", taskId: "call", task: "Jordan's call", assignee: "Jordan", startTime: "6:30 PM", durationMinutes: 20 },
    { id: "task-dinner", taskId: "dinner", task: "Dinner", assignee: "Maya", startTime: "7:00 PM", durationMinutes: 30 },
  ],
  requirements: { source: "scenario", timeWindow: { startTime: "5:30 PM", endTime: "8:00 PM" }, tasks: [
    { id: "call", label: "Jordan's call", durationMinutes: 20, fixedStartTime: "6:30 PM" },
    { id: "dinner", label: "Dinner", durationMinutes: 30 },
  ] },
  notes: [], version: 1, updatedAt: "2026-09-16T10:00:00.000Z",
};

describe("revision comparison", () => {
  it("matches stable task IDs and shows before and after owners and times", () => {
    const proposal: HouseholdPlan = { ...current, version: 2, items: [
      current.items[0],
      { ...current.items[1], assignee: "Jordan", startTime: "7:15 PM" },
    ] };
    expect(reviewChanges(current, proposal)).toEqual([{
      id: "dinner", label: "Dinner", before: "7:00 PM · Maya · 30 min", after: "7:15 PM · Jordan · 30 min",
    }]);
    expect(preservedFixedCommitments(current, proposal)).toEqual(["Jordan's call at 6:30 PM"]);
  });

  it("does not call a moved fixed commitment preserved", () => {
    const proposal: HouseholdPlan = { ...current, items: [{ ...current.items[0], startTime: "6:40 PM" }, current.items[1]] };
    expect(preservedFixedCommitments(current, proposal)).toEqual([]);
  });
});
