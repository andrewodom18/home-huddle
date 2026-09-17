import { describe, expect, it } from "vitest";
import type { HouseholdPlan } from "../shared/contracts";
import { createCalendarFile } from "./calendarExport";

const plan: HouseholdPlan = {
  title: "Evening plan",
  objective: "Plan a calm evening",
  participants: ["Jordan"],
  items: [{
    id: "plan-1-1",
    taskId: "dinner",
    task: "Dinner",
    startTime: "5:30 PM",
    durationMinutes: 30,
    assignee: "Jordan",
  }],
  notes: [],
  version: 1,
  updatedAt: "2026-09-16T00:00:00.000Z",
};

describe("calendar export", () => {
  it("exports a winter date in the selected time zone as UTC", () => {
    const file = createCalendarFile(plan, "2026-01-15", "America/Chicago");
    expect(file).toContain("DTSTART:20260115T233000Z");
    expect(file).toContain("DURATION:PT30M");
    expect(file).toContain("SUMMARY:Dinner");
    expect(file).toContain("UID:2026-01-15-dinner@home-huddle.local");
  });

  it("uses the daylight-saving offset for a summer date", () => {
    const file = createCalendarFile(plan, "2026-07-15", "America/Chicago");
    expect(file).toContain("DTSTART:20260715T223000Z");
  });

  it("rejects a nonexistent daylight-saving wall time", () => {
    const earlyPlan: HouseholdPlan = {
      ...plan,
      items: [{ ...plan.items[0], startTime: "2:30 AM" }],
    };
    expect(() => createCalendarFile(earlyPlan, "2026-03-08", "America/Chicago"))
      .toThrow(/does not exist/);
  });

  it("rejects invalid dates and time zones", () => {
    expect(() => createCalendarFile(plan, "2026-02-30", "America/Chicago"))
      .toThrow(/valid calendar date/);
    expect(() => createCalendarFile(plan, "2026-01-15", "Mars/Olympus"))
      .toThrow(/valid time zone/);
  });
});
