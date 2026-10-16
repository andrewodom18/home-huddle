// @vitest-environment node
import { describe, expect, it, vi } from "vitest";
import { chatResponseSchema, type ChatRequest, type HouseholdPlan } from "../shared/contracts";
import { scenarioRequirements } from "../shared/scenarios";
import { createChatService } from "./chatService";
import type { BedrockGateway, BedrockResponse } from "./bedrock";
import { minutes, scheduleIssues } from "./scheduleValidation";
import { pastScheduleIssues } from "./pastSchedule";

const instant = new Date("2030-01-04T18:00:00Z");
const anchor = "2030-01-04";
const liveMessage = "Add a 10-minute transition buffer after Sort and start laundry and before Shared break. Preserve the accepted 30-minute kitchen duration and all other requirements.";

function chores(): HouseholdPlan {
  const requirements = scenarioRequirements("chores", anchor)!;
  requirements.source = "interpreted";
  requirements.tasks = requirements.tasks.map((task) => task.id === "kitchen" ? { ...task, durationMinutes: 30 } : task);
  const start: Record<string, string> = {
    kitchen: "9:00 AM", vacuum: "9:00 AM", "start-laundry": "9:10 AM",
    "shared-break": "9:30 AM", "fold-laundry": "9:45 AM",
  };
  const assignee: Record<string, string> = {
    kitchen: "Alex", vacuum: "Sam", "start-laundry": "Riley",
    "shared-break": "Alex, Sam, Riley", "fold-laundry": "Riley",
  };
  return {
    title: "Fictional Saturday chores", objective: "Share chores fairly and take a shared break.",
    scenarioId: "chores", scenarioAnchor: anchor, scenarioEdits: { kitchen: { durationMinutes: 30 } },
    participants: ["Alex", "Sam", "Riley"], requirements, notes: [], version: 2,
    updatedAt: "2030-01-04T17:00:00.000Z",
    items: requirements.tasks.map((task) => ({
      id: `task-${task.id}`, taskId: task.id, task: task.label, date: task.date,
      durationMinutes: task.durationMinutes, startTime: start[task.id], assignee: assignee[task.id],
      details: `Saved details for ${task.id}`,
    })),
  };
}

function request(plan: HouseholdPlan, message = liveMessage): ChatRequest {
  return { message, history: [], currentPlan: plan, scenarioId: plan.scenarioId, planDate: anchor, timeZone: "America/Chicago" };
}

function service(outcome?: "clarification" | "conflict", now = instant) {
  const converse = vi.fn<BedrockGateway["converse"]>(async (): Promise<BedrockResponse> => {
    if (!outcome) throw new Error("A recognized feasible gap must not need a model call");
    return {
      stopReason: "tool_use",
      output: { message: { role: "assistant", content: [{ toolUse: {
        toolUseId: "outcome", name: "explain_planning_outcome",
        input: { outcome, message: outcome === "clarification" ? "Which activity or change should I use?" : "The fixed commitments cannot accommodate that gap." },
      } }] } },
    };
  });
  return {
    chat: createChatService({ gateway: { modelId: "offline-gap-test", converse }, now: () => now, logger: vi.fn() }),
    converse,
  };
}

