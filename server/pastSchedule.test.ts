// @vitest-environment node
import { describe, expect, it } from "vitest";
import { chatRequestSchema } from "../shared/contracts";
import type { PlanDraft } from "../shared/contracts";
import { localNow, pastEventIssue, pastScheduleIssues } from "./pastSchedule";

const instant = new Date("2026-09-18T04:30:00.000Z");
const draft: PlanDraft = {
  title: "Test", objective: "Test", participants: ["Alex"], notes: [],
  items: [{ taskId: "reading", task: "Reading", date: "2026-09-17", startTime: "11:15 PM", durationMinutes: 30, assignee: "Alex" }],
};

describe("past schedule validation", () => {
  it("accepts only recognized time zones on chat requests", () => {
    expect(chatRequestSchema.safeParse({ message: "Plan", history: [], timeZone: "America/Chicago" }).success).toBe(true);
    expect(chatRequestSchema.safeParse({ message: "Plan", history: [], timeZone: "Not/AZone" }).success).toBe(false);
  });

  it("uses the household time zone, not UTC or the client clock", () => {
    expect(localNow(instant, "America/Chicago")).toEqual({ date: "2026-09-17", minute: 23 * 60 + 30, zone: "America/Chicago" });
    expect(pastScheduleIssues(draft, { timeZone: "America/Chicago" }, instant)).toContainEqual(expect.stringContaining("already passed in America/Chicago"));
    expect(pastScheduleIssues(draft, { timeZone: "Pacific/Honolulu" }, instant)).toEqual([]);
  });

  it("accepts future dates and today at or after the current minute", () => {
    expect(pastEventIssue("Reading", "2026-09-17", "11:30 PM", instant, "America/Chicago")).toBeUndefined();
    expect(pastEventIssue("Reading", "2026-09-18", "9:00 AM", instant, "America/Chicago")).toBeUndefined();
    expect(pastEventIssue("Reading", "2026-09-17", "11:29 PM", instant, "America/Chicago")).toContain("already passed");
    expect(pastEventIssue("Reading", "2026-09-17", "11:30 PM", new Date("2026-09-18T04:30:01.000Z"), "America/Chicago")).toContain("already passed");
  });

  it("checks a fallback plan date and requires dates on new zoned requests", () => {
    const undated = { ...draft, items: draft.items.map((item) => ({
      taskId: item.taskId, task: item.task, startTime: item.startTime,
      durationMinutes: item.durationMinutes, assignee: item.assignee,
    })) };
    expect(pastScheduleIssues(undated, { planDate: "2026-09-17", timeZone: "America/Chicago" }, instant)).toHaveLength(1);
    expect(pastScheduleIssues(undated, { timeZone: "America/Chicago" }, instant)).toContainEqual(expect.stringContaining("choose a YYYY-MM-DD date"));
  });
});
