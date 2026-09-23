// @vitest-environment node
import { describe, expect, it, vi } from "vitest";
import { chatResponseSchema, type ChatRequest, type HouseholdPlan, type PlanDraft, type PlanRequirements } from "../shared/contracts";
import { createChatService } from "./chatService";
import type { BedrockGateway, BedrockResponse } from "./bedrock";
import { requirementsIssues, applyRequirementChanges, fixedCommitmentConflict, naturalChangeIssues, explicitAvailabilityChanges } from "./requirements";
import { scheduleIssues } from "./scheduleValidation";
import { pastScheduleIssues } from "./pastSchedule";
import { shortenSchedule } from "./scheduleOptimization";

const instant = new Date("2026-09-18T17:00:00Z"); // noon Chicago
const request: ChatRequest = { message: "Plan meals for Alex and Sam", history: [], planDate: "2026-09-19", timeZone: "America/Chicago" };
const requirements: PlanRequirements = {
  source: "interpreted", timeWindow: { startTime: "9:00 AM", endTime: "5:00 PM" },
  assumptions: ["Each preparation task is estimated at 30 minutes."],
  tasks: [{ id: "meal_prep", label: "Meal prep", durationMinutes: 30, requiredParticipants: ["Alex"] }, { id: "dishes", label: "Dishes", durationMinutes: 30, requiredParticipants: ["Sam"] }],
};
const draft: PlanDraft = {
  title: "Meals", objective: "Prepare food", participants: ["Alex", "Sam"], notes: [], requirements,
  items: [{ taskId: "meal_prep", date: "2026-09-19", task: "Meal prep", startTime: "1:00 PM", durationMinutes: 30, assignee: "Alex" }, { taskId: "dishes", date: "2026-09-19", task: "Dishes", startTime: "2:00 PM", durationMinutes: 30, assignee: "Sam" }],
};
const saved = (): HouseholdPlan => ({ ...structuredClone(draft), items: draft.items.map((item) => ({ ...item, id: `task-${item.taskId}` })), version: 1, updatedAt: "2026-09-17T17:00:00Z" });
const tool = (name: string, input: unknown, stopReason = "tool_use"): BedrockResponse => ({ output: { message: { role: "assistant", content: [{ toolUse: { toolUseId: "tool", name, input } }] } }, stopReason });
const capture = (requirementsOverride = requirements) => tool("interpret_household_request", { title: draft.title, objective: draft.objective, participants: draft.participants, requirements: requirementsOverride });
function service(responses: BedrockResponse[]) {
  const converse = vi.fn<BedrockGateway["converse"]>(async () => { const response = responses.shift(); if (!response) throw new Error("Unexpected extra model call"); return response; });
  const gateway: BedrockGateway = { modelId: "test", converse };
  return { chat: createChatService({ gateway, now: () => instant, logger: vi.fn() }), converse };
}

