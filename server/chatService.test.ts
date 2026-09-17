// @vitest-environment node
import { describe, expect, it, vi } from "vitest";
import { householdPlanSchema, type HouseholdPlan, type PlanDraft } from "../shared/contracts";
import { SCENARIO_REQUIREMENTS } from "../shared/scenarios";
import type {
  BedrockGateway,
  BedrockMessage,
  BedrockResponse,
} from "./bedrock";
import { createChatService } from "./chatService";
import { AppError } from "./errors";

const draft: PlanDraft = {
  title: "A calmer evening",
  objective: "Finish dinner and homework before 8:00 PM.",
  participants: ["Maya", "Leo", "Jordan"],
  items: [
    {
      taskId: "dinner",
      startTime: "5:30 PM",
      durationMinutes: 30,
      task: "Prepare dinner",
      assignee: "Jordan",
    },
    {
      taskId: "math",
      startTime: "6:00 PM",
      durationMinutes: 45,
      task: "Math homework",
      assignee: "Maya",
    },
  ],
  notes: ["Keep one adult available for homework help."],
  requirements: {
    source: "interpreted",
    timeWindow: { startTime: "5:30 PM", endTime: "8:00 PM" },
    tasks: [
      { id: "dinner", label: "Prepare dinner", durationMinutes: 30, requiredParticipants: ["Jordan"] },
      { id: "math", label: "Math homework", durationMinutes: 45, requiredParticipants: ["Maya"] },
    ],
  },
};

function response(
  content: BedrockMessage["content"],
  stopReason = "end_turn",
): BedrockResponse {
  return {
    output: { message: { role: "assistant", content } },
    stopReason,
    requestId: "request-123",
  };
}

function mockGateway(responses: BedrockResponse[]): BedrockGateway & {
  converse: ReturnType<typeof vi.fn>;
} {
  return {
    modelId: "us.amazon.nova-2-lite-v1:0",
    converse: vi.fn(async () => {
      const next = responses.shift();
      if (!next) throw new Error("No mocked response remains");
      return next;
    }),
  };
}

