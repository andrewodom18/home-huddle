import type { HouseholdPlan } from "../shared/contracts";
import { describe, expect, it } from "vitest";
import { asksToMoveDate, asksToMoveWholePlanDate, isPastEventStart, isValidPlanDate, newPlanTimeIssue, pastPlanMoveIssue, planDates, requestedPlanDate, revisionTimeIssue, suggestedPlanDate, todayInZone } from "./planDate";

describe("past schedule checks", () => {
  const now = new Date("2026-09-18T15:00:00Z"); // 10:00 AM in Chicago.

  it("uses the user's time zone and rejects past dates and same-day starts", () => {
    expect(todayInZone("America/Chicago", now)).toBe("2026-09-18");
    expect(todayInZone("Pacific/Auckland", now)).toBe("2026-09-19");
    expect(isPastEventStart("2026-09-17", "11:00 AM", "America/Chicago", now)).toBe(true);
    expect(isPastEventStart("2026-09-18", "9:59 AM", "America/Chicago", now)).toBe(true);
    expect(isPastEventStart("2026-09-18", "10:00 AM", "America/Chicago", now)).toBe(false);
  });

  it("names the activity when a whole-plan date move would place it in the past", () => {
    const plan = { items: [{ task: "Clean the kitchen", startTime: "9:00 AM", durationMinutes: 30 }] } as Parameters<typeof pastPlanMoveIssue>[0];
    expect(pastPlanMoveIssue(plan, "2026-09-18", "America/Chicago", now)).toContain("Clean the kitchen");
    expect(pastPlanMoveIssue(plan, "2026-09-19", "America/Chicago", now)).toBeUndefined();
  });
  it("rechecks each draft activity when acceptance happens after its start", () => {
    const plan = { items: [
      { task: "Dinner", date: "2026-09-18", startTime: "9:59 AM", durationMinutes: 30 },
      { task: "Pickup", date: "2026-09-19", startTime: "11:00 AM", durationMinutes: 20 },
    ] } as HouseholdPlan;
    expect(newPlanTimeIssue(plan, "2026-09-18", "America/Chicago", now)).toContain("Dinner");
    expect(newPlanTimeIssue(plan, "2026-09-18", "America/Los_Angeles", now)).toBeUndefined();
  });

  it.each([
    ["2027-03-14", "2:30 AM", "does not exist"],
    ["2026-11-01", "1:30 AM", "occurs twice"],
  ])("rejects a whole-plan move to a daylight-saving discontinuity on %s", (date, startTime, issue) => {
    const plan = { items: [{ task: "Night shift handoff", startTime, durationMinutes: 30 }] } as Parameters<typeof pastPlanMoveIssue>[0];
    expect(pastPlanMoveIssue(plan, date, "America/Chicago", now)).toContain(issue);
    expect(pastPlanMoveIssue(plan, date, "America/Chicago", now)).toContain("Night shift handoff");
    expect(pastPlanMoveIssue(plan, date, "UTC", now)).toBeUndefined();
  });
  it.each([
    ["2027-03-14", "1:50 AM", 20],
    ["2026-11-01", "12:50 AM", 80],
  ])("rejects a date move crossing the clock change on %s", (date, startTime, durationMinutes) => {
    const plan = { items: [{ task: "Night shift handoff", startTime, durationMinutes }] } as Parameters<typeof pastPlanMoveIssue>[0];
    expect(pastPlanMoveIssue(plan, date, "America/Chicago", now)).toContain("crosses a daylight-saving change");
    expect(pastPlanMoveIssue(plan, date, "UTC", now)).toBeUndefined();
    expect(pastPlanMoveIssue(plan, "2026-10-01", "America/Chicago", now)).toBeUndefined();
  });
});

describe("suggestedPlanDate", () => {
  const thursday = new Date(2026, 8, 17, 12);

  it("aligns a Saturday scenario with the upcoming Saturday", () => {
    expect(suggestedPlanDate("Split Saturday chores fairly", thursday)).toBe("2026-09-19");
  });

  it("rolls forward across a month and treats next Saturday on Saturday as a week later", () => {
    expect(suggestedPlanDate("Plan Monday", new Date(2026, 8, 30, 12))).toBe("2026-10-05");
    expect(suggestedPlanDate("next Saturday", new Date(2026, 8, 19, 12))).toBe("2026-09-26");
  });

  it("does not guess from ambiguous or negated weekdays", () => {
    expect(suggestedPlanDate("Saturday or Sunday", thursday)).toBeUndefined();
    expect(suggestedPlanDate("not Saturday", thursday)).toBeUndefined();
    expect(suggestedPlanDate("last Saturday", thursday)).toBeUndefined();
  });
});

