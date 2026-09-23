import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import type { HouseholdPlan } from "../shared/contracts";
import { DayGrid } from "./DayGrid";
import { getParticipantColors, SHARED_COLOR } from "./participantColors";

const plan: HouseholdPlan = {
  title: "Saturday chores",
  objective: "Share the work",
  participants: ["Alex", "Sam"],
  items: [
    { id: "kitchen", task: "Kitchen", assignee: "Alex", startTime: "9:00 AM", durationMinutes: 30 },
    { id: "vacuum", task: "Vacuum", assignee: "Sam", startTime: "9:00 AM", durationMinutes: 30 },
    { id: "break", task: "Break", assignee: "Alex and Sam", startTime: "9:30 AM", durationMinutes: 15 },
  ],
  notes: [],
  version: 1,
  updatedAt: "2026-09-17T12:00:00.000Z",
};

describe("calendar event colors", () => {
  it("matches single-person event colors to the participant map and treats shared events distinctly", () => {
    render(<DayGrid plan={plan} />);
    const colors = getParticipantColors(plan.participants);
    const kitchen = screen.getByRole("button", { name: /Open details for Kitchen/ });
    const vacuum = screen.getByRole("button", { name: /Open details for Vacuum/ });
    const breaks = screen.getAllByRole("button", { name: /Open details for Break/ });

    expect(kitchen.style.getPropertyValue("--person-accent")).toBe(colors.get("Alex")?.accent);
    expect(vacuum.style.getPropertyValue("--person-accent")).toBe(colors.get("Sam")?.accent);
    expect(kitchen.style.getPropertyValue("--person-accent")).not.toBe(vacuum.style.getPropertyValue("--person-accent"));
    expect(breaks).toHaveLength(2);
    for (const shared of breaks) {
      expect(shared).toHaveClass("day-grid__event--shared");
      expect(shared.style.getPropertyValue("--person-accent")).toBe(SHARED_COLOR.accent);
      expect(shared).toHaveTextContent("Shared · 9:30 AM");
      expect(shared).toHaveAccessibleName(/assigned to Alex and Sam/);
    }
  });

  it("shows every activity once in a shared timeline and places concurrent work side by side", () => {
    render(<DayGrid plan={plan} view="shared" />);
    const calendar = screen.getByRole("group", { name: "Shared calendar day view" });
    expect(calendar).toHaveTextContent("All activities");
    const kitchen = screen.getByRole("button", { name: /Open details for Kitchen/ });
    const vacuum = screen.getByRole("button", { name: /Open details for Vacuum/ });
    expect(screen.getAllByRole("button", { name: /Open details for Break/ })).toHaveLength(1);
    expect(kitchen).toHaveTextContent("Alex · 9:00 AM");
    expect(vacuum).toHaveTextContent("Sam · 9:00 AM");
    expect(kitchen.style.left).not.toBe(vacuum.style.left);
    expect(kitchen.style.width).toBe(vacuum.style.width);
  });
});
