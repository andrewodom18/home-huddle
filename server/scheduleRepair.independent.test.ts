// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ChatRequest, PlanDraft, PlanRequirements } from "../shared/contracts";
import { repairScheduleTiming } from "./scheduleRepair";

/** Tiny scheduling problems expressed independently of the production contracts.
 * The oracle enumerates all minute assignments, then checks occupancy directly.
 * It deliberately does not call scheduleIssues, minutes, or the repair's helpers. */
type Problem = {
  index: number;
  durations: number[];
  people: string[];
  capacity: number;
  fixedThird?: number;
  firstBeforeThird: boolean;
};

function problems(): Problem[] {
  let seed = 731;
  const random = (limit: number) => {
    seed = (Math.imul(seed, 1_664_525) + 1_013_904_223) >>> 0;
    return seed % limit;
  };
  return Array.from({ length: 60 }, (_, index) => ({
    index,
    durations: Array.from({ length: 3 }, () => 1 + random(3)),
    people: ["Alex", "Alex", "Sam"],
    fixedThird: index % 3 === 0 ? 2 + random(4) : undefined,
    capacity: 1 + random(2),
    firstBeforeThird: index % 4 === 0,
  }));
}

function feasibleStarts(problem: Problem, starts: number[]): boolean {
  if (starts.length !== 3 || starts.some((start, index) =>
    !Number.isInteger(start) || start < 0 || start + problem.durations[index] > 8,
  )) return false;
  if (problem.fixedThird !== undefined && starts[2] !== problem.fixedThird) return false;
  if (problem.firstBeforeThird && starts[0] + problem.durations[0] > starts[2]) return false;

  // All intervals have integral boundaries, so each minute's occupancy is a
  // complete oracle for person conflicts and aggregate resource capacity.
  for (let minute = 0; minute < 8; minute += 1) {
    const active = starts.flatMap((start, index) =>
      start <= minute && minute < start + problem.durations[index] ? [index] : [],
    );
    if (active.length > problem.capacity) return false;
    const occupants = active.map((index) => problem.people[index]);
    if (new Set(occupants).size !== occupants.length) return false;
  }
  return true;
}

function bruteForce(problem: Problem): number[] | undefined {
  for (let first = 0; first < 8; first += 1) {
    for (let second = 0; second < 8; second += 1) {
      for (let third = 0; third < 8; third += 1) {
        const starts = [first, second, third];
        if (feasibleStarts(problem, starts)) return starts;
      }
    }
  }
  return undefined;
}

const date = "2026-09-21";
const now = new Date("2026-09-18T14:00:00Z");
const request: ChatRequest = {
  message: "Plan three short activities", history: [], planDate: date, timeZone: "America/Chicago",
};
const clock = (minute: number) => `9:${String(minute).padStart(2, "0")} AM`;

function fixture(problem: Problem): { draft: PlanDraft; rules: PlanRequirements } {
  const rules: PlanRequirements = {
    source: "interpreted",
    timeWindow: { startTime: clock(0), endTime: clock(8) },
    resources: [{ id: "room", label: "Room", capacity: problem.capacity }],
    tasks: problem.durations.map((durationMinutes, index) => ({
      id: `task${index}`, label: `Task ${index}`, durationMinutes,
      requiredParticipants: [problem.people[index]],
      resources: [{ resourceId: "room", units: 1 }],
      ...(index === 2 && problem.fixedThird !== undefined
        ? { fixedStartTime: clock(problem.fixedThird) } : {}),
    })),
    ...(problem.firstBeforeThird
      ? { ordering: [{ beforeTaskId: "task0", afterTaskId: "task2" }] } : {}),
  };
  const draft: PlanDraft = {
    title: "Independent feasibility fixture", objective: "Complete all three tasks",
    participants: ["Alex", "Sam"], notes: [], requirements: rules,
    items: rules.tasks.map((task, index) => ({
      taskId: task.id, task: task.label, date, durationMinutes: task.durationMinutes,
      assignee: problem.people[index], startTime: clock(0),
    })),
  };
  return { draft, rules };
}

function withoutStartTimes(plan: PlanDraft) {
  return { ...plan, items: plan.items.map(({ startTime, ...item }) => {
    void startTime;
    return item;
  }) };
}

const corpus = problems();

describe("timing repair against an independent exhaustive oracle", () => {
  beforeEach(() => {
    // Exercise a deterministic operation budget regardless of CI host speed.
    // The production attempt cap remains active; zero-time budgets still expire.
    vi.spyOn(performance, "now").mockReturnValue(0);
  });
  afterEach(() => { vi.restoreAllMocks(); });

  it("contains both feasible and impossible cases in the fixed-seed corpus", () => {
    const feasible = corpus.filter((problem) => bruteForce(problem) !== undefined).length;
    expect(feasible).toBe(57);
    expect(corpus.length - feasible).toBe(3);
  });

  it.each(corpus)("matches exhaustive feasibility for seed case $index", (problem) => {
    const { draft, rules } = fixture(problem);
    const original = structuredClone(draft);
    const expectedFeasible = bruteForce(problem) !== undefined;
    const result = repairScheduleTiming(draft, request, rules, now, { maxAttempts: 20_000 });
    const starts = result.items.map((item) => {
      const match = /^9:(\d{2}) AM$/.exec(item.startTime);
      return match ? Number(match[1]) : NaN;
    });

    expect(feasibleStarts(problem, starts)).toBe(expectedFeasible);
    expect(withoutStartTimes(result)).toEqual(withoutStartTimes(original));
    expect(draft).toEqual(original);
    if (!expectedFeasible) expect(result).toBe(draft);
  });

  it.each([{ maxAttempts: 0 }, { maxMilliseconds: 0 }])(
    "returns the untouched draft when the explicit budget is exhausted: %j", (budget) => {
      const { draft, rules } = fixture(corpus[0]);
      const original = structuredClone(draft);
      expect(repairScheduleTiming(draft, request, rules, now, budget)).toBe(draft);
      expect(draft).toEqual(original);
    },
  );
});
