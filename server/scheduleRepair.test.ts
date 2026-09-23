// @vitest-environment node
import { describe, expect, it, vi } from "vitest";
import type { ChatRequest, PlanDraft, PlanRequirements } from "../shared/contracts";
import { scenarioRequirements } from "../shared/scenarios";
import { createChatService } from "./chatService";
import { repairScheduleTiming } from "./scheduleRepair";
import { scheduleIssues } from "./scheduleValidation";
import { pastScheduleIssues } from "./pastSchedule";

const now = new Date("2026-09-18T17:00:00Z");
const request: ChatRequest = { message: "Plan our work", history: [], planDate: "2026-09-21", timeZone: "America/Chicago" };
function example(): { draft: PlanDraft; rules: PlanRequirements } {
  const rules: PlanRequirements = {
    source: "interpreted", timeWindow: { startTime: "9:00 AM", endTime: "11:00 AM" },
    tasks: [
      { id: "a", label: "First job", date: "2026-09-21", durationMinutes: 30, requiredParticipants: ["Ada"] },
      { id: "b", label: "Second job", date: "2026-09-21", durationMinutes: 25, requiredParticipants: ["Ben"] },
      { id: "review", label: "Review", date: "2026-09-21", durationMinutes: 15, requiredParticipants: ["Ada", "Ben"] },
    ],
    ordering: [{ beforeTaskId: "a", afterTaskId: "review" }, { beforeTaskId: "b", afterTaskId: "review" }],
    gaps: [{ afterTaskId: "a", beforeTaskId: "review", minMinutes: 10 }],
  };
  return { rules, draft: { title: "Morning", objective: "Finish together", participants: ["Ada", "Ben"], notes: [], requirements: rules, items: rules.tasks.map((task) => ({ taskId: task.id, task: task.label, date: task.date, startTime: "9:00 AM", durationMinutes: task.durationMinutes, assignee: task.requiredParticipants!.join(", ") })) } };
}
const withoutTime = (draft: PlanDraft) => ({ ...draft, items: draft.items.map(({ startTime, ...item }) => { void startTime; return item; }) });
function valid(result: PlanDraft, rules: PlanRequirements, context = request, instant = now) {
  expect(scheduleIssues(result, context, rules)).toEqual([]);
  expect(pastScheduleIssues(result, context, instant)).toEqual([]);
}

