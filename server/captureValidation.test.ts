// @vitest-environment node
import { describe, expect, it, vi } from "vitest";
import type { PlanRequirements } from "../shared/contracts";
import { resourceCaptureIssues } from "./captureValidation";
import { createChatService } from "./chatService";
import type { BedrockResponse } from "./bedrock";

const message = "On September 19 from 4–6 PM Ada bakes bread for 40 minutes and Ben roasts vegetables for 30 minutes. Both require the one oven for the whole task; it fits only one task at a time. Kit sets the table for 15 minutes independently.";
const requirements: PlanRequirements = {
  source: "interpreted", timeWindow: { startTime: "4:00 PM", endTime: "6:00 PM" },
  resources: [{ id: "oven", label: "Oven", capacity: 1 }],
  tasks: [
    { id: "bread", label: "Bread", durationMinutes: 40, requiredParticipants: ["Ada"], resources: [{ resourceId: "oven", units: 1 }] },
    { id: "vegetables", label: "Vegetables", durationMinutes: 30, requiredParticipants: ["Ben"], resources: [{ resourceId: "oven", units: 1 }] },
    { id: "table", label: "Set table", durationMinutes: 15, requiredParticipants: ["Kit"] },
  ],
};

describe("explicit shared resource capture", () => {
  it.each([0, 1])("rejects an exclusive resource attached to only %i activities", (count) => {
    const copy = structuredClone(requirements);
    copy.tasks = copy.tasks.map((task, index) => ({ ...task, resources: index < count ? task.resources : undefined }));
    expect(resourceCaptureIssues(copy, message)).toHaveLength(1);
  });

  it("rejects missing capacity records and changed capacity", () => {
    expect(resourceCaptureIssues({ ...requirements, resources: [] }, message)).toHaveLength(1);
    expect(resourceCaptureIssues({ ...requirements, resources: [{ id: "oven", label: "Oven", capacity: 2 }] }, message)).toHaveLength(1);
  });

  it("accepts both required uses without attaching the independent task", () => {
    const before = structuredClone(requirements);
    expect(resourceCaptureIssues(requirements, message)).toEqual([]);
    expect(requirements).toEqual(before);
  });

  it.each(["laser cutter", "rehearsal room", "ceramic kiln"])("handles custom resource %s", (name) => {
    const text = `Bread and vegetables are separate activities. Both require one ${name} for the whole activity; the activities cannot overlap.`;
    const copy = structuredClone(requirements);
    copy.resources![0].label = name;
    expect(resourceCaptureIssues(copy, text)).toEqual([]);
    copy.tasks[1].resources = [];
    expect(resourceCaptureIssues(copy, text)).toHaveLength(1);
  });

  it("handles the washer declaration separated from its jobs", () => {
    const text = "Ada washes bedding and Ben washes towels. There is one washer, occupied for each whole task; the wash jobs cannot overlap.";
    expect(resourceCaptureIssues({ ...requirements, resources: [] }, text)[0]).toContain("washer");
  });

  it("does not mistake hours, a single shared trip, or incidental equipment for multiple resource uses", () => {
    for (const text of [
      "Ada and Ben both have one hour; their tasks cannot overlap.",
      "Ada and Ben share one car for a joint trip; Kit reads.",
      "Ada and Ben cannot overlap their work. Kit has one laptop for reading.",
      "Ada and Ben both have one oven each. Their cooking tasks cannot overlap with their respective personal appointments.",
    ]) expect(resourceCaptureIssues({ ...requirements, resources: [] }, text)).toEqual([]);
  });

  it("accepts a joint activity with two people and one resource use", () => {
    const copy = structuredClone(requirements);
    copy.tasks = [{ ...copy.tasks[0], requiredParticipants: ["Ada", "Ben"] }, copy.tasks[2]];
    expect(resourceCaptureIssues(copy, "Ada and Ben share one oven for a single joint bread activity; the oven fits only one task at a time. Kit sets the table.")).toEqual([]);
  });

  it("does not impose capacity one from an unrelated personal overlap constraint", () => {
    const copy = structuredClone(requirements);
    copy.resources![0].capacity = 2;
    expect(resourceCaptureIssues(copy, "Ada and Ben share one oven with capacity for two trays at a time. Ada has two tasks that cannot overlap because Ada does both.")).toEqual([]);
    expect(resourceCaptureIssues(copy, "Ada and Ben share one oven with capacity for two trays; Ada has two tasks that cannot overlap because Ada does both.")).toEqual([]);
  });

  it("recognizes modifiers without changing resource identity", () => {
    const copy = structuredClone(requirements);
    expect(resourceCaptureIssues(copy, message.replace("one oven", "one shared oven"))).toEqual([]);
  });

  it("rejects uses attached to an unrelated activity instead of a named resource user", () => {
    const copy = structuredClone(requirements);
    copy.tasks[1].resources = [];
    copy.tasks[2].resources = [{ resourceId: "oven", units: 1 }];
    expect(resourceCaptureIssues(copy, message)[0]).toContain("Vegetables");
  });

  it("does not attach an explicitly independent activity from the same sentence", () => {
    expect(resourceCaptureIssues(requirements, "Ada bakes bread, Ben roasts vegetables, and Kit sets the table independently. Both cooking jobs require the one oven for the whole task; it fits only one task at a time.")).toEqual([]);
  });

  it("keeps source constraints for a date-only reply without resurrecting them for a replacement request", () => {
    const history = [{ role: "user" as const, text: message }];
    const missing = { ...requirements, resources: [] };
    expect(resourceCaptureIssues(missing, "Tomorrow 4–6 PM", history)).toHaveLength(1);
    expect(resourceCaptureIssues(missing, "Instead let us plan independent reading tomorrow.", history)).toEqual([]);
  });

  it.each([false, true])("repairs incomplete interpretation before scheduling, including clarification history=%s", async (clarification) => {
    const title = "Dinner preparation";
    const captured = { title, objective: title, participants: ["Ada", "Ben", "Kit"], requirements };
    const missing = { ...requirements, tasks: requirements.tasks.map((task) => ({ ...task, resources: undefined })) };
    const tool = (name: string, input: unknown): BedrockResponse => ({ stopReason: "tool_use", output: { message: { role: "assistant", content: [{ toolUse: { toolUseId: "t", name, input } }] } } });
    const responses = [tool("interpret_household_request", { ...captured, requirements: missing }), tool("interpret_household_request", captured), tool("publish_household_plan", {
      ...captured, notes: [], items: requirements.tasks.map((task, index) => ({ taskId: task.id, date: "2026-09-19", startTime: index === 1 ? "4:40 PM" : "4:00 PM", durationMinutes: task.durationMinutes, task: task.label, assignee: task.requiredParticipants![0] })),
    })];
    const converse = vi.fn(async () => responses.shift()!);
    const service = createChatService({ gateway: { modelId: "test", converse }, now: () => new Date("2026-09-18T17:00:00Z"), logger: vi.fn() });
    const result = await service({ message: clarification ? "Tomorrow 4–6 PM" : message, planDate: "2026-09-19", timeZone: "America/Chicago", history: clarification ? [{ role: "user", text: message }, { role: "assistant", text: "What date and time?" }] : [] });
    expect(result.meta.callCount).toBe(3);
    expect(result.plan?.items.find((item) => item.taskId === "vegetables")?.startTime).toBe("4:40 PM");
    expect(result.plan?.requirements).toEqual(requirements);
    expect(converse).toHaveBeenCalledTimes(3);
  });
});
