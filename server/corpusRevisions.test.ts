// @vitest-environment node
import { DateTime } from "luxon";
import { describe, expect, it, vi } from "vitest";
import { assessPlan, buildCorpus } from "../scripts/planning-corpus";
import type { PlanDraft, RequirementChange } from "../shared/contracts";
import type { BedrockMessage, BedrockResponse, ConverseContext } from "./bedrock";
import { createChatService } from "./chatService";
import { applyRequirementChanges } from "./requirements";

const instant = new Date("2026-09-18T17:00:00Z");
const corpus = buildCorpus(DateTime.fromJSDate(instant, { zone: "America/Chicago" }));
const cases = corpus.filter((entry) => entry.id.startsWith("revision-") || entry.id === "ambiguous-target");
const result = (name: string, input: unknown): BedrockResponse => ({ output: { message: { role: "assistant", content: [{ toolUse: { toolUseId: "test", name, input } }] } }, stopReason: "tool_use" });

describe("unchanged public corpus revision prompts, offline", () => {
  for (const entry of cases) it(entry.id, async () => {
    const current = structuredClone(entry.request.currentPlan!);
    let changes: RequirementChange[] = [];
    const draft: PlanDraft = { title: current.title, objective: current.objective, participants: current.participants, notes: [], requirements: current.requirements, items: current.items };
    if (entry.id === "revision-exact-start" || entry.id === "revision-elapsed-history") draft.items = current.items.map((item) => item.taskId === "supplies" ? { ...item, startTime: "9:40 AM" } : item.taskId === "review" ? { ...item, startTime: "10:05 AM" } : item);
    if (entry.id === "revision-assignee") draft.items = current.items.map((item) => item.taskId === "supplies" ? { ...item, assignee: "Ada", startTime: "9:30 AM" } : item.taskId === "review" ? { ...item, startTime: "9:55 AM" } : item);
    if (entry.id === "revision-cancel") {
      changes = [{ kind: "remove_task", taskId: "books" }];
      draft.items = current.items.filter((item) => item.taskId !== "books");
    }
    if (entry.id === "revision-add") {
      changes = [
        { kind: "add_task", task: { id: "plants", label: "Water plants", date: entry.request.planDate, durationMinutes: 10, requiredParticipants: ["Kit"] } },
        { kind: "constraints", fields: { ordering: [...current.requirements!.ordering!, { beforeTaskId: "plants", afterTaskId: "review" }] } },
      ];
      draft.items = [...current.items, { taskId: "plants", task: "Water plants", date: entry.request.planDate, durationMinutes: 10, assignee: "Kit", startTime: "9:20 AM" }];
    }
    if (entry.id === "revision-availability") {
      changes = [{ kind: "constraints", fields: { availability: [{ participant: "Ben", startTime: "10:00 AM", endTime: "11:00 AM" }] } }];
      draft.items = current.items.map((item) => item.taskId === "supplies" ? { ...item, startTime: "10:00 AM" } : item.taskId === "review" ? { ...item, startTime: "10:25 AM" } : item);
    }
    if (changes.length) draft.requirements = applyRequirementChanges(current, changes);
    const converse = vi.fn(async (_messages: BedrockMessage[], context?: ConverseContext) => {
      if (entry.outcome === "clarification") throw new Error("An ambiguous target must be clarified without a model call");
      return context?.stage === "revise" ? result("revise_household_requirements", { changes }) : result("publish_household_plan", draft);
    });
    const response = await createChatService({ gateway: { modelId: "offline", converse }, now: () => instant, logger: vi.fn() })(entry.request);
    expect(response.outcome).toBe(entry.outcome);
    if (entry.outcome === "clarification") {
      expect(response.reply).toContain("Reading");
      expect(converse).not.toHaveBeenCalled();
    } else {
      expect(response.plan).toBeDefined();
      expect(assessPlan(entry, response.plan!).hardIssues).toEqual([]);
      const calls = changes.length && entry.id !== "revision-availability" ? 2 : 1;
      expect(response.meta.callCount).toBe(calls);
      expect(converse).toHaveBeenCalledTimes(calls);
    }
  });
});
