// @vitest-environment node
import { describe, expect, it, vi } from "vitest";
import { scenarioRequirements } from "../shared/scenarios";
import type { ChatRequest, PlanDraft } from "../shared/contracts";
import { createChatService } from "./chatService";
import { scheduleIssues } from "./scheduleValidation";

const anchor = "2026-09-18";
function scenarioDraft(scenarioId: NonNullable<ChatRequest["scenarioId"]>): PlanDraft {
  const requirements = scenarioRequirements(scenarioId, anchor)!;
  const participants = scenarioId === "weekday" ? ["Maya", "Leo", "Jordan", "Casey"] : scenarioId === "chores" ? ["Alex", "Sam", "Riley"] : ["Noor", "Eli", "Grandma Jo"];
  const chores: Record<string, [string, string]> = { kitchen: ["9:00 AM", "Alex"], vacuum: ["9:00 AM", "Sam"], "start-laundry": ["9:00 AM", "Riley"], "fold-laundry": ["9:50 AM", "Riley"], "shared-break": ["9:35 AM", participants.join(", ")] };
  const outing: Record<string, string> = { "outbound-travel": "10:00 AM", garden: "10:25 AM", "garden-rest": "11:00 AM", "garden-finish": "11:10 AM", lunch: "11:50 AM", "return-travel": "12:35 PM", library: "10:00 AM", "library-rest": "11:00 AM", picnic: "10:00 AM" };
  return {
    title: scenarioId, objective: "Complete the example", participants, notes: [], requirements,
    items: requirements.tasks.map((task) => ({
      taskId: task.id, task: task.label, durationMinutes: task.durationMinutes,
      // Deliberately omit item dates: the authoritative task dates must beat the anchor.
      startTime: scenarioId === "weekday" ? task.fixedStartTime ?? (task.id.startsWith("dinner-") ? "5:30 PM" : "6:00 PM") : scenarioId === "chores" ? chores[task.id][0] : outing[task.id],
      assignee: scenarioId === "weekday" ? task.id.startsWith("math-") ? "Maya, Casey" : task.requiredParticipants!.join(", ") : scenarioId === "chores" ? chores[task.id][1] : task.requiredParticipants!.join(", "),
    })),
  };
}

describe("authoritative preset event dates", () => {
  it.each(["weekday", "chores", "outing"] as const)("uses%s task dates when item dates are omitted, never the selected anchor", async (scenarioId) => {
    const draft = scenarioDraft(scenarioId);
    const converse = vi.fn(async () => ({ output: { message: { role: "assistant" as const, content: [{ toolUse: { toolUseId: "plan", name: "publish_household_plan", input: draft } }] } }, stopReason: "tool_use" }));
    const request = { message: "Plan this example", history: [], scenarioId, planDate: anchor, timeZone: "America/Chicago" };
    const response = await createChatService({ gateway: { modelId: "test", converse }, now: () => new Date("2026-09-18T17:00:00Z"), logger: vi.fn() })(request);
    expect(response.plan?.items.every((item) => item.date === draft.requirements!.tasks.find((task) => task.id === item.taskId)!.date)).toBe(true);
    expect(scheduleIssues(response.plan!, request, draft.requirements)).toEqual([]);
    expect(converse).toHaveBeenCalledOnce();
  });

  it.each(["weekday", "chores", "outing"] as const)("rejects an explicit wrong%s item date instead of silently replacing it", async (scenarioId) => {
    const draft = scenarioDraft(scenarioId);
    draft.items[0].date = "2026-09-20"; // Future but not the authoritative date.
    const converse = vi.fn(async () => ({ output: { message: { role: "assistant" as const, content: [{ toolUse: { toolUseId: "plan", name: "publish_household_plan", input: draft } }] } }, stopReason: "tool_use" }));
    await expect(createChatService({ gateway: { modelId: "test", converse }, now: () => new Date("2026-09-18T17:00:00Z"), logger: vi.fn() })({ message: "Plan this example", history: [], scenarioId, planDate: anchor, timeZone: "America/Chicago" })).rejects.toMatchObject({ code: "INVALID_TOOL_OUTPUT", message: expect.stringContaining("keep the required date") });
    expect(converse).toHaveBeenCalledTimes(3);
  });
});