describe("whole-plan date revisions", () => {
  it("accepts a real ISO date or a weekday relative to the current plan", () => {
    expect(requestedPlanDate("Move the plan to 2026-09-20", "2026-09-19")).toBe("2026-09-20");
    expect(requestedPlanDate("Move the plan to September 20, 2026", "2026-09-19")).toBe("2026-09-20");
    expect(requestedPlanDate("Move the plan to 9/20/2026", "2026-09-19")).toBe("2026-09-20");
    expect(requestedPlanDate("Change the date to Sunday", "2026-09-19")).toBe("2026-09-20");
    expect(requestedPlanDate("Could you please move the calendar date to Sunday?", "2026-09-19")).toBe("2026-09-20");
    expect(requestedPlanDate("Reschedule our whole plan for next Saturday", "2026-09-19")).toBe("2026-09-26");
    expect(requestedPlanDate("Move the plan to January 2", "2026-09-19")).toBe("2027-01-02");
  });

  it("does not guess from an invalid, mixed, or event-specific request", () => {
    expect(isValidPlanDate("2026-02-30")).toBe(false);
    expect(requestedPlanDate("Move the plan to 2026-02-30", "2026-09-19")).toBeUndefined();
    expect(requestedPlanDate("Move dinner to Sunday", "2026-09-19")).toBeUndefined();
    expect(requestedPlanDate("Move the plan to Sunday and give vacuum to Sam", "2026-09-19")).toBeUndefined();
    expect(asksToMoveDate("Move dinner to Sunday")).toBe(true);
    expect(asksToMoveWholePlanDate("Move dinner to Sunday")).toBe(false);
    expect(asksToMoveWholePlanDate("Move the whole plan to Sunday")).toBe(true);
  });

  it("sorts actual event dates while retaining a fallback for saved undated events", () => {
    const plan = { items: [{ date: "2026-10-13" }, { date: "2026-09-22" }, {}] } as Parameters<typeof planDates>[0];
    expect(planDates(plan, "2026-09-20")).toEqual(["2026-09-20", "2026-09-22", "2026-10-13"]);
  });
});


describe("elapsed review decisions", () => {
  const plan: HouseholdPlan = { title: "Morning", objective: "Tidy", participants: ["Alex"], items: [{ id: "one", taskId: "tidy", task: "Tidy", date: "2026-09-18", startTime: "9:00 AM", durationMinutes: 30, assignee: "Alex" }], notes: [], version: 1, updatedAt: "2026-09-18T12:00:00Z" };
  const now = new Date("2026-09-18T15:00:00Z");
  it("permits unchanged past activities but protects their actual schedule", () => {
    expect(revisionTimeIssue(plan, { ...plan, title: "Better title" }, "2026-09-18", "America/Chicago", now)).toBeUndefined();
    const changed = { ...plan, items: [{ ...plan.items[0], startTime: "11:00 AM" }] };
    expect(revisionTimeIssue(plan, changed, "2026-09-18", "America/Chicago", now)).toContain("already started");
  });
  it("rejects a proposal whose new time elapsed while the user reviewed it", () => {
    const future = { ...plan, items: [{ ...plan.items[0], startTime: "11:00 AM" }] };
    expect(revisionTimeIssue(future, plan, "2026-09-18", "America/Chicago", now)).toContain("now in the past");
  });
  it.each([
    ["2027-03-14", "2:30 AM", "does not exist"],
    ["2026-11-01", "1:30 AM", "occurs twice"],
  ])("rechecks daylight-saving validity when applying or undoing a date revision on %s", (date, startTime, issue) => {
    const current = { ...plan, items: [{ ...plan.items[0], date: "2026-10-01", startTime }] };
    const proposal = { ...current, items: [{ ...current.items[0], date }] };
    expect(revisionTimeIssue(current, proposal, date, "America/Chicago", now)).toContain(issue);
    expect(revisionTimeIssue(current, proposal, date, "UTC", now)).toBeUndefined();
  });
  it.each([
    ["2027-03-14", "1:50 AM", 20],
    ["2026-11-01", "12:50 AM", 80],
  ])("rejects applying a duration that crosses the clock change on %s", (date, startTime, durationMinutes) => {
    const current = { ...plan, items: [{ ...plan.items[0], date, startTime, durationMinutes: 5 }] };
    const proposal = { ...current, items: [{ ...current.items[0], durationMinutes }] };
    expect(revisionTimeIssue(current, proposal, date, "America/Chicago", now)).toContain("crosses a daylight-saving change");
    expect(revisionTimeIssue(current, proposal, date, "UTC", now)).toBeUndefined();
    expect(revisionTimeIssue(proposal, current, date, "America/Chicago", now)).toBeUndefined();
  });
});


it("interprets a named weekday using the selected time zone near midnight", () => {
  const now = new Date("2026-09-19T01:00:00Z");
  expect(suggestedPlanDate("Plan Friday chores", now, "America/Chicago")).toBe("2026-09-18");
  expect(suggestedPlanDate("Plan Friday chores", now, "Pacific/Auckland")).toBe("2026-09-25");
});
