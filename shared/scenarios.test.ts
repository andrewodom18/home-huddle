import { describe, expect, it } from "vitest";
import { SCENARIO_REQUIREMENTS, scenarioDates, scenarioRequirements } from "./scenarios";

describe("rolling scenario dates", () => {
  it("keeps the legacy examples unchanged without an anchor", () => {
    expect(scenarioRequirements("weekday")).toEqual(SCENARIO_REQUIREMENTS.weekday);
    expect(scenarioRequirements("chores")).toEqual(SCENARIO_REQUIREMENTS.chores);
  });

  it("uses the next full Monday–Friday and a future Saturday", () => {
    const dates = scenarioDates("2026-09-21"); // Monday is not a complete future week.
    expect(dates.weekday).toEqual(["2026-09-28", "2026-09-29", "2026-09-30", "2026-10-01", "2026-10-02"]);
    expect(dates.chores).toBe("2026-09-26");
    const weekday = scenarioRequirements("weekday", "2026-09-21")!;
    expect(weekday.tasks.find((task) => task.id === "jordan-call")).toMatchObject({ date: "2026-09-28", fixedDate: true });
    expect(weekday.tasks.map((task) => task.id)).toEqual(SCENARIO_REQUIREMENTS.weekday.tasks.map((task) => task.id));
    expect(new Set(weekday.tasks.filter((task) => task.id.startsWith("dinner-")).map((task) => task.date))).toEqual(new Set(dates.weekday));
    expect(scenarioRequirements("chores", "2026-09-21")!.tasks.every((task) => task.date === dates.chores)).toBe(true);
  });

  it("keeps the outings nonconsecutive and puts the third in a later month, including across years", () => {
    const dates = scenarioDates("2026-12-31");
    expect(dates).toEqual({
      weekday: ["2027-01-04", "2027-01-05", "2027-01-06", "2027-01-07", "2027-01-08"],
      chores: "2027-01-02",
      outing: ["2027-01-05", "2027-01-07", "2027-02-13"],
    });
    const outing = scenarioRequirements("outing", "2026-12-31")!;
    expect(outing.tasks.find((task) => task.id === "garden")?.date).toBe(dates.outing[0]);
    expect(outing.tasks.find((task) => task.id === "library")?.date).toBe(dates.outing[1]);
    expect(outing.tasks.find((task) => task.id === "garden-rest")).toMatchObject({ date: dates.outing[0], kind: "break", requiredParticipants: ["Grandma Jo"] });
    expect(outing.tasks.find((task) => task.id === "library-rest")).toMatchObject({ date: dates.outing[1], kind: "break", requiredParticipants: ["Grandma Jo"] });
    expect(outing.tasks.find((task) => task.id === "picnic")?.date).toBe(dates.outing[2]);
    expect(outing.tasks.map((task) => task.id)).toEqual(SCENARIO_REQUIREMENTS.outing.tasks.map((task) => task.id));
  });

  it("ties seated rests to the garden walk and library, not lunch", () => {
    const outing = SCENARIO_REQUIREMENTS.outing;
    expect(outing.ordering).toContainEqual({ beforeTaskId: "garden", afterTaskId: "garden-rest" });
    expect(outing.ordering).toContainEqual({ beforeTaskId: "garden-rest", afterTaskId: "garden-finish" });
    expect(outing.tasks.filter((task) => task.id.startsWith("garden") && task.kind !== "break").map((task) => task.durationMinutes)).toEqual([35, 40]);
    expect(outing.ordering).toContainEqual({ beforeTaskId: "library", afterTaskId: "library-rest" });
    expect(outing.tasks.filter((task) => task.kind === "break").map((task) => task.label)).toEqual([
      "Seated rest during garden visit", "Seated rest after library visit",
    ]);
  });

  it("rejects impossible anchors", () => {
    expect(() => scenarioDates("2026-02-30")).toThrow("valid YYYY-MM-DD");
  });
});