describe("independent interpretation and scheduling", () => {
  it.each([
    ["9 AM", "noon", "9am", "9:00 AM", "12:00 PM"],
    ["09 a.m.", "5 p.m.", "1PM", "9:00 AM", "5:00 PM"],
    ["midnight", "noon", "01:00", "12:00 AM", "12:00 PM"],
  ])("normalizes unambiguous clock values %s through %s before validation", async (startTime, endTime, itemTime, expectedStart, expectedEnd) => {
    const raw = { ...requirements, timeWindow: { startTime, endTime } };
    const flexible = { ...draft, items: draft.items.map((item) => ({ ...item, startTime: itemTime })) };
    const { chat } = service([capture(raw), tool("publish_household_plan", flexible)]);
    const result = await chat(request);
    expect(result.plan?.requirements?.timeWindow).toEqual({ startTime: expectedStart, endTime: expectedEnd });
    expect(result.meta.callCount).toBe(2);
  });

  it.each(["9", "13 AM", "9:60 AM", "24:00"])("does not guess or repair invalid clock %s", async (startTime) => {
    const raw = { ...requirements, timeWindow: { startTime, endTime: "noon" } };
    const { chat } = service([capture(raw), capture(raw), capture(raw)]);
    await expect(chat(request)).rejects.toMatchObject({ code: "INVALID_TOOL_OUTPUT", diagnostics: { callCount: 3, stage: "interpret" } });
  });

  it("does not silently reinterpret midnight as a next-day window end", async () => {
    const raw = { ...requirements, timeWindow: { startTime: "9 PM", endTime: "midnight" } };
    const { chat } = service([capture(raw), capture(raw), capture(raw)]);
    await expect(chat(request)).rejects.toMatchObject({ code: "INVALID_TOOL_OUTPUT", diagnostics: { stage: "interpret" } });
  });

  it("captures requirements before scheduling and ignores a schedule's weakened checklist", async () => {
    const bad = { ...draft, items: [draft.items[0]], requirements: { ...requirements, tasks: [requirements.tasks[0]] } };
    const { chat, converse } = service([capture(), tool("publish_household_plan", bad), tool("publish_household_plan", draft)]);
    const result = await chat(request);
    expect(result.meta.callCount).toBe(3);
    expect(result.plan?.requirements).toEqual(requirements);
    expect(converse.mock.calls).toHaveLength(3);
    const deadlines = converse.mock.calls.map(([, context]) => context?.requestDeadlineMs);
    expect(deadlines[0]).toEqual(expect.any(Number));
    expect(new Set(deadlines).size).toBe(1);
    expect(chatResponseSchema.safeParse(result).success).toBe(true);
  });

  it("explains contradictory fixed commitments after one validated interpretation", async () => {
    const fixed: PlanRequirements = { ...requirements, tasks: [
      { id: "call", label: "Call", date: "2026-09-19", fixedStartTime: "9:00 AM", durationMinutes: 60, requiredParticipants: ["Alex"] },
      { id: "appointment", label: "Appointment", date: "2026-09-19", fixedStartTime: "9:15 AM", durationMinutes: 30, requiredParticipants: ["Alex"] },
    ] };
    const { chat, converse } = service([capture(fixed)]);
    const result = await chat({ ...request, message: "Plan these appointments for Alex." });
    expect(result).toMatchObject({ outcome: "conflict", meta: { callCount: 1, stage: "interpret" } });
    expect(result.plan).toBeUndefined();
    expect(result.reply).toContain("Call and Appointment");
    expect(result.reply).toContain("fixed times overlap");
    expect(converse).toHaveBeenCalledTimes(1);
    expect(chatResponseSchema.safeParse(result).success).toBe(true);
  });

  it("only flags same-day overlap for a participant required by both fixed tasks", () => {
    const call = { id: "call", label: "Call", fixedStartTime: "9:00 AM", durationMinutes: 60, requiredParticipants: ["Alex"] };
    const appointment = { id: "appointment", label: "Appointment", fixedStartTime: "9:15 AM", durationMinutes: 30, requiredParticipants: ["Alex"] };
    const fixed = { ...requirements, tasks: [call, appointment] };
    expect(fixedCommitmentConflict(fixed, "2026-09-19")).toContain("fixed times overlap");
    expect(fixedCommitmentConflict(fixed)).toBeUndefined();
    expect(fixedCommitmentConflict({ ...fixed, tasks: [call, { ...appointment, date: "2026-09-20" }] }, "2026-09-19")).toBeUndefined();
    expect(fixedCommitmentConflict({ ...fixed, tasks: [call, { ...appointment, requiredParticipants: ["Sam"] }] }, "2026-09-19")).toBeUndefined();
    expect(fixedCommitmentConflict({ ...fixed, tasks: [call, { ...appointment, fixedStartTime: "10:00 AM" }] }, "2026-09-19")).toBeUndefined();
    expect(fixedCommitmentConflict({ ...fixed, tasks: [call, { ...appointment, fixedStartTime: undefined }] }, "2026-09-19")).toBeUndefined();
  });

  it("still publishes simultaneous fixed commitments for different required people", async () => {
    const fixed: PlanRequirements = { ...requirements, tasks: [
      { ...requirements.tasks[0], fixedStartTime: "9:00 AM", durationMinutes: 60 },
      { ...requirements.tasks[1], fixedStartTime: "9:15 AM" },
    ] };
    const scheduled: PlanDraft = { ...draft, requirements: fixed, items: [
      { ...draft.items[0], startTime: "9:00 AM", durationMinutes: 60 },
      { ...draft.items[1], startTime: "9:15 AM" },
    ] };
    const { chat, converse } = service([capture(fixed), tool("publish_household_plan", scheduled)]);
    const result = await chat(request);
    expect(result).toMatchObject({ outcome: "plan", meta: { callCount: 2 } });
    expect(result.plan?.items).toHaveLength(2);
    expect(converse).toHaveBeenCalledTimes(2);
  });

  it("explains contradictory fixed commitments in an explicit checklist revision without a model call", async () => {
    const currentPlan = saved();
    const changes = [
      { kind: "update_task" as const, taskId: "meal_prep", task: { ...requirements.tasks[0], fixedStartTime: "9:00 AM", durationMinutes: 60 } },
      { kind: "update_task" as const, taskId: "dishes", task: { ...requirements.tasks[1], fixedStartTime: "9:15 AM", requiredParticipants: ["Alex"] } },
    ];
    const { chat, converse } = service([]);
    const result = await chat({ ...request, currentPlan, changes });
    expect(result).toMatchObject({ outcome: "conflict", meta: { callCount: 0 } });
    expect(result.plan).toBeUndefined();
    expect(result.reply).toContain("Meal prep and Dishes");
    expect(converse).not.toHaveBeenCalled();
  });

  it("never accepts a first-stage schedule as a substitute for independent interpretation", async () => {
    const { chat } = service([tool("publish_household_plan", draft), capture(), tool("publish_household_plan", draft)]);
    const result = await chat(request);
    expect(result.meta.callCount).toBe(3);
  });

  it("rejects an unknown participant during interpretation before scheduling", async () => {
    const bad = { ...requirements, availability: [{ participant: "Unknown", startTime: "9:00 AM", endTime: "5:00 PM" }] };
    const { chat } = service([capture(bad), capture(bad), capture(bad)]);
    await expect(chat(request)).rejects.toMatchObject({ diagnostics: { callCount: 3, stage: "interpret" }, message: expect.stringContaining("Unknown participant") });
  });

  it("returns typed conflict and clarification outcomes without inventing a plan", async () => {
    for (const outcome of ["conflict", "clarification"]) {
      const { chat } = service([tool("explain_planning_outcome", { outcome, message: "Which appointment can move?" })]);
      const result = await chat(request);
      expect(result.outcome).toBe(outcome);
      expect(result.plan).toBeUndefined();
      expect(result.meta.callCount).toBe(1);
    }
  });

  it("rejects truncated output even when its JSON happens to validate", async () => {
    const { chat } = service([capture(), tool("publish_household_plan", draft, "max_tokens"), tool("publish_household_plan", draft)]);
    expect((await chat(request)).meta.callCount).toBe(3);
  });

  it("stops after three shared calls with safe diagnostics", async () => {
    const { chat, converse } = service([capture(), tool("publish_household_plan", draft, "max_tokens"), tool("publish_household_plan", draft, "max_tokens")]);
    await expect(chat(request)).rejects.toMatchObject({ code: "INVALID_TOOL_OUTPUT", diagnostics: { callCount: 3, stage: "schedule", stopReason: "max_tokens" } });
    expect(converse).toHaveBeenCalledTimes(3);
  });

  it("normalizes24-hour availability during capture and typed revisions", async () => {
    const raw = { ...requirements, availability: [{ participant: "Alex", startTime: "12:00", endTime: "17:00" }] };
    const first = service([capture(raw), tool("publish_household_plan", draft)]);
    const initial = await first.chat(request);
    expect(initial.meta.callCount).toBe(2);
    expect(initial.plan?.requirements?.availability?.[0]).toMatchObject({ startTime: "12:00 PM", endTime: "5:00 PM" });
    const currentPlan = saved();
    const changes = [{ kind: "constraints", fields: { availability: [{ participant: "Alex", startTime: "12:00", endTime: "17:00" }] } }];
    const second = service([tool("revise_household_requirements", { changes }), tool("publish_household_plan", draft)]);
    const revised = await second.chat({ ...request, currentPlan, message: "Alex is available only from noon to5PM." });
    expect(revised.meta.callCount).toBe(2);
    expect(revised.plan?.requirements?.availability?.[0]).toMatchObject({ startTime: "12:00 PM", endTime: "5:00 PM" });
  });

  it("uses the completion clock when compacting and publishing after slow model calls", async () => {
    const started = new Date("2026-09-18T14:00:00Z");
    const completed = new Date("2026-09-18T14:02:00Z");
    const today = { ...draft, items: draft.items.map((item, index) => ({ ...item, date: "2026-09-18", startTime: index ? "9:40 AM" : "9:05 AM" })) };
    const responses = [capture(), tool("publish_household_plan", today)];
    let clockReads = 0;
    const chat = createChatService({ gateway: { modelId: "test", converse: async () => responses.shift()! }, now: () => clockReads++ === 0 ? started : completed, logger: vi.fn() });
    const result = await chat({ ...request, planDate: "2026-09-18" });
    expect(result.plan?.items[0].startTime).toBe("9:02 AM");
    expect(result.plan?.updatedAt).toBe(completed.toISOString());
    expect(pastScheduleIssues(result.plan!, request, completed)).toEqual([]);
  });

  it("never compacts a same-day future activity into the past", async () => {
    const today = { ...draft, items: draft.items.map((item) => ({ ...item, date: "2026-09-18" })) };
    const { chat } = service([capture(), tool("publish_household_plan", today)]);
    const result = await chat({ ...request, planDate: "2026-09-18" });
    expect(result.plan?.items[0].startTime).toBe("12:00 PM");
    expect(pastScheduleIssues(result.plan!, request, instant)).toEqual([]);
  });
});

