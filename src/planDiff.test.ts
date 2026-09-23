import { describe, expect, it } from "vitest";
import { SCENARIO_REQUIREMENTS } from "../shared/scenarios";
import type { HouseholdPlan } from "../shared/contracts";
import { reviewChanges } from "./planDiff";

describe("reviewChanges", () => {
  it("only describes meaningful checklist changes when fields arrive in a different order", () => {
    const requirements = structuredClone(SCENARIO_REQUIREMENTS.chores);
    const current: HouseholdPlan = {
      title: "Chores", objective: "Share chores", participants: ["Alex", "Sam", "Riley"],
      items: [{ id: "task-kitchen", taskId: "kitchen", task: "Clean the kitchen", date: "2026-09-19", startTime: "9:00 AM", durationMinutes: 35, assignee: "Alex" }],
      requirements, notes: [], version: 1, updatedAt: "2026-09-18T15:00:00Z",
    };
    const nextRequirements = {
      ...requirements,
      source: "interpreted" as const,
      tasks: requirements.tasks.map((task) => task.id === "kitchen"
        ? { durationMinutes: 30, label: task.label, id: task.id, date: task.date, allowedParticipants: task.allowedParticipants, kind: task.kind }
        : Object.fromEntries(Object.entries(task).reverse()) as typeof task),
    };
    const proposed: HouseholdPlan = {
      ...current, requirements: nextRequirements, version: 2,
      items: [{ ...current.items[0], durationMinutes: 30 }],
    };
    expect(reviewChanges(current, proposed).map((change) => change.label)).toEqual(["Clean the kitchen", "Checklist: Clean the kitchen"]);
  });
});

it("reviews plan text, notes, removed tasks and every captured constraint", () => {
  const current: HouseholdPlan = {
    title: "Old title", objective: "Old objective", participants: ["Alex", "Sam"],
    items: [{ id: "a", taskId: "a", task: "Laundry", date: "2026-10-01", startTime: "9:00 AM", durationMinutes: 20, assignee: "Alex", details: "Old details" }],
    notes: ["Old note"], version: 1, updatedAt: "2026-09-18T15:00:00Z",
    requirements: { source: "interpreted", timeWindow: { startTime: "9:00 AM", endTime: "11:00 AM" }, tasks: [{ id: "a", label: "Laundry", durationMinutes: 20, atLeastOneOf: ["Alex", "Sam"], fixedDate: true, date: "2026-10-01" }], assumptions: ["Use the small washer"], resources: [{ id: "washer", label: "Washer", capacity: 1 }], availability: [{ participant: "Alex", startTime: "9:00 AM", endTime: "11:00 AM" }], preferences: [{ kind: "earlier_finish", description: "Finish early" }] },
  };
  const next: HouseholdPlan = {
    ...current, title: "New title", objective: "New objective", notes: ["New note"], participants: ["Alex"],
    items: [{ ...current.items[0], taskId: "b", task: "Vacuum", details: "New details" }],
    requirements: { ...current.requirements!, tasks: [{ id: "b", label: "Vacuum", durationMinutes: 20, requiredParticipants: ["Alex"] }], assumptions: [], availability: [], resources: [], preferences: [], workload: { participants: ["Alex"], minMinutes: 10, maxMinutes: 30 } },
  };
  const changes = reviewChanges(current, next);
  expect(changes.map((change) => change.id)).toEqual(expect.arrayContaining(["title", "objective", "participants", "notes", "event-b", "removed-a", "checklist-b", "checklist-removed-a", "checklist-assumptions", "checklist-availability", "checklist-resources", "checklist-preferences", "checklist-workload"]));
  expect(changes.find((change) => change.id === "checklist-removed-a")?.before).toContain("Alex or Sam");
  expect(changes.find((change) => change.id === "event-b")?.after).toContain("New details");
});
