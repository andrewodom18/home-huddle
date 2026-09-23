// @vitest-environment node
import { describe, expect, it } from "vitest";
import type { PlanDraft, PlanRequirements } from "../shared/contracts";
import { SCENARIO_REQUIREMENTS } from "../shared/scenarios";
import { shortenSchedule } from "./scheduleOptimization";
import { scheduleIssues } from "./scheduleValidation";

const request = { message: "Make an efficient plan", history: [] };

describe("shortenSchedule", () => {
  it("runs independent chores in parallel without a scenario-specific rule", () => {
    const draft: PlanDraft = {
      title: "Chores", objective: "Share the work", participants: ["Alex", "Sam", "Riley"], notes: [],
      items: [
        { taskId: "kitchen", startTime: "9:00 AM", durationMinutes: 35, task: "Kitchen", assignee: "Alex" },
        { taskId: "vacuum", startTime: "9:35 AM", durationMinutes: 30, task: "Vacuum", assignee: "Sam" },
        { taskId: "start-laundry", startTime: "10:05 AM", durationMinutes: 20, task: "Start laundry", assignee: "Riley" },
        { taskId: "shared-break", startTime: "10:25 AM", durationMinutes: 15, task: "Break", assignee: "All" },
        { taskId: "fold-laundry", startTime: "10:40 AM", durationMinutes: 20, task: "Fold laundry", assignee: "Riley" },
      ],
    };

    const result = shortenSchedule(draft, request, SCENARIO_REQUIREMENTS.chores);
    expect(result.items.map((item) => item.startTime)).toEqual([
      "9:00 AM", "9:00 AM", "9:00 AM", "9:35 AM", "9:50 AM",
    ]);
    expect(scheduleIssues(result, request, SCENARIO_REQUIREMENTS.chores)).toEqual([]);
    expect(draft.items[1].startTime).toBe("9:35 AM");
  });

  it("compacts free-text plans while respecting each person's chosen order", () => {
    const requirements: PlanRequirements = {
      source: "interpreted", timeWindow: { startTime: "9:00 AM", endTime: "11:00 AM" },
      tasks: [
        { id: "a", label: "First task", durationMinutes: 20 },
        { id: "b", label: "Second task", durationMinutes: 30 },
        { id: "c", label: "Third task", durationMinutes: 20 },
      ],
    };
    const draft: PlanDraft = {
      title: "Morning", objective: "Finish chores", participants: ["Ari", "Bo"], notes: [], requirements,
      items: [
        { taskId: "a", startTime: "9:00 AM", durationMinutes: 20, task: "First task", assignee: "Ari" },
        { taskId: "b", startTime: "9:20 AM", durationMinutes: 30, task: "Second task", assignee: "Bo" },
        { taskId: "c", startTime: "9:50 AM", durationMinutes: 20, task: "Third task", assignee: "Ari" },
      ],
    };

    const result = shortenSchedule(draft, request, requirements);
    expect(result.items.map((item) => item.startTime)).toEqual(["9:00 AM", "9:00 AM", "9:20 AM"]);
    expect(scheduleIssues(result, request, requirements)).toEqual([]);
  });

  it("keeps fixed times, ordering, and requested gaps", () => {
    const requirements: PlanRequirements = {
      source: "interpreted", timeWindow: { startTime: "9:00 AM", endTime: "11:00 AM" },
      tasks: [
        { id: "prepare", label: "Prepare", durationMinutes: 20 },
        { id: "call", label: "Fixed call", durationMinutes: 20, fixedStartTime: "9:30 AM" },
        { id: "deliver", label: "Deliver", durationMinutes: 20 },
      ],
      ordering: [{ beforeTaskId: "prepare", afterTaskId: "deliver" }],
      gaps: [{ afterTaskId: "prepare", beforeTaskId: "deliver", minMinutes: 10 }],
    };
    const draft: PlanDraft = {
      title: "Morning", objective: "Prepare and deliver", participants: ["Ari", "Bo"], notes: [], requirements,
      items: [
        { taskId: "prepare", startTime: "9:00 AM", durationMinutes: 20, task: "Prepare", assignee: "Ari" },
        { taskId: "call", startTime: "9:30 AM", durationMinutes: 20, task: "Fixed call", assignee: "Bo" },
        { taskId: "deliver", startTime: "10:00 AM", durationMinutes: 20, task: "Deliver", assignee: "Ari" },
      ],
    };

    const result = shortenSchedule(draft, request, requirements);
    expect(result.items.map((item) => item.startTime)).toEqual(["9:00 AM", "9:30 AM", "9:30 AM"]);
    expect(scheduleIssues(result, request, requirements)).toEqual([]);
  });

  it("respects a free-text task's earliest start and latest finish", () => {
    const requirements: PlanRequirements = {
      source: "interpreted", timeWindow: { startTime: "9:00 AM", endTime: "11:00 AM" },
      tasks: [
        { id: "early", label: "Early task", durationMinutes: 20 },
        { id: "later", label: "Later task", durationMinutes: 20, earliestStartTime: "9:45 AM", latestEndTime: "10:15 AM" },
      ],
    };
    const draft: PlanDraft = {
      title: "Morning", objective: "Finish work", participants: ["Ari", "Bo"], notes: [], requirements,
      items: [
        { taskId: "early", startTime: "9:00 AM", durationMinutes: 20, task: "Early task", assignee: "Ari" },
        { taskId: "later", startTime: "10:00 AM", durationMinutes: 20, task: "Later task", assignee: "Bo" },
      ],
    };

    // The draft itself violates the task deadline and must never be optimized.
    expect(shortenSchedule(draft, request, requirements)).toBe(draft);
    const valid = { ...draft, items: [draft.items[0], { ...draft.items[1], startTime: "9:55 AM" }] };
    const result = shortenSchedule(valid, request, requirements);
    expect(result.items[1].startTime).toBe("9:45 AM");
    expect(scheduleIssues(result, request, requirements)).toEqual([]);
  });

  it("does not change an already compact shared-person schedule", () => {
    const requirements: PlanRequirements = {
      source: "interpreted", timeWindow: { startTime: "9:00 AM", endTime: "10:00 AM" },
      tasks: [
        { id: "first", label: "First", durationMinutes: 20 },
        { id: "second", label: "Second", durationMinutes: 20 },
      ],
    };
    const draft: PlanDraft = {
      title: "Morning", objective: "Finish", participants: ["Ari"], notes: [], requirements,
      items: [
        { taskId: "first", startTime: "9:00 AM", durationMinutes: 20, task: "First", assignee: "Ari" },
        { taskId: "second", startTime: "9:20 AM", durationMinutes: 20, task: "Second", assignee: "Ari" },
      ],
    };

    expect(shortenSchedule(draft, request, requirements)).toBe(draft);
  });
});
