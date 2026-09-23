// @vitest-environment node
import { describe, expect, it, vi } from "vitest";
import type { PlanRequirements } from "../shared/contracts";
import type { BedrockResponse } from "./bedrock";
import { orderingCaptureIssues } from "./captureValidation";
import { createChatService } from "./chatService";
import { DateTime } from "luxon";
import { assessPlan, buildCorpus, revisionFixture } from "../scripts/planning-corpus";

const message = "On 2026-09-19 3–5 PM, Ada makes decorations for 30 minutes, Ben prepares snacks for 25 minutes, and Kit arranges chairs for 15 minutes. Work independently, then all three do a 20-minute final setup together.";
const requirements: PlanRequirements = {
  source: "interpreted", timeWindow: { startTime: "3:00 PM", endTime: "5:00 PM" },
  tasks: [
    { id: "decoration", label: "Make decorations", durationMinutes: 30, requiredParticipants: ["Ada"] },
    { id: "snacks", label: "Prepare snacks", durationMinutes: 25, requiredParticipants: ["Ben"] },
    { id: "chairs", label: "Arrange chairs", durationMinutes: 15, requiredParticipants: ["Kit"] },
    { id: "setup", label: "Final setup", durationMinutes: 20, requiredParticipants: ["Ada", "Ben", "Kit"] },
  ],
  ordering: ["decoration", "snacks", "chairs"].map((beforeTaskId) => ({ beforeTaskId, afterTaskId: "setup" })),
};
const tool = (name: string, input: unknown): BedrockResponse => ({ stopReason: "tool_use", output: { message: { role: "assistant", content: [{ toolUse: { toolUseId: "t", name, input } }] } } });