describe("typed revisions and elapsed history", () => {
  it("applies safe combined custom event edits locally, including an explicit fixed commitment override", async () => {
    const currentPlan = saved();
    currentPlan.requirements!.tasks[0] = { ...currentPlan.requirements!.tasks[0], date: "2026-09-19", fixedDate: true, fixedStartTime: "1:00 PM" };
    const { chat, converse } = service([]);
    const result = await chat({ ...request, currentPlan, edit: { taskId: "meal_prep", date: "2026-09-20", startTime: "3:00 PM", durationMinutes: 45 } });
    expect(result.plan?.items[0]).toMatchObject({ date: "2026-09-20", startTime: "3:00 PM", durationMinutes: 45 });
    expect(result.plan?.requirements?.tasks[0]).toMatchObject({ date: "2026-09-20", fixedStartTime: "3:00 PM", durationMinutes: 45 });
    expect(result.meta.callCount).toBe(0);
    expect(converse).not.toHaveBeenCalled();
  });

  it("cancels a task through a typed server-owned operation without changing unrelated tasks", async () => {
    const currentPlan = saved();
    const changes = [{ kind: "remove_task" as const, taskId: "dishes" }];
    const next = { ...draft, items: [draft.items[0]], requirements: applyRequirementChanges(currentPlan, changes) };
    const { chat } = service([tool("revise_household_requirements", { changes }), tool("publish_household_plan", next)]);
    const result = await chat({ ...request, currentPlan, message: "Remove dishes from this plan" });
    expect(result.plan?.items).toHaveLength(1);
    expect(result.plan?.requirements?.tasks).toEqual([requirements.tasks[0]]);
    expect(result.meta.callCount).toBe(2);
  });

  it("adds an activity using a structured request and still validates the full schedule", async () => {
    const currentPlan = saved();
    const task = { id: "groceries", label: "Groceries", durationMinutes: 30, requiredParticipants: ["Sam"] };
    const changes = [{ kind: "add_task" as const, task }];
    const next = { ...draft, requirements: applyRequirementChanges(currentPlan, changes), items: [...draft.items, { taskId: task.id, date: "2026-09-19", task: task.label, durationMinutes: 30, assignee: "Sam", startTime: "3:00 PM" }] };
    const { chat } = service([tool("publish_household_plan", next)]);
    expect((await chat({ ...request, currentPlan, changes })).plan?.items).toHaveLength(3);
  });

  it("cannot silently remove an unrelated task while applying an explicit update", async () => {
    const currentPlan = saved();
    const changes = [{ kind: "update_task" as const, taskId: "meal_prep", task: { ...requirements.tasks[0], durationMinutes: 45 } }];
    const wrong = { ...draft, items: [{ ...draft.items[0], durationMinutes: 45 }], requirements: { ...requirements, tasks: [{ ...requirements.tasks[0], durationMinutes: 45 }] } };
    const { chat } = service([tool("publish_household_plan", wrong), tool("publish_household_plan", wrong), tool("publish_household_plan", wrong)]);
    await expect(chat({ ...request, currentPlan, changes })).rejects.toMatchObject({ message: expect.stringContaining("Dishes") });
  });

  it("rejects add-task proposals that erase an unrelated fixed commitment", async () => {
    const currentPlan = saved();
    currentPlan.requirements!.tasks[0].fixedStartTime = "1:00 PM";
    const changes = [
      { kind: "add_task", task: { id: "snack", label: "Snack", durationMinutes: 10 } },
      { kind: "update_task", taskId: "meal_prep", task: requirements.tasks[0] },
    ];
    const response = tool("revise_household_requirements", { changes });
    const { chat } = service([response, response, response]);
    await expect(chat({ ...request, currentPlan, message: "Add a 10-minute snack" })).rejects.toMatchObject({ message: expect.stringContaining("explicitly names") });
  });

  it("captures a clearly stated named-person availability window without rewriting tasks or other people", () => {
    const currentPlan = saved();
    currentPlan.requirements!.availability = [{ participant: "Sam", startTime: "9:00 AM", endTime: "4:00 PM" }];
    const changes = explicitAvailabilityChanges(currentPlan, "Alex is now available only from 10 AM to 11 AM. Reschedule his work within that availability. Preserve every task and assignment.");
    expect(changes).toEqual([{ kind: "constraints", fields: { availability: [currentPlan.requirements!.availability[0], { participant: "Alex", startTime: "10:00 AM", endTime: "11:00 AM" }] } }]);
    expect(applyRequirementChanges(currentPlan, changes!).tasks).toEqual(currentPlan.requirements!.tasks);
    expect(explicitAvailabilityChanges(currentPlan, "Alex is available only from 10 AM to 11 AM. Also assign Dishes to Alex.")).toBeUndefined();
    currentPlan.requirements!.availability.push({ participant: "Alex", date: "2026-09-20", startTime: "9:00 AM", endTime: "5:00 PM" });
    expect(explicitAvailabilityChanges(currentPlan, "Alex is available only from 10 AM to 11 AM.")).toBeUndefined();
  });

  it("allows scoped availability changes but protects unrelated people and constraints", () => {
    const currentPlan = saved();
    currentPlan.requirements!.availability = [
      { participant: "Alex", startTime: "9:00 AM", endTime: "5:00 PM" },
      { participant: "Sam", startTime: "10:00 AM", endTime: "4:00 PM" },
    ];
    const availability = [{ ...currentPlan.requirements!.availability[0], startTime: "11:00 AM" }, currentPlan.requirements!.availability[1]];
    expect(naturalChangeIssues(currentPlan, [{ kind: "constraints", fields: { availability } }], "Alex is only available after 11 AM")).toEqual([]);
    expect(naturalChangeIssues(currentPlan, [{ kind: "constraints", fields: { availability: [availability[0]] } }], "Alex is only available after 11 AM")).toContainEqual(expect.stringContaining("Sam's unrelated availability"));
    expect(naturalChangeIssues(currentPlan, [{ kind: "constraints", fields: { timeWindow: { startTime: "9:00 AM", endTime: "9:00 PM" }, gaps: [] } }], "Alex is only available after 11 AM")).toContainEqual(expect.stringContaining("did not authorize changing timeWindow"));
  });

  it("removes an explicitly cancelled workload through a JSON-null operation", () => {
    const currentPlan = saved();
    currentPlan.requirements!.workload = { participants: ["Alex", "Sam"], minMinutes: 0, maxMinutes: 60 };
    const changes = [{ kind: "constraints" as const, fields: { workload: null } }];
    expect(naturalChangeIssues(currentPlan, changes, "Remove the whole household workload limit")).toEqual([]);
    expect(applyRequirementChanges(currentPlan, changes).workload).toBeUndefined();
    expect(naturalChangeIssues(currentPlan, changes, "Remove Alex workload limit")).toContainEqual(expect.stringContaining("Sam's unrelated workload"));
  });

  it("does not replace household participants on an ordinary optimization revision", async () => {
    const currentPlan = saved();
    currentPlan.requirements!.tasks = currentPlan.requirements!.tasks.map(({ id, label, durationMinutes }) => ({ id, label, durationMinutes }));
    const wrong = { ...draft, participants: ["Morgan"], requirements: currentPlan.requirements, items: draft.items.map((item) => ({ ...item, assignee: "Morgan" })) };
    const { chat } = service([tool("publish_household_plan", wrong), tool("publish_household_plan", wrong), tool("publish_household_plan", wrong)]);
    await expect(chat({ ...request, currentPlan, message: "Can we finish sooner?" })).rejects.toMatchObject({ message: expect.stringContaining("established participants") });
  });

  it("normalizes omitted revision dates before validation and never publishes a newly overlapping plan", async () => {
    const currentPlan = saved();
    currentPlan.items[0].assignee = "Alex";
    currentPlan.items[1].assignee = "Alex";
    currentPlan.requirements!.tasks = currentPlan.requirements!.tasks.map((task) => ({ ...task, requiredParticipants: ["Alex"] }));
    const wrong = { ...draft, requirements: currentPlan.requirements, items: currentPlan.items.map((item, index) => ({ ...item, date: index === 0 ? undefined : item.date, startTime: "1:00 PM" })) };
    const { chat } = service([tool("publish_household_plan", wrong), tool("publish_household_plan", wrong), tool("publish_household_plan", wrong)]);
    await expect(chat({ ...request, planDate: "2026-09-20", currentPlan, message: "Can we finish sooner?" })).rejects.toMatchObject({ message: expect.stringContaining("overlap") });
  });

  it("supports underscore task IDs in existing checklist corrections", async () => {
    const next = { ...draft, items: [{ ...draft.items[0], durationMinutes: 45 }, draft.items[1]], requirements: { ...requirements, tasks: [{ ...requirements.tasks[0], durationMinutes: 45 }, requirements.tasks[1]] } };
    const { chat } = service([tool("publish_household_plan", next)]);
    expect((await chat({ ...request, currentPlan: saved(), message: "Correct requirement meal_prep: This takes 45 minutes" })).plan?.items[0].durationMinutes).toBe(45);
  });

  it("preserves unchanged historical events while editing remaining work", async () => {
    const currentPlan = saved();
    currentPlan.items[0] = { ...currentPlan.items[0], date: "2026-09-18", startTime: "9:00 AM" };
    const next = { ...draft, items: currentPlan.items.map((item) => item.taskId === "dishes" ? { ...item, startTime: "3:00 PM" } : item) };
    const { chat } = service([tool("publish_household_plan", next)]);
    const result = await chat({ ...request, currentPlan, message: "Move dishes to 3 PM" });
    expect(result.plan?.items[0].startTime).toBe("9:00 AM");
    expect(result.plan?.items[1].startTime).toBe("3:00 PM");
  });

  it("rejects modifying or deleting accepted historical events", () => {
    const currentPlan = saved();
    currentPlan.items[0] = { ...currentPlan.items[0], date: "2026-09-18", startTime: "9:00 AM" };
    for (const items of [[draft.items[1]], [{ ...currentPlan.items[0], durationMinutes: 45 }, currentPlan.items[1]]]) {
      expect(pastScheduleIssues({ ...draft, items }, { ...request, currentPlan }, instant)).toContainEqual(expect.stringContaining("already-started"));
    }
  });

  it("rejects an unauthorized cancellation emitted for an availability request", async () => {
    const response = tool("revise_household_requirements", { changes: [{ kind: "remove_task", taskId: "dishes" }] });
    const { chat } = service([response, response, response]);
    await expect(chat({ ...request, currentPlan: saved(), message: "Alex is only available after 10 AM" })).rejects.toMatchObject({ message: expect.stringContaining("explicit cancellation") });
  });
});