function verifyPreservation(next: HouseholdPlan, previous: HouseholdPlan, context: ChatRequest) {
  expect(scheduleIssues(next, context, next.requirements)).toEqual([]);
  expect(pastScheduleIssues(next, context, instant)).toEqual([]);
  expect(next.title).toBe(previous.title);
  expect(next.objective).toBe(previous.objective);
  expect(next.participants).toEqual(previous.participants);
  expect(next.scenarioId).toBe(previous.scenarioId);
  expect(next.scenarioAnchor).toBe(previous.scenarioAnchor);
  expect(next.scenarioEdits).toEqual(previous.scenarioEdits);
  expect(next.requirements?.tasks).toEqual(previous.requirements?.tasks);
  for (const field of ["timeWindow", "timeWindows", "availability", "resources", "ordering", "workload", "preferences", "assumptions"] as const) {
    expect(next.requirements?.[field]).toEqual(previous.requirements?.[field]);
  }
  for (const gap of previous.requirements?.gaps ?? []) expect(next.requirements?.gaps).toContainEqual(gap);
  const withoutStart = (plan: HouseholdPlan) => plan.items.map(({ startTime, ...item }) => {
    void startTime;
    return item;
  }).sort((a, b) => a.taskId!.localeCompare(b.taskId!));
  expect(withoutStart(next)).toEqual(withoutStart(previous));
  expect(next.version).toBe(previous.version + 1);
  expect(next.requirements?.gaps).toContainEqual({ afterTaskId: "start-laundry", beforeTaskId: "shared-break", minMinutes: 10 });
  const laundry = next.items.find((item) => item.taskId === "start-laundry")!;
  const sharedBreak = next.items.find((item) => item.taskId === "shared-break")!;
  expect(minutes(sharedBreak.startTime)! - minutes(laundry.startTime)! - laundry.durationMinutes).toBeGreaterThanOrEqual(10);
}

