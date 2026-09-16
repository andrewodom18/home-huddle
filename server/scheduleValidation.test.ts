// @vitest-environment node
import { describe, expect, it } from "vitest";
import type { PlanDraft } from "../shared/contracts";
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