describe("independent constraint validation", () => {
  it("rejects cyclic dependencies, unknown resources, and contradictory assignments", () => {
    expect(requirementsIssues({ ...requirements, ordering: [{ beforeTaskId: "meal_prep", afterTaskId: "dishes" }, { beforeTaskId: "dishes", afterTaskId: "meal_prep" }] }, draft.participants)).toContainEqual(expect.stringContaining("cycle"));
    expect(requirementsIssues({ ...requirements, tasks: [{ ...requirements.tasks[0], resources: [{ resourceId: "oven", units: 1 }] }] }, draft.participants)).toContainEqual(expect.stringContaining("unknown resource"));
    expect(requirementsIssues({ ...requirements, tasks: [{ ...requirements.tasks[0], forbiddenParticipants: ["Alex"] }] }, draft.participants)).toContainEqual(expect.stringContaining("ineligible"));
  });

  it("honors person availability including specific-date overrides during compaction", () => {
    const rules: PlanRequirements = { ...requirements, availability: [{ participant: "Alex", startTime: "9:00 AM", endTime: "5:00 PM" }, { participant: "Alex", date: "2026-09-19", startTime: "12:30 PM", endTime: "3:00 PM" }] };
    const result = shortenSchedule({ ...draft, requirements: rules }, request, rules, instant);
    expect(result.items[0].startTime).toBe("12:30 PM");
    expect(scheduleIssues({ ...result, items: [{ ...result.items[0], startTime: "9:00 AM" }, result.items[1]] }, request, rules)).toContainEqual(expect.stringContaining("availability"));
  });

  it("checks shared capacity across three overlapping activities, even with distinct people", () => {
    const task = { id: "baking", label: "Baking", durationMinutes: 30, resources: [{ resourceId: "oven", units: 1 }] };
    const rules: PlanRequirements = { ...requirements, resources: [{ id: "oven", label: "Oven", capacity: 2 }], tasks: [...requirements.tasks.map((task) => ({ ...task, resources: [{ resourceId: "oven", units: 1 }] })), task] };
    const plan = { ...draft, participants: [...draft.participants, "Pat"], items: [...draft.items.map((item) => ({ ...item, startTime: "1:00 PM" })), { taskId: task.id, task: task.label, date: "2026-09-19", durationMinutes: 30, startTime: "1:00 PM", assignee: "Pat" }] };
    expect(scheduleIssues(plan, request, rules)).toContain("Oven: simultaneous use exceeds capacity 2");
    expect(scheduleIssues({ ...plan, items: plan.items.map((item, index) => index === 2 ? { ...item, startTime: "1:30 PM" } : item) }, request, rules)).toEqual([]);
  });

  it("does not optimize independent people into a shared-resource collision", () => {
    const rules: PlanRequirements = { ...requirements, resources: [{ id: "sink", label: "Sink", capacity: 1 }], tasks: requirements.tasks.map((task) => ({ ...task, resources: [{ resourceId: "sink", units: 1 }] })) };
    const result = shortenSchedule({ ...draft, requirements: rules }, request, rules, instant);
    expect(result.items.map((item) => item.startTime)).toEqual(["9:00 AM", "9:30 AM"]);
    expect(scheduleIssues(result, request, rules)).toEqual([]);
  });

  it("rejects new activities spanning a daylight-saving transition but preserves accepted historical ones", () => {
    for (const [date, startTime, durationMinutes] of [["2027-03-14", "1:50 AM", 20], ["2026-11-01", "12:50 AM", 90]] as const) {
      const item = { ...draft.items[0], date, startTime, durationMinutes };
      const candidate = { ...draft, items: [item] };
      expect(pastScheduleIssues(candidate, request, instant)).toContainEqual(expect.stringContaining("crosses a daylight-saving"));
      const currentPlan = { ...saved(), items: [{ ...item, id: "old" }] };
      expect(pastScheduleIssues(candidate, { ...request, currentPlan }, new Date("2027-04-01T12:00:00Z"))).toEqual([]);
    }
  });

  it("rejects missing or repeated local clock times at daylight-saving transitions", () => {
    for (const [date, startTime] of [["2027-03-14", "2:30 AM"], ["2026-11-01", "1:30 AM"]]) {
      expect(pastScheduleIssues({ ...draft, items: [{ ...draft.items[0], date, startTime }] }, request, instant)).toContainEqual(expect.stringContaining("daylight-saving"));
    }
  });
});