describe("bounded timing-only repair", () => {
  it("repairs parallel work plus a shared review and buffer without changing non-time data", () => {
    const { draft, rules } = example();
    const snapshot = structuredClone(draft);
    const result = repairScheduleTiming(draft, request, rules, now);
    valid(result, rules);
    expect(result.items.map((item) => item.startTime)).toEqual(["9:00 AM", "9:00 AM", "9:40 AM"]);
    expect(withoutTime(result)).toEqual(withoutTime(draft));
    expect(draft).toEqual(snapshot);
  });

  it("repairs a dense twenty-task multi-day schedule with availability and one shared resource", () => {
    const dates = ["2026-09-21", "2026-10-01"];
    const rules: PlanRequirements = {
      source: "interpreted", timeWindow: { startTime: "9:00 AM", endTime: "noon" },
      availability: [{ participant: "Ada", startTime: "9:00 AM", endTime: "10:00 AM" }, { participant: "Ben", startTime: "9:30 AM", endTime: "11:00 AM" }],
      resources: [{ id: "station", label: "Station", capacity: 1 }],
      tasks: Array.from({ length: 20 }, (_, index) => ({ id: `job-${index}`, label: `Job ${index}`, date: dates[Math.floor(index / 10)], durationMinutes: 12, requiredParticipants: [index % 2 ? "Ben" : "Ada"], resources: [{ resourceId: "station", units: 1 }] })),
    };
    rules.timeWindow.endTime = "12:00 PM";
    const draft: PlanDraft = { title: "Two workdays", objective: "Use one station", participants: ["Ada", "Ben"], notes: [], requirements: rules, items: rules.tasks.map((task) => ({ taskId: task.id, date: task.date, task: task.label, durationMinutes: task.durationMinutes, assignee: task.requiredParticipants![0], startTime: "9:30 AM" })) };
    const result = repairScheduleTiming(draft, request, rules, now);
    expect(result).not.toBe(draft);
    valid(result, rules);
    expect(withoutTime(result)).toEqual(withoutTime(draft));
  });

  it("honors aggregate resource capacity across three distinct participants", () => {
    const rules: PlanRequirements = { source: "interpreted", timeWindow: { startTime: "9:00 AM", endTime: "10:00 AM" }, resources: [{ id: "oven", label: "Oven", capacity: 2 }], tasks: ["Ada", "Ben", "Kit"].map((person) => ({ id: person.toLowerCase(), label: person, date: "2026-09-21", durationMinutes: 20, requiredParticipants: [person], resources: [{ resourceId: "oven", units: 1 }] })) };
    const draft: PlanDraft = { title: "Cooking", objective: "Use oven slots", participants: ["Ada", "Ben", "Kit"], notes: [], requirements: rules, items: rules.tasks.map((task) => ({ taskId: task.id, date: task.date, task: task.label, durationMinutes: 20, startTime: "9:00 AM", assignee: task.label })) };
    const result = repairScheduleTiming(draft, request, rules, now);
    valid(result, rules);
    expect(result.items.map((item) => item.startTime)).toEqual(["9:00 AM", "9:00 AM", "9:20 AM"]);
  });

  it("never moves fixed commitments, even when their overlap is impossible", () => {
    const { draft, rules } = example();
    rules.tasks[0].fixedStartTime = "9:00 AM";
    rules.tasks[2].fixedStartTime = "9:10 AM";
    const snapshot = structuredClone(draft);
    expect(repairScheduleTiming(draft, request, rules, now)).toBe(draft);
    expect(draft).toEqual(snapshot);
  });

  it("returns the original on bounded search exhaustion or insufficient time", () => {
    const { draft, rules } = example();
    expect(repairScheduleTiming(draft, request, rules, now, { maxAttempts: 0 })).toBe(draft);
    expect(repairScheduleTiming(draft, request, rules, now, { maxMilliseconds: 0 })).toBe(draft);
    rules.timeWindow.endTime = "9:30 AM";
    expect(repairScheduleTiming(draft, request, rules, now, { maxAttempts: 200 })).toBe(draft);
  });

  it("respects today's fresh lower bound and never changes a past date", () => {
    const { draft, rules } = example();
    rules.timeWindow.endTime = "5:00 PM";
    rules.tasks = rules.tasks.map((task) => ({ ...task, date: "2026-09-18" }));
    draft.items = draft.items.map((item) => ({ ...item, date: "2026-09-18" }));
    const result = repairScheduleTiming(draft, { ...request, planDate: "2026-09-18" }, rules, now);
    valid(result, rules, { ...request, planDate: "2026-09-18" });
    expect(result.items[0].startTime).toBe("12:00 PM");
    rules.tasks[0].date = "2026-09-17"; draft.items[0].date = "2026-09-17";
    expect(repairScheduleTiming(draft, request, rules, now)).toBe(draft);
  });

  it("refuses revisions, dropped tasks, duration changes, and ineligible assignees", () => {
    for (const variant of ["revision", "missing", "duration", "assignee"] as const) {
      const { draft, rules } = example();
      const context = variant === "revision" ? { ...request, currentPlan: { ...draft, items: draft.items.map((item) => ({ ...item, id: item.taskId! })), version: 1, updatedAt: now.toISOString() } } : request;
      if (variant === "missing") draft.items.pop();
      if (variant === "duration") draft.items[0].durationMinutes = 5;
      if (variant === "assignee") draft.items[0].assignee = "Ben";
      expect(repairScheduleTiming(draft, context, rules, now)).toBe(draft);
    }
  });

  it("repairs a complete multi-day example without spending a model repair call", async () => {
    const requirements = scenarioRequirements("weekday", "2026-09-18")!;
    const participants = ["Maya", "Leo", "Jordan", "Casey"];
    const draft: PlanDraft = { title: "School week", objective: "Finish school activities", participants, notes: [], requirements, items: requirements.tasks.map((task) => ({ taskId: task.id, date: task.date, task: task.label, durationMinutes: task.durationMinutes, startTime: task.fixedStartTime ?? "6:00 PM", assignee: task.id.startsWith("math-") ? "Maya, Casey" : task.requiredParticipants!.join(", ") })) };
    const converse = vi.fn(async () => ({ output: { message: { role: "assistant" as const, content: [{ toolUse: { toolUseId: "plan", name: "publish_household_plan", input: draft } }] } }, stopReason: "tool_use" }));
    const context: ChatRequest = { ...request, scenarioId: "weekday", planDate: "2026-09-18" };
    const response = await createChatService({ gateway: { modelId: "test", converse }, now: () => now, logger: vi.fn() })(context);
    valid(response.plan!, requirements, context);
    expect(response.plan?.items.find((item) => item.taskId === "jordan-call")?.startTime).toBe("6:30 PM");
    expect(converse).toHaveBeenCalledOnce();
    expect(withoutTime({ ...draft, items: response.plan!.items.map(({ id, details, ...item }) => { void id; void details; return item; }) })).toEqual(withoutTime(draft));
  });
});