describe("explicit sequence capture", () => {
  it("accepts the exact full parallel corpus request and rejects an omitted barrier edge", async () => {
    const instant = new Date("2026-09-18T17:00:00Z");
    const entry = buildCorpus(DateTime.fromJSDate(instant, { zone: "America/Chicago" })).find((entry) => entry.id === "free-parallel")!;
    const plan = revisionFixture(entry.request.planDate!);
    expect(orderingCaptureIssues(plan.requirements!, entry.request.message)).toEqual([]);
    expect(orderingCaptureIssues(plan.requirements!, entry.request.message.replace("Do those jobs in parallel.", "These activities are independent. Do those jobs in parallel."))).toEqual([]);
    expect(orderingCaptureIssues(plan.requirements!, entry.request.message.replace("Do those jobs in parallel.", "These activities are independent. Do those jobs in parallel. Keep them in parallel."))[0]).toContain("ambiguous");
    const missing = structuredClone(plan.requirements!);
    missing.ordering!.pop();
    expect(orderingCaptureIssues(missing, entry.request.message)).toEqual([expect.stringContaining("books before review")]);
    const responses = [tool("interpret_household_request", plan), tool("publish_household_plan", plan)];
    const converse = vi.fn(async () => responses.shift()!);
    const chat = createChatService({ gateway: { modelId: "test", converse }, now: () => instant, logger: vi.fn() });
    const result = await chat(entry.request);
    expect(result.meta.callCount).toBe(2);
    expect(result.outcome).toBe("plan");
    expect(assessPlan(entry, result.plan!).hardIssues).toEqual([]);
  });

  it("stops reference lookup at intervening named or substantive activity statements", () => {
    const copy = { ...requirements, ordering: [{ beforeTaskId: "snacks", afterTaskId: "setup" }] };
    expect(orderingCaptureIssues(copy, "Make decorations. Prepare snacks. Do those jobs in parallel. Once all finish, do final setup.")).toEqual([]);
    expect(orderingCaptureIssues(copy, "Make decorations. Kit handles unrelated chairs. Do those jobs in parallel. Once all finish, do final setup.")[0]).toContain("ambiguous");
    expect(orderingCaptureIssues(copy, "Make decorations. Discuss a different project. Do those jobs in parallel. Once all finish, do final setup.")[0]).toContain("ambiguous");
  });

  it("requires every explicit prerequisite without inventing an edge between independent activities", () => {
    const copy = structuredClone(requirements);
    copy.ordering = [];
    expect(orderingCaptureIssues(copy, message)).toHaveLength(3);
    expect(copy.ordering).toEqual([]);
    expect(orderingCaptureIssues(requirements, message)).toEqual([]);
  });

  it.each([
    "Decorations, snacks and chairs are independent. After all are complete, do final setup together.",
    "After all decorations, snacks and chairs are complete, do final setup together.",
    "Do final setup after all decorations, snacks and chairs are finished.",
    "Decorations, snacks and chairs are independent. Once all finish, do final setup together.",
  ])("requires the full after-all barrier: %s", (text) => {
    expect(orderingCaptureIssues({ ...requirements, ordering: [] }, text)).toHaveLength(3);
    expect(orderingCaptureIssues(requirements, text)).toEqual([]);
  });

  it("accepts a transitive dependency path and a minimum-gap edge", () => {
    const copy = structuredClone(requirements);
    copy.ordering = [{ beforeTaskId: "decoration", afterTaskId: "snacks" }, { beforeTaskId: "snacks", afterTaskId: "setup" }];
    copy.gaps = [{ afterTaskId: "chairs", beforeTaskId: "setup", minMinutes: 5 }];
    expect(orderingCaptureIssues(copy, message)).toEqual([]);
  });

  it("handles explicit single-task chains without constraining unrelated independent activities", () => {
    const text = "Decorations then snacks then final setup. Chairs happen independently.";
    const copy = { ...requirements, ordering: [{ beforeTaskId: "decoration", afterTaskId: "snacks" }, { beforeTaskId: "snacks", afterTaskId: "setup" }] };
    expect(orderingCaptureIssues(copy, text)).toEqual([]);
    expect(orderingCaptureIssues({ ...requirements, ordering: [] }, text)).toHaveLength(2);
  });

  it("accepts multiple named successors without serializing them", () => {
    const copy: PlanRequirements = { source: "interpreted", timeWindow: requirements.timeWindow, tasks: [
      { id: "pack", label: "Pack boxes", durationMinutes: 20 },
      { id: "load", label: "Load car", durationMinutes: 10 },
      { id: "sweep", label: "Sweep floor", durationMinutes: 15 },
    ], ordering: [{ beforeTaskId: "pack", afterTaskId: "load" }, { beforeTaskId: "pack", afterTaskId: "sweep" }] };
    const text = "Ada packs boxes for 20 minutes; then Ben loads the car for 10 minutes and Kit sweeps the floor for 15 minutes.";
    expect(orderingCaptureIssues(copy, text)).toEqual([]);
    expect(orderingCaptureIssues({ ...copy, ordering: [] }, text)).toHaveLength(2);
    copy.ordering!.pop();
    expect(orderingCaptureIssues(copy, "Ada packs boxes, then Ben loads the car while Kit sweeps the floor independently.")).toEqual([]);
    expect(orderingCaptureIssues(copy, "After Ada packs boxes, Ben loads the car, while Kit sweeps the floor independently.")).toEqual([]);
    expect(orderingCaptureIssues({ ...copy, ordering: [] }, "After Ada packs boxes, Ben loads the car, while Kit sweeps the floor independently.")).toEqual([expect.stringContaining("pack before load")]);
    expect(orderingCaptureIssues({ ...copy, ordering: [] }, "Ada packs boxes, then Ben loads the car; Kit does not need to help.")).toEqual([expect.stringContaining("pack before load")]);
    expect(orderingCaptureIssues({ ...copy, ordering: [] }, "Ada packs boxes, then Ben loads the car and Kit may sweep the floor if time remains.")).toEqual([expect.stringContaining("pack before load")]);
    copy.ordering!.push({ beforeTaskId: "load", afterTaskId: "sweep" });
    expect(orderingCaptureIssues(copy, "Ada packs boxes, then Ben loads the car. Then Kit sweeps the floor.")).toEqual([]);
  });

  it("does not turn conditional, negated, or conversational then into scheduling constraints", () => {
    for (const text of [
      "If it rains then do final setup indoors.",
      "Decorations and snacks can happen in any order, then tell me the plan.",
      "Do not require final setup after all decorations.",
      "Plan decorations, then show me the result.",
      "Decorations and snacks are independent; final setup is independent too.",
    ]) expect(orderingCaptureIssues({ ...requirements, ordering: [] }, text)).toEqual([]);
  });

  it("asks for clarification when a sequence target is ambiguous instead of inventing edges", () => {
    expect(orderingCaptureIssues({ ...requirements, ordering: [] }, "Do decorations, then do it together.")[0]).toContain("ambiguous");
    const duplicate = { ...requirements, tasks: requirements.tasks.map((task) => ({ ...task, label: "Shared activity" })) };
    expect(orderingCaptureIssues(duplicate, "Work independently, then all do the shared activity.")[0]).toContain("ambiguous");
  });

  it("preserves sequence context through a calendar-only clarification reply", () => {
    expect(orderingCaptureIssues({ ...requirements, ordering: [] }, "Tomorrow 3–5 PM", [{ role: "user", text: message }])).toHaveLength(3);
    expect(orderingCaptureIssues({ ...requirements, ordering: [] }, "Instead plan snacks alone.", [{ role: "user", text: message }])).toEqual([]);
  });

  it("rejects incomplete interpretation before the schedule and preserves final ordering through compaction", async () => {
    const captured = { title: "Gathering", objective: "Prepare together", participants: ["Ada", "Ben", "Kit"], requirements };
    const responses = [tool("interpret_household_request", { ...captured, requirements: { ...requirements, ordering: [] } }), tool("interpret_household_request", captured), tool("publish_household_plan", {
      ...captured, notes: [], items: requirements.tasks.map((task) => ({ taskId: task.id, date: "2026-09-19", startTime: task.id === "setup" ? "4:00 PM" : "3:00 PM", durationMinutes: task.durationMinutes, task: task.label, assignee: task.requiredParticipants!.join(", ") })),
    })];
    const converse = vi.fn(async () => responses.shift()!);
    const chat = createChatService({ gateway: { modelId: "test", converse }, now: () => new Date("2026-09-18T17:00:00Z"), logger: vi.fn() });
    const result = await chat({ message, history: [], planDate: "2026-09-19", timeZone: "America/Chicago" });
    expect(result.meta.callCount).toBe(3);
    expect(result.plan?.items.find((item) => item.taskId === "setup")?.startTime).toBe("3:30 PM");
    expect(result.plan?.items.filter((item) => item.taskId !== "setup").every((item) => item.startTime === "3:00 PM")).toBe(true);
    expect(result.plan?.requirements).toEqual(requirements);
  });

  it("returns structured clarification for an unresolved ordering target", async () => {
    const responses = [tool("interpret_household_request", { title: "Gathering", objective: "Prepare together", participants: ["Ada", "Ben", "Kit"], requirements }), tool("explain_planning_outcome", { outcome: "clarification", message: "Which activity should follow decorations?" })];
    const chat = createChatService({ gateway: { modelId: "test", converse: async () => responses.shift()! }, now: () => new Date("2026-09-18T17:00:00Z"), logger: vi.fn() });
    const result = await chat({ message: "Do decorations, then do it together.", history: [], planDate: "2026-09-19", timeZone: "America/Chicago" });
    expect(result.outcome).toBe("clarification");
    expect(result.plan).toBeUndefined();
    expect(result.meta.callCount).toBe(2);
  });
});