describe("checked named-gap revisions", () => {
  it("never weakens an accepted larger buffer or retimes an already valid schedule", async () => {
    const currentPlan = chores();
    currentPlan.requirements!.gaps = [{ afterTaskId: "start-laundry", beforeTaskId: "shared-break", minMinutes: 30 }];
    currentPlan.items.find((item) => item.taskId === "start-laundry")!.startTime = "9:00 AM";
    currentPlan.items.find((item) => item.taskId === "shared-break")!.startTime = "9:50 AM";
    currentPlan.items.find((item) => item.taskId === "fold-laundry")!.startTime = "10:05 AM";
    const { chat, converse } = service();
    const result = await chat(request(currentPlan));
    expect(result.outcome).toBe("plan");
    expect(result.plan?.requirements?.gaps).toEqual(currentPlan.requirements!.gaps);
    expect(result.plan?.items).toEqual(currentPlan.items);
    expect(result.meta.callCount).toBe(0);
    expect(converse).not.toHaveBeenCalled();
  });

  it("checks the named relationship even when the two activities have different assignees", async () => {
    const currentPlan: HouseholdPlan = {
      title: "Separate activities", objective: "Leave a buffer", participants: ["Ada", "Ben"], notes: [],
      version: 1, updatedAt: instant.toISOString(),
      requirements: { source: "interpreted", timeWindow: { startTime: "9:00 AM", endTime: "11:00 AM" }, tasks: [
        { id: "setup", label: "Setup", durationMinutes: 20, requiredParticipants: ["Ada"] },
        { id: "review", label: "Review", durationMinutes: 20, requiredParticipants: ["Ben"] },
      ] },
      items: [
        { id: "task-setup", taskId: "setup", task: "Setup", date: "2030-01-05", startTime: "9:00 AM", durationMinutes: 20, assignee: "Ada" },
        { id: "task-review", taskId: "review", task: "Review", date: "2030-01-05", startTime: "9:20 AM", durationMinutes: 20, assignee: "Ben" },
      ],
    };
    const context = request(currentPlan, "Add a 10-minute transition buffer after Setup and before Review.");
    const { chat, converse } = service();
    const result = await chat(context);
    expect(result.outcome).toBe("plan");
    expect(scheduleIssues(result.plan!, context)).toEqual([]);
    expect(result.plan?.requirements?.gaps).toEqual([{ afterTaskId: "setup", beforeTaskId: "review", minMinutes: 10 }]);
    expect(converse).not.toHaveBeenCalled();
  });

  it("handles the live request locally while preserving an accepted kitchen duration", async () => {
    const currentPlan = chores();
    const snapshot = structuredClone(currentPlan);
    const context = request(currentPlan);
    expect(scheduleIssues(currentPlan, { ...context, message: "Review the current plan" })).toEqual([]);
    const { chat, converse } = service();

    const result = await chat(context);

    expect(chatResponseSchema.safeParse(result).success).toBe(true);
    expect(result.outcome).toBe("plan");
    expect(result.plan).toBeDefined();
    verifyPreservation(result.plan!, snapshot, context);
    expect(result.meta.callCount).toBe(0);
    expect(converse).not.toHaveBeenCalled();
    expect(currentPlan).toEqual(snapshot);
  });

  it("retains an unrelated existing gap and all accepted requirements", async () => {
    const currentPlan = chores();
    currentPlan.requirements!.gaps = [{ afterTaskId: "vacuum", beforeTaskId: "fold-laundry", minMinutes: 5 }];
    const snapshot = structuredClone(currentPlan);
    const context = request(currentPlan);
    const { chat, converse } = service();

    const result = await chat(context);

    expect(result.outcome).toBe("plan");
    verifyPreservation(result.plan!, snapshot, context);
    expect(result.meta.callCount).toBe(0);
    expect(converse).not.toHaveBeenCalled();
    expect(currentPlan).toEqual(snapshot);
  });

  it("never publishes a gap by moving fixed custom commitments", async () => {
    const currentPlan = chores();
    delete currentPlan.scenarioId;
    delete currentPlan.scenarioAnchor;
    delete currentPlan.scenarioEdits;
    currentPlan.requirements!.tasks = currentPlan.requirements!.tasks.map((task) => ({
      ...task,
      ...(task.id === "start-laundry" ? { fixedStartTime: "9:10 AM" } : {}),
      ...(task.id === "shared-break" ? { fixedStartTime: "9:30 AM" } : {}),
    }));
    const snapshot = structuredClone(currentPlan);
    const context = request(currentPlan);
    expect(scheduleIssues(currentPlan, { ...context, message: "Review the current plan" })).toEqual([]);
    const { chat } = service("conflict");

    const result = await chat(context);

    expect(result.outcome).not.toBe("plan");
    expect(result.plan).toBeUndefined();
    expect(currentPlan).toEqual(snapshot);
  });

  it("never changes already-started activities to create a requested gap", async () => {
    const currentPlan = chores();
    const snapshot = structuredClone(currentPlan);
    const { chat } = service("conflict", new Date("2030-01-05T15:35:00Z"));

    const result = await chat(request(currentPlan));

    expect(result.outcome).not.toBe("plan");
    expect(result.plan).toBeUndefined();
    expect(currentPlan).toEqual(snapshot);
  });

  it("does not guess which repeated activity label a gap refers to", async () => {
    const currentPlan = chores();
    delete currentPlan.scenarioId;
    delete currentPlan.scenarioAnchor;
    delete currentPlan.scenarioEdits;
    currentPlan.requirements!.tasks = currentPlan.requirements!.tasks.map((task) => task.id.endsWith("laundry") ? { ...task, label: "Laundry" } : task);
    currentPlan.items = currentPlan.items.map((item) => item.taskId!.endsWith("laundry") ? { ...item, task: "Laundry" } : item);
    const snapshot = structuredClone(currentPlan);
    const { chat } = service("clarification");

    const result = await chat(request(currentPlan, "Add a 10-minute transition buffer after Laundry and before Shared break."));

    expect(result.outcome).toBe("clarification");
    expect(result.plan).toBeUndefined();
    expect(currentPlan).toEqual(snapshot);
  });

  it.each([
    "Add a 10-minute transition buffer after laundry and before Shared break.",
    `${liveMessage} Also make Vacuum the floors 40 minutes.`,
    `${liveMessage} Also assign Clean the kitchen to Sam.`,
    "Add a 10-minute transition buffer after Sort and start laundry and before Shared break. Preserve the accepted 45-minute kitchen duration and all other requirements.",
    "Add a 10-minute transition buffer after Sort and start laundry and before Shared break. Preserve other requirements except change Vacuum the floors to 40 minutes.",
  ])("does not silently apply a partial or ambiguous request: %s", async (message) => {
    const currentPlan = chores();
    const snapshot = structuredClone(currentPlan);
    const { chat } = service("clarification");

    const result = await chat(request(currentPlan, message));

    expect(result.outcome).toBe("clarification");
    expect(result.plan).toBeUndefined();
    expect(currentPlan).toEqual(snapshot);
  });
});