describe("createChatService", () => {
  it("keeps saved v1 plans without checklist metadata valid", () => {
    const parsed = householdPlanSchema.safeParse({
      title: "Old plan", objective: "Preserve my demo", participants: ["Maya"],
      items: [{ id: "plan-1-1", startTime: "6:00 PM", durationMinutes: 20, task: "Read", assignee: "Maya" }],
      notes: [], version: 1, updatedAt: "2026-09-15T18:00:00.000Z",
    });
    expect(parsed.success).toBe(true);
  });

  it("omits a leading assistant greeting before calling Bedrock", async () => {
    const gateway = mockGateway([response([{ text: "What time should the plan cover?" }])]);
    const chat = createChatService({ gateway, logger: vi.fn() });

    await chat({
      message: "Help me plan dinner",
      history: [{ role: "assistant", text: "Welcome to Home Huddle." }],
    });

    expect(gateway.converse.mock.calls[0][0][0]).toEqual({
      role: "user",
      content: [{ text: "Help me plan dinner" }],
    });
  });

  it("returns a concise clarification without publishing a plan", async () => {
    const gateway = mockGateway([
      response([{ text: "Who should be included, and what time is available?" }]),
    ]);
    const chat = createChatService({ gateway, logger: vi.fn() });

    const result = await chat({ message: "Help with tonight", history: [] });

    expect(result.reply).toContain("Who should be included");
    expect(result.plan).toBeUndefined();
    expect(result.meta.toolUsed).toBe(false);
  });

  it("returns a validated plan without another model call", async () => {
    const gateway = mockGateway([
      response(
        [
          {
            toolUse: {
              toolUseId: "tool-1",
              name: "publish_household_plan",
              input: draft,
            },
          },
        ],
        "tool_use",
      ),
    ]);
    const chat = createChatService({
      gateway,
      logger: vi.fn(),
      now: () => new Date("2026-09-15T18:00:00.000Z"),
    });

    const result = await chat({
      message: "Plan tonight for Maya, Leo, and Jordan from 5:30 to 8.",
      history: [],
    });

    expect(result.meta.toolUsed).toBe(true);
    expect(result.plan).toMatchObject({
      title: "A calmer evening",
      version: 1,
      updatedAt: "2026-09-15T18:00:00.000Z",
    });
    expect(result.plan?.items[0].id).toBe("task-dinner");
    expect(result.plan?.requirements?.source).toBe("interpreted");
    expect(result.reply).toContain("only the captured requirements were checked");
    expect(gateway.converse).toHaveBeenCalledTimes(1);
  });

  it("asks Bedrock to repair overlapping assignments before publishing", async () => {
    const overlapping = {
      ...draft,
      items: [draft.items[0], { ...draft.items[1], assignee: "Jordan", startTime: "5:45 PM" }],
    };
    const gateway = mockGateway([
      response([{ toolUse: { toolUseId: "bad", name: "publish_household_plan", input: overlapping } }], "tool_use"),
      response([{ toolUse: { toolUseId: "fixed", name: "publish_household_plan", input: draft } }], "tool_use"),
    ]);
    const chat = createChatService({ gateway, logger: vi.fn() });

    const result = await chat({ message: "Plan tonight", history: [] });

    expect(result.plan?.items[1].startTime).toBe("6:00 PM");
    expect(gateway.converse).toHaveBeenCalledTimes(2);
    const repairRequest = gateway.converse.mock.calls[1][0];
    expect(JSON.stringify(repairRequest)).toContain("overlap for Jordan");
  });

  it("repairs a preset when a helper is named but the required child is omitted", async () => {
    const valid: PlanDraft = {
      title: "Weekday evening",
      objective: "Finish dinner and homework before 8:00 PM.",
      participants: ["Maya", "Leo", "Jordan", "Casey"],
      items: [
        { taskId: "dinner", startTime: "5:30 PM", durationMinutes: 30, task: "Dinner", assignee: "Maya, Leo, Jordan, Casey" },
        { taskId: "math-help", startTime: "6:00 PM", durationMinutes: 45, task: "Maya's math help", assignee: "Maya, Casey" },
        { taskId: "reading", startTime: "6:00 PM", durationMinutes: 20, task: "Leo's reading", assignee: "Leo" },
        { taskId: "jordan-call", startTime: "6:30 PM", durationMinutes: 20, task: "Jordan's fixed call", assignee: "Jordan" },
      ],
      notes: [],
      requirements: SCENARIO_REQUIREMENTS.weekday,
    };
    const invalid: PlanDraft = {
      ...valid,
      items: valid.items.map((item) => item.taskId === "math-help" ? { ...item, assignee: "Casey" } : item),
    };
    const gateway = mockGateway([
      response([{ toolUse: { toolUseId: "missing-child", name: "publish_household_plan", input: invalid } }], "tool_use"),
      response([{ toolUse: { toolUseId: "corrected", name: "publish_household_plan", input: valid } }], "tool_use"),
    ]);

    const result = await createChatService({ gateway, logger: vi.fn() })({
      message: "Plan tonight",
      history: [],
      scenarioId: "weekday",
    });

    expect(gateway.converse).toHaveBeenCalledTimes(2);
    expect(JSON.stringify(gateway.converse.mock.calls[1][0])).toContain("include Maya in assignee");
    expect(result.plan?.items.find((item) => item.taskId === "math-help")?.assignee).toBe("Maya, Casey");
  });

  it("increments the version when revising an existing plan", async () => {
    const currentPlan: HouseholdPlan = {
      ...draft,
      items: draft.items.map((item, index) => ({
        ...item,
        id: `plan-1-${index + 1}`,
      })),
      version: 1,
      updatedAt: "2026-09-15T18:00:00.000Z",
    };
    const gateway = mockGateway([
      response(
        [
          {
            toolUse: {
              toolUseId: "tool-2",
              name: "publish_household_plan",
              input: { ...draft, title: "A later evening" },
            },
          },
        ],
        "tool_use",
      ),
    ]);
    const chat = createChatService({ gateway, logger: vi.fn() });

    const result = await chat({
      message: "Move dinner later.",
      history: [],
      currentPlan,
    });

    expect(result.plan?.version).toBe(2);
    expect(result.plan?.items[0].id).toBe("task-dinner");
    expect(gateway.converse).toHaveBeenCalledTimes(1);
  });

  it("rejects invalid tool output after giving the model a repair chance", async () => {
    const gateway = mockGateway([
      response(
        [
          {
            toolUse: {
              toolUseId: "tool-invalid",
              name: "publish_household_plan",
              input: { title: "Missing required fields" },
            },
          },
        ],
        "tool_use",
      ),
      response([{ text: "I could not make the plan." }]),
    ]);
    const chat = createChatService({ gateway, logger: vi.fn() });

    await expect(chat({ message: "Make a plan", history: [] })).rejects.toMatchObject({
      code: "INVALID_TOOL_OUTPUT",
      retryable: true,
    } satisfies Partial<AppError>);
  });

  it("rejects a first free-text plan without an interpreted checklist", async () => {
    const noChecklist = { ...draft, requirements: undefined };
    const gateway = mockGateway([response([{ toolUse: { toolUseId: "missing", name: "publish_household_plan", input: noChecklist } }], "tool_use"), response([{ text: "I cannot make the plan." }])]);
    const chat = createChatService({ gateway, logger: vi.fn() });
    await expect(chat({ message: "Plan tonight", history: [] })).rejects.toMatchObject({
      code: "INVALID_TOOL_OUTPUT",
      message: expect.stringContaining("interpreted requirements checklist"),
    });
  });

  it("accepts a valid plan on the third call after two invalid drafts", async () => {
    const attempts = [1, 2, 3].map((index) =>
      response(
        [
          {
            toolUse: {
              toolUseId: `tool-${index}`,
              name: "publish_household_plan",
              input: index === 3 ? draft : { title: "Missing required fields" },
            },
          },
        ],
        "tool_use",
      ),
    );
    const gateway = mockGateway(attempts);
    const chat = createChatService({ gateway, logger: vi.fn() });

    const result = await chat({ message: "Make a plan", history: [] });
    expect(result.plan?.version).toBe(1);
    expect(gateway.converse).toHaveBeenCalledTimes(3);
  });

  it("rejects three invalid drafts without publishing", async () => {
    const attempts = [1, 2, 3].map((index) =>
      response([{ toolUse: { toolUseId: `tool-${index}`, name: "publish_household_plan", input: { title: "Incomplete" } } }], "tool_use"),
    );
    const gateway = mockGateway(attempts);
    const chat = createChatService({ gateway, logger: vi.fn() });

    await expect(chat({ message: "Make a plan", history: [] })).rejects.toMatchObject({
      code: "INVALID_TOOL_OUTPUT",
    });
    expect(gateway.converse).toHaveBeenCalledTimes(3);
  });

  it("rejects multiple tool calls in one response", async () => {
    const gateway = mockGateway([response([
      { toolUse: { toolUseId: "one", name: "publish_household_plan", input: draft } },
      { toolUse: { toolUseId: "two", name: "publish_household_plan", input: draft } },
    ], "tool_use")]);
    const chat = createChatService({ gateway, logger: vi.fn() });

    await expect(chat({ message: "Make a plan", history: [] })).rejects.toMatchObject({
      code: "TOOL_LOOP",
    });
  });

  it("injects server-owned preset requirements even when the model omits them", async () => {
    const weekday: PlanDraft = {
      title: "Evening", objective: "Dinner and homework", participants: ["Maya", "Leo", "Jordan", "Casey"], notes: [],
      items: [
        { taskId: "dinner", startTime: "5:30 PM", durationMinutes: 30, task: "Dinner", assignee: "All" },
        { taskId: "math-help", startTime: "6:00 PM", durationMinutes: 45, task: "Math help", assignee: "Maya and Casey" },
        { taskId: "jordan-call", startTime: "6:30 PM", durationMinutes: 20, task: "Jordan's call", assignee: "Jordan" },
        { taskId: "reading", startTime: "6:45 PM", durationMinutes: 20, task: "Reading", assignee: "Leo and Casey" },
      ],
    };
    const gateway = mockGateway([response([{ toolUse: { toolUseId: "preset", name: "publish_household_plan", input: weekday } }], "tool_use")]);
    const chat = createChatService({ gateway, logger: vi.fn() });
    const result = await chat({ message: "Plan our evening", scenarioId: "weekday", history: [] });
    expect(result.plan?.requirements).toEqual(SCENARIO_REQUIREMENTS.weekday);
    expect(result.plan?.scenarioId).toBe("weekday");
    expect(gateway.converse.mock.calls[0][1].requirements).toEqual(SCENARIO_REQUIREMENTS.weekday);
  });

  it("rejects a revision that drops an established hard requirement", async () => {
    const currentPlan: HouseholdPlan = {
      ...draft,
      items: draft.items.map((item) => ({ ...item, id: `task-${item.taskId}` })),
      version: 1,
      updatedAt: "2026-09-15T18:00:00.000Z",
    };
    const weakened: PlanDraft = {
      ...draft,
      requirements: { ...draft.requirements!, tasks: draft.requirements!.tasks.filter((task) => task.id !== "math") },
    };
    const gateway = mockGateway([response([{ toolUse: { toolUseId: "bad", name: "publish_household_plan", input: weakened } }], "tool_use"), response([{ text: "I cannot make that revision." }])]);
    const chat = createChatService({ gateway, logger: vi.fn() });
    await expect(chat({ message: "Move dinner later", currentPlan, history: [] })).rejects.toMatchObject({
      code: "INVALID_TOOL_OUTPUT",
      message: expect.stringContaining("preserve its established requirement"),
    });
  });

  it("accepts an explicit correction to one interpreted task but not silent changes to another", async () => {
    const currentPlan: HouseholdPlan = {
      ...draft,
      items: draft.items.map((item) => ({ ...item, id: `task-${item.taskId}` })),
      version: 1,
      updatedAt: "2026-09-15T18:00:00.000Z",
    };
    const corrected: PlanDraft = {
      ...draft,
      items: [{ ...draft.items[0], durationMinutes: 45 }, draft.items[1]],
      requirements: { ...draft.requirements!, tasks: [
        { ...draft.requirements!.tasks[0], durationMinutes: 45 },
        draft.requirements!.tasks[1],
      ] },
    };
    const gateway = mockGateway([response([{ toolUse: { toolUseId: "correct", name: "publish_household_plan", input: corrected } }], "tool_use")]);
    const chat = createChatService({ gateway, logger: vi.fn() });
    const result = await chat({ message: "Correct requirement dinner: dinner takes 45 minutes", currentPlan, history: [] });
    expect(result.plan?.requirements?.tasks[0].durationMinutes).toBe(45);

    const alsoChangedMath: PlanDraft = {
      ...corrected,
      items: [corrected.items[0], { ...draft.items[1], durationMinutes: 30 }],
      requirements: { ...corrected.requirements!, tasks: [
        corrected.requirements!.tasks[0],
        { ...draft.requirements!.tasks[1], durationMinutes: 30 },
      ] },
    };
    const badGateway = mockGateway([response([{ toolUse: { toolUseId: "wrong", name: "publish_household_plan", input: alsoChangedMath } }], "tool_use"), response([{ text: "Could not revise." }])]);
    await expect(createChatService({ gateway: badGateway, logger: vi.fn() })({ message: "Correct requirement dinner: dinner takes 45 minutes", currentPlan, history: [] }))
      .rejects.toMatchObject({ code: "INVALID_TOOL_OUTPUT", message: expect.stringContaining("Math homework") });
  });

  it("explains an impossible fixed commitment without publishing", async () => {
    const impossible: PlanDraft = {
      ...draft,
      requirements: { ...draft.requirements!, tasks: [
        { ...draft.requirements!.tasks[0], fixedStartTime: "6:00 PM" },
        { ...draft.requirements!.tasks[1], fixedStartTime: "6:00 PM", requiredParticipants: ["Jordan", "Maya"] },
      ] },
      items: draft.items.map((item) => ({ ...item, startTime: "6:00 PM", assignee: "Jordan and Maya" })),
    };
    const gateway = mockGateway([1, 2, 3].map((index) => response([{ toolUse: { toolUseId: `bad-${index}`, name: "publish_household_plan", input: impossible } }], "tool_use")));
    const chat = createChatService({ gateway, logger: vi.fn() });
    await expect(chat({ message: "Schedule the two fixed activities at 6:00 PM", history: [] })).rejects.toMatchObject({
      code: "INVALID_TOOL_OUTPUT",
      message: expect.stringContaining("overlap"),
    });
  });

  it("accepts an additive revision only when the requested transition gap is explicit and real", async () => {
    const currentPlan: HouseholdPlan = {
      ...draft,
      items: draft.items.map((item) => ({ ...item, id: `task-${item.taskId}` })),
      version: 1,
      updatedAt: "2026-09-15T18:00:00.000Z",
    };
    const revised: PlanDraft = {
      ...draft,
      items: [
        { ...draft.items[0], assignee: "Maya and Jordan" },
        { ...draft.items[1], startTime: "6:15 PM" },
      ],
      requirements: {
        ...draft.requirements!,
        gaps: [{ afterTaskId: "dinner", beforeTaskId: "math", minMinutes: 10 }],
      },
    };
    const gateway = mockGateway([response([{ toolUse: { toolUseId: "gap", name: "publish_household_plan", input: revised } }], "tool_use")]);
    const chat = createChatService({ gateway, logger: vi.fn() });
    const result = await chat({ message: "Add a 10-minute transition buffer", currentPlan, history: [] });
    expect(result.plan?.requirements?.gaps).toEqual([{ afterTaskId: "dinner", beforeTaskId: "math", minMinutes: 10 }]);
    expect(result.plan?.items[0].id).toBe(currentPlan.items[0].id);
  });

  it("does not accept an arbitrary idle gap without a named checklist relationship", async () => {
    const gateway = mockGateway([response([{ toolUse: { toolUseId: "bad-gap", name: "publish_household_plan", input: draft } }], "tool_use"), response([{ text: "Cannot complete." }])]);
    const chat = createChatService({ gateway, logger: vi.fn() });
    await expect(chat({ message: "Add a 10-minute transition buffer", history: [] })).rejects.toMatchObject({
      code: "INVALID_TOOL_OUTPUT",
      message: expect.stringContaining("Name the two affected tasks"),
    });
  });
});
