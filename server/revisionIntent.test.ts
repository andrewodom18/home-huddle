// @vitest-environment node
import { describe, expect, it } from "vitest";
import type { HouseholdPlan } from "../shared/contracts";
import { isUnverifiedEventEditRequest, naturalRevisionIntent, preflightRevisionIssues, revisionIntentIssues, structuredRevisionIntent } from "./revisionIntent";

const plan: HouseholdPlan = {
  title: "Saturday chores", objective: "Finish chores", participants: ["Alex", "Sam", "Riley"],
  items: [
    { id: "task-kitchen", taskId: "kitchen", task: "Clean the kitchen", startTime: "9:00 AM", durationMinutes: 35, assignee: "Alex" },
    { id: "task-vacuum", taskId: "vacuum", task: "Vacuum the floors", startTime: "9:00 AM", durationMinutes: 30, assignee: "Sam" },
  ],
  notes: [], version: 1, updatedAt: "2026-09-17T18:00:00.000Z",
};

describe("revision intent", () => {
  it.each([
    ["Move kitchen to 9:15 AM", { taskId: "kitchen", start: { kind: "exact", value: 555 } }],
    ["Could you please change the start time of kitchen to 9:15 AM?", { taskId: "kitchen", start: { kind: "exact", value: 555 } }],
    ["Move the first task 15 minutes later", { taskId: "kitchen", start: { kind: "offset", value: 15 } }],
    ["Make vacuum 45 minutes", { taskId: "vacuum", durationMinutes: 45 }],
    ["Set the duration of kitchen to 40 minutes", { taskId: "kitchen", durationMinutes: 40 }],
    ["Set the end time of kitchen to 9:45 AM", { taskId: "kitchen", start: { kind: "exact", value: 540 }, durationMinutes: 45 }],
    ["Make vacuum end at 9:40 AM", { taskId: "vacuum", start: { kind: "exact", value: 540 }, durationMinutes: 40 }],
    ["Change kitchen's duration to 45 minutes", { taskId: "kitchen", durationMinutes: 45 }],
    ["Assign kitchen to Sam and Riley", { taskId: "kitchen", assignees: ["Sam", "Riley"] }],
    ["Assign Alex to vacuum", { taskId: "vacuum", assignees: ["Alex"] }],
  ])("recognizes %s", (message, intent) => {
    expect(naturalRevisionIntent(message as string, plan)).toEqual(intent);
  });

  it("does not mistake a vague question for an exact edit", () => {
    expect(naturalRevisionIntent("Could we make the chores easier?", plan)).toBeUndefined();
    expect(naturalRevisionIntent("Move kitchen to 9:15 AM. Also assign it to Sam", plan)).toBeUndefined();
    expect(isUnverifiedEventEditRequest("Move kitchen to 9:15 AM. Also assign it to Sam", plan)).toBe(true);
    expect(isUnverifiedEventEditRequest("Could we make the chores easier?", plan)).toBe(false);
  });

  it("recognizes and checks event-specific date moves", () => {
    const dated = { ...plan, items: plan.items.map((item) => ({ ...item, date: "2026-09-21" })) };
    expect(naturalRevisionIntent("Move kitchen to October 13, 2026", dated)).toEqual({ taskId: "kitchen", date: "2026-10-13" });
    expect(naturalRevisionIntent("Move kitchen to 2026-10-13", dated)).toEqual({ taskId: "kitchen", date: "2026-10-13" });
    const intent = structuredRevisionIntent({ taskId: "kitchen", date: "2026-10-13" }, dated);
    expect(revisionIntentIssues({ ...dated, items: dated.items.map((item) => ({ taskId: item.taskId, date: item.date, task: item.task, startTime: item.startTime, durationMinutes: item.durationMinutes, assignee: item.assignee })) }, dated, intent)).toContain("Clean the kitchen: move to the requested date 2026-10-13");
  });

  it.each([
    "Move kitchen to tomorrow",
    "Move kitchen to next Tuesday",
    "Move kitchen to this Friday",
    "Move kitchen to the day after tomorrow",
    "Move kitchen to the weekend",
    "Move kitchen two weeks later",
    "Move the first task to tomorrow",
  ])("flags a relative date edit that cannot be verified: %s", (message) => {
    expect(naturalRevisionIntent(message, plan)).toBeUndefined();
    expect(isUnverifiedEventEditRequest(message, plan)).toBe(true);
  });

  it("flags a date move even when the user abbreviates the activity name", () => {
    expect(naturalRevisionIntent("Move vacuuming to next Tuesday", plan)).toBeUndefined();
    expect(isUnverifiedEventEditRequest("Move vacuuming to next Tuesday", plan)).toBe(true);
    expect(isUnverifiedEventEditRequest("Move vacuuming to 9/22/2026", plan)).toBe(true);
  });

  it("does not silently normalize an impossible named calendar date", () => {
    expect(naturalRevisionIntent("Move kitchen to February 30, 2026", plan)).toBeUndefined();
    expect(isUnverifiedEventEditRequest("Move kitchen to February 30, 2026", plan)).toBe(true);
  });

  it("requires a date to disambiguate repeated activities", () => {
    const repeated = { ...plan, items: [
      { ...plan.items[0], date: "2026-09-21" },
      { ...plan.items[0], id: "task-kitchen-tue", taskId: "kitchen-tue", date: "2026-09-22" },
    ] };
    expect(naturalRevisionIntent("Move kitchen 15 minutes later", repeated)).toBeUndefined();
    expect(naturalRevisionIntent("Move “Clean the kitchen” on September 22, 2026 15 minutes later", repeated))
      .toEqual({ taskId: "kitchen-tue", start: { kind: "offset", value: 15 } });
  });

  it("rejects unknown assignees before a model call", () => {
    expect(() => structuredRevisionIntent({ taskId: "kitchen", assignees: ["Stranger"] }, plan)).toThrow("Choose assignees");
  });

  it("does not spend a model call on an unchanged event", () => {
    const intent = structuredRevisionIntent({ taskId: "kitchen", startTime: "9:00 AM" }, plan);
    expect(preflightRevisionIssues(intent, plan)).toContain("Clean the kitchen already has the requested schedule");
  });

  it("checks exact assignee membership, not just one matching participant", () => {
    const intent = structuredRevisionIntent({ taskId: "kitchen", assignees: ["Sam", "Riley"] }, plan);
    expect(revisionIntentIssues({ ...plan, items: plan.items.map((item) => ({
      taskId: item.taskId, task: item.task, startTime: item.startTime,
      durationMinutes: item.durationMinutes, assignee: item.assignee,
    })) }, plan, intent))
      .toContain("Clean the kitchen: assign exactly Sam, Riley");
  });
});
