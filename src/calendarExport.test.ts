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

  it("includes a saved event detail in the calendar file", () => {
    const withDetail: HouseholdPlan = {
      ...plan,
      items: [{ ...plan.items[0], details: "Use the ingredients already prepared." }],
    };
    const file = createCalendarFile(withDetail, "2026-01-15", "America/Chicago");
    expect(file.replace(/\r\n[ \t]/g, "")).toContain("Details: Use the ingredients already prepared.");
  });

  it("uses the daylight-saving offset for a summer date", () => {
    const file = createCalendarFile(plan, "2026-07-15", "America/Chicago");
    expect(file).toContain("DTSTART:20260715T223000Z");
  });

  it("exports nonconsecutive event dates across weeks and months with the correct offset", () => {
    const spreadPlan: HouseholdPlan = {
      ...plan,
      items: [
        { ...plan.items[0], date: "2026-03-06" },
        { ...plan.items[0], id: "plan-1-2", taskId: "second", task: "Second day", date: "2026-03-10" },
        { ...plan.items[0], id: "plan-1-3", taskId: "third", task: "Next month", date: "2026-04-02" },
      ],
    };
    const file = createCalendarFile(spreadPlan, "2026-01-15", "America/Chicago");
    expect(file).toContain("DTSTART:20260306T233000Z");
    expect(file).toContain("DTSTART:20260310T223000Z");
    expect(file).toContain("DTSTART:20260402T223000Z");
    expect(file).toContain("UID:2026-03-06-dinner@home-huddle.local");
    expect(file).toContain("UID:2026-03-10-second@home-huddle.local");
    expect(file).toContain("UID:2026-04-02-third@home-huddle.local");
  });

  it("uses the plan date only for events without their own date", () => {
    const mixedPlan: HouseholdPlan = {
      ...plan,
      items: [
        plan.items[0],
        { ...plan.items[0], id: "plan-1-2", taskId: "dated", date: "2026-05-04" },
      ],
    };
    const file = createCalendarFile(mixedPlan, "2026-01-15", "America/Chicago");
    expect(file).toContain("DTSTART:20260115T233000Z");
    expect(file).toContain("DTSTART:20260504T223000Z");
  });

  it("rejects a nonexistent daylight-saving wall time", () => {
    const earlyPlan: HouseholdPlan = {
      ...plan,
      items: [{ ...plan.items[0], startTime: "2:30 AM" }],
    };
    expect(() => createCalendarFile(earlyPlan, "2026-03-08", "America/Chicago"))
      .toThrow(/does not exist/);
  });

  it("rejects a nonexistent daylight-saving wall time on an event-specific date", () => {
    const earlyPlan: HouseholdPlan = {
      ...plan,
      items: [{ ...plan.items[0], date: "2026-03-08", startTime: "2:30 AM" }],
    };
    expect(() => createCalendarFile(earlyPlan, "2026-01-15", "America/Chicago"))
      .toThrow(/does not exist on 2026-03-08/);
  });

  it("rejects invalid dates and time zones", () => {
    expect(() => createCalendarFile(plan, "2026-02-30", "America/Chicago"))
      .toThrow(/valid calendar date/);
    expect(() => createCalendarFile(plan, "2026-01-15", "Mars/Olympus"))
      .toThrow(/valid time zone/);
  });

  it.each([undefined, "2026-11-01"])("rejects ambiguous daylight-saving time with event date %s", (date) => {
    const repeatedPlan: HouseholdPlan = { ...plan, items: [{ ...plan.items[0], date, startTime: "1:30 AM" }] };
    expect(() => createCalendarFile(repeatedPlan, date ? "2026-10-01" : "2026-11-01", "America/Chicago"))
      .toThrow(/occurs twice on 2026-11-01.*Choose an unambiguous time/);
    expect(createCalendarFile(repeatedPlan, "2026-11-01", "UTC"))
      .toContain("DTSTART:20261101T013000Z");
  });

  it("exports unambiguous times on both sides of a fall-back transition", () => {
    const transitionPlan: HouseholdPlan = {
      ...plan,
      items: [
        { ...plan.items[0], date: "2026-11-01", startTime: "12:30 AM" },
        { ...plan.items[0], id: "second", taskId: "second", date: "2026-11-01", startTime: "2:30 AM" },
      ],
    };
    const file = createCalendarFile(transitionPlan, "2026-10-01", "America/Chicago");
    expect(file).toContain("DTSTART:20261101T053000Z");
    expect(file).toContain("DTSTART:20261101T083000Z");
  });

  it.each([
    ["2027-03-14", "1:50 AM", 20],
    ["2026-11-01", "12:50 AM", 80],
  ])("rejects an activity crossing the clock change on %s", (date, startTime, durationMinutes) => {
    const crossingPlan: HouseholdPlan = { ...plan, items: [{ ...plan.items[0], startTime, durationMinutes }] };
    expect(() => createCalendarFile(crossingPlan, date, "America/Chicago"))
      .toThrow(/crosses a daylight-saving change/);
    expect(() => createCalendarFile(crossingPlan, date, "UTC")).not.toThrow();
    expect(() => createCalendarFile(crossingPlan, "2026-10-01", "America/Chicago")).not.toThrow();
    const datedPlan = { ...crossingPlan, items: [{ ...crossingPlan.items[0], date }] };
    expect(() => createCalendarFile(datedPlan, "2026-10-01", "America/Chicago"))
      .toThrow(/crosses a daylight-saving change/);
  });
});
