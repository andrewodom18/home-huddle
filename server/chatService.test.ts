// @vitest-environment node
import { describe, expect, it, vi } from "vitest";
import { householdPlanSchema, type HouseholdPlan, type PlanDraft } from "../shared/contracts";
import { SCENARIO_REQUIREMENTS } from "../shared/scenarios";
import type {
  BedrockGateway,
  ConverseContext,
  BedrockMessage,
  BedrockResponse,
} from "./bedrock";
import { createChatService as createChatServiceImpl } from "./chatService";
import { AppError } from "./errors";

// Most fixtures schedule September 19–21. Give tests without an explicit
// clock a stable point before those dates so they retain their intended scope.
function createChatService(options: Parameters<typeof createChatServiceImpl>[0] = {}) {
  return createChatServiceImpl({ now: () => new Date("2026-09-18T12:00:00Z"), ...options });
}

const draft: PlanDraft = {
  title: "A calmer evening",
  objective: "Finish dinner and homework before 8:00 PM.",
  participants: ["Maya", "Leo", "Jordan"],
  items: [
    {
      taskId: "dinner",
      date: "2026-09-21",
      startTime: "5:30 PM",
      durationMinutes: 30,
      task: "Prepare dinner",
      assignee: "Jordan",
    },
    {
      taskId: "math",
      date: "2026-09-21",
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

const weekdayDraft: PlanDraft = {
  title: "School week", objective: "Dinner and school activities", participants: ["Maya", "Leo", "Jordan", "Casey"], notes: [],
  items: SCENARIO_REQUIREMENTS.weekday.tasks.map((task) => ({
    taskId: task.id, date: task.date, task: task.label, durationMinutes: task.durationMinutes,
    startTime: task.id === "jordan-call" ? "6:30 PM" : task.id.startsWith("dinner-") ? "5:30 PM" : "6:00 PM",
    assignee: task.id.startsWith("dinner-") ? "Maya, Leo, Jordan, Casey" : task.id === "jordan-call" ? "Jordan" : task.id.startsWith("math-") ? "Maya, Casey" : "Leo",
  })),
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
    converse: vi.fn(async (_messages: BedrockMessage[], context?: ConverseContext) => {
      const pending = responses[0]?.output.message.content;
      if (context?.stage === "interpret" && pending?.length === 1 && "toolUse" in pending[0] && pending[0].toolUse.name === "publish_household_plan") {
        const plan = pending[0].toolUse.input as PlanDraft;
        if (plan.requirements && plan.participants && plan.title && plan.objective) {
          return response([{ toolUse: { toolUseId: "capture", name: "interpret_household_request", input: { title: plan.title, objective: plan.objective, participants: plan.participants, requirements: plan.requirements } } }], "tool_use");
        }
      }
      const next = responses.shift();
      if (!next) throw new Error("No mocked response remains");
      return next;
    }),
  };
}

function publishedDraft(): HouseholdPlan {
  return {
    ...draft,
    items: draft.items.map((item) => ({ ...item, id: `task-${item.taskId}` })),
    version: 1,
    updatedAt: "2026-09-15T18:00:00.000Z",
  };
}

function publishedChores(): HouseholdPlan {
  const date = "2026-09-19";
  return {
    scenarioId: "chores", title: "Saturday chores", objective: "Share chores fairly",
    participants: ["Alex", "Sam", "Riley"], notes: [],
    items: [
      { id: "task-kitchen", taskId: "kitchen", date, startTime: "9:00 AM", durationMinutes: 35, task: "Clean the kitchen", assignee: "Alex" },
      { id: "task-vacuum", taskId: "vacuum", date, startTime: "9:00 AM", durationMinutes: 30, task: "Vacuum the floors", assignee: "Sam" },
      { id: "task-start-laundry", taskId: "start-laundry", date, startTime: "9:00 AM", durationMinutes: 20, task: "Sort and start laundry", assignee: "Riley" },
      { id: "task-shared-break", taskId: "shared-break", date, startTime: "9:35 AM", durationMinutes: 15, task: "Shared break", assignee: "Alex, Sam, Riley" },
      { id: "task-fold-laundry", taskId: "fold-laundry", date, startTime: "9:50 AM", durationMinutes: 20, task: "Fold and put away laundry", assignee: "Riley" },
    ],
    requirements: SCENARIO_REQUIREMENTS.chores, version: 1, updatedAt: "2026-09-18T12:00:00.000Z",
  };
}

function choresRevision(plan: HouseholdPlan, replacements: Record<string, Partial<PlanDraft["items"][number]>>): PlanDraft {
  return {
    title: plan.title, objective: plan.objective, participants: plan.participants, notes: [],
    items: plan.items.map(({ taskId, date, startTime, durationMinutes, task, assignee }) => ({
      taskId, date, startTime, durationMinutes, task, assignee,
      ...replacements[taskId ?? ""],
    })),
    requirements: plan.requirements,
  };
}

describe("createChatService", () => {
  it("rejects a past selected plan date before using Bedrock", async () => {
    const gateway = mockGateway([]);
    await expect(createChatService({ gateway, now: () => new Date("2026-09-18T15:30:00Z"), logger: vi.fn() })({
      message: "Plan dinner yesterday", history: [], planDate: "2026-09-17", timeZone: "America/Chicago",
    })).rejects.toMatchObject({ code: "VALIDATION", message: expect.stringContaining("already passed in America/Chicago") });
    expect(gateway.converse).not.toHaveBeenCalled();
  });

  it("still answers unrelated questions when a stale planning date is selected", async () => {
    const gateway = mockGateway([response([{ text: "Hello!" }])]);
    const result = await createChatService({ gateway, now: () => new Date("2026-09-18T15:30:00Z"), logger: vi.fn() })({
      message: "Hello", history: [], planDate: "2026-09-17", timeZone: "America/Chicago",
    });
    expect(result.reply).toBe("Hello!");
    expect(gateway.converse).toHaveBeenCalledTimes(1);
  });

  it("rejects a past calendar edit before using Bedrock", async () => {
    const gateway = mockGateway([]);
    const currentPlan: HouseholdPlan = {
      ...publishedDraft(),
      items: publishedDraft().items.map((item) => ({ ...item, date: "2026-09-19" })),
    };
    await expect(createChatService({ gateway, now: () => new Date("2026-09-18T15:30:00Z"), logger: vi.fn() })({
      message: "Move dinner", history: [], currentPlan, planDate: "2026-09-18", timeZone: "America/Chicago",
      edit: { taskId: "dinner", date: "2026-09-17" },
    })).rejects.toMatchObject({ code: "VALIDATION", message: expect.stringContaining("already passed in America/Chicago") });
    expect(gateway.converse).not.toHaveBeenCalled();
  });

  it("rejects a same-day past start before using Bedrock", async () => {
    const gateway = mockGateway([]);
    const currentPlan: HouseholdPlan = {
      ...publishedDraft(),
      items: publishedDraft().items.map((item) => ({ ...item, date: "2026-09-18" })),
    };
    await expect(createChatService({ gateway, now: () => new Date("2026-09-18T15:30:00Z"), logger: vi.fn() })({
      message: "Move dinner to 9 AM", history: [], currentPlan, planDate: "2026-09-18", timeZone: "America/Chicago",
      edit: { taskId: "dinner", startTime: "9:00 AM" },
    })).rejects.toMatchObject({ code: "VALIDATION", message: expect.stringContaining("already passed in America/Chicago") });
    expect(gateway.converse).not.toHaveBeenCalled();
  });

  it("does not publish a model's past event", async () => {
    const past = { ...draft, items: draft.items.map((item) => ({ ...item, date: "2026-09-17" })) };
    const gateway = mockGateway([
      response([{ toolUse: { toolUseId: "past", name: "publish_household_plan", input: past } }], "tool_use"),
      response([{ text: "I cannot make that plan." }]),
    ]);
    await expect(createChatService({ gateway, now: () => new Date("2026-09-18T15:30:00Z"), logger: vi.fn() })({
      message: "Plan dinner", history: [], planDate: "2026-09-18", timeZone: "America/Chicago",
    })).rejects.toMatchObject({ code: "INVALID_TOOL_OUTPUT", message: expect.stringContaining("already passed in America/Chicago") });
    expect(gateway.converse).toHaveBeenCalledTimes(3);
  });

  it("does not publish an undated event even for a legacy request", async () => {
    const undated = { ...draft, items: draft.items.map((item) => ({
      taskId: item.taskId, task: item.task, startTime: item.startTime,
      durationMinutes: item.durationMinutes, assignee: item.assignee,
    })) };
    const gateway = mockGateway([
      response([{ toolUse: { toolUseId: "undated", name: "publish_household_plan", input: undated } }], "tool_use"),
      response([{ text: "Please choose a date." }]),
    ]);
    await expect(createChatService({ gateway, logger: vi.fn() })({
      message: "Plan dinner", history: [],
    })).rejects.toMatchObject({ code: "INVALID_TOOL_OUTPUT", message: expect.stringContaining("choose a YYYY-MM-DD date and time zone") });
  });

  it("keeps saved v1 plans without checklist metadata valid", () => {
    const parsed = householdPlanSchema.safeParse({
      title: "Old plan", objective: "Preserve my demo", participants: ["Maya"],
      items: [{ id: "plan-1-1", startTime: "6:00 PM", durationMinutes: 20, task: "Read", assignee: "Maya" }],
      notes: [], version: 1, updatedAt: "2026-09-15T18:00:00.000Z",
    });
    expect(parsed.success).toBe(true);
  });

  it("publishes an explicit date from a single-day fallback", async () => {
    const gateway = mockGateway([response([{ toolUse: { toolUseId: "dated", name: "publish_household_plan", input: draft } }], "tool_use")]);
    const result = await createChatService({ gateway, logger: vi.fn() })({ message: "Plan dinner", history: [], planDate: "2026-09-21" });
    expect(result.plan?.items.map((item) => item.date)).toEqual(["2026-09-21", "2026-09-21"]);
  });

  it("normalizes unambiguous 24-hour tool times before validating and displaying a plan", async () => {
    const clockDraft = {
      ...draft,
      items: draft.items.map((item) => ({ ...item, startTime: item.taskId === "dinner" ? "17:30" : "18:00" })),
      requirements: { ...draft.requirements!, timeWindow: { startTime: "17:30", endTime: "20:00" } },
    };
    const gateway = mockGateway([response([{ toolUse: { toolUseId: "clock", name: "publish_household_plan", input: clockDraft } }], "tool_use")]);
    const result = await createChatService({ gateway, now: () => new Date("2026-09-18T15:30:00Z"), logger: vi.fn() })({
      message: "Plan dinner", history: [], planDate: "2026-09-21", timeZone: "America/Chicago",
    });
    expect(result.plan?.items.map((item) => item.startTime)).toEqual(["5:30 PM", "5:30 PM"]);
    expect(result.plan?.requirements?.timeWindow).toEqual({ startTime: "5:30 PM", endTime: "8:00 PM" });
  });

  it("checks an interpreted event-date move against the revised checklist", async () => {
    const currentPlan: HouseholdPlan = {
      ...publishedDraft(),
      items: publishedDraft().items.map((item) => ({ ...item, date: "2026-09-21" })),
      requirements: { ...draft.requirements!, tasks: draft.requirements!.tasks.map((task) => ({ ...task, date: "2026-09-21" })) },
    };
    const moved: PlanDraft = {
      ...draft,
      items: draft.items.map((item) => ({ ...item, date: item.taskId === "dinner" ? "2026-10-13" : "2026-09-21" })),
      requirements: { ...currentPlan.requirements!, tasks: currentPlan.requirements!.tasks.map((task) => task.id === "dinner" ? { ...task, date: "2026-10-13" } : task) },
    };
    const gateway = mockGateway([response([{ toolUse: { toolUseId: "moved", name: "publish_household_plan", input: moved } }], "tool_use")]);
    const result = await createChatService({ gateway, logger: vi.fn() })({ message: "Move dinner to October 13, 2026", history: [], currentPlan });
    expect(result.plan?.items.find((item) => item.taskId === "dinner")?.date).toBe("2026-10-13");
  });

  it.each([
    ["Move dinner to tomorrow", "2026-09-17T00:01:00Z"],
    ["Move dinner to next Tuesday", "2026-09-17T23:59:00Z"],
  ])("clarifies a relative date before Bedrock, regardless of UTC boundary: %s", async (message, instant) => {
    const gateway = mockGateway([]);
    const currentPlan = {
      ...publishedDraft(),
      items: publishedDraft().items.map((item) => ({ ...item, date: "2026-09-21" })),
    };
    await expect(createChatService({ gateway, logger: vi.fn(), now: () => new Date(instant) })({
      message, history: [], currentPlan,
    })).resolves.toMatchObject({ outcome: "clarification", reply: expect.stringContaining("YYYY-MM-DD date") });
    expect(gateway.converse).not.toHaveBeenCalled();
  });

  it("moves one flexible preset event to another date without changing other canonical constraints", async () => {
    const currentPlan: HouseholdPlan = {
      ...weekdayDraft, scenarioId: "weekday", requirements: SCENARIO_REQUIREMENTS.weekday,
      items: weekdayDraft.items.map((item) => ({ ...item, id: `task-${item.taskId}` })),
      version: 1, updatedAt: "2026-09-21T12:00:00.000Z",
    };
    const revised: PlanDraft = {
      ...weekdayDraft,
      items: weekdayDraft.items.map((item) => item.taskId === "math-mon" ? { ...item, date: "2026-10-13" } : item),
      requirements: {
        ...SCENARIO_REQUIREMENTS.weekday,
        tasks: SCENARIO_REQUIREMENTS.weekday.tasks.map((task) => task.id === "math-mon" ? { ...task, date: "2026-10-13" } : task),
      },
    };
    const gateway = mockGateway([response([{ toolUse: { toolUseId: "moved", name: "publish_household_plan", input: revised } }], "tool_use")]);
    const result = await createChatService({ gateway, logger: vi.fn() })({ message: "Move Maya's math help to October 13, 2026", history: [], currentPlan, edit: { taskId: "math-mon", date: "2026-10-13" } });
    expect(result.plan?.items.find((item) => item.taskId === "math-mon")?.date).toBe("2026-10-13");
    expect(result.plan?.requirements?.tasks.find((task) => task.id === "math-mon")?.date).toBe("2026-10-13");
    expect(result.plan?.requirements?.source).toBe("scenario");
    expect(result.plan?.items.find((item) => item.taskId === "dinner-21")?.date).toBe("2026-09-21");
  });

  it("rejects an extra preset date move that was not requested", async () => {
    const currentPlan: HouseholdPlan = {
      ...weekdayDraft, scenarioId: "weekday", requirements: SCENARIO_REQUIREMENTS.weekday,
      items: weekdayDraft.items.map((item) => ({ ...item, id: `task-${item.taskId}` })),
      version: 1, updatedAt: "2026-09-21T12:00:00.000Z",
    };
    const revised: PlanDraft = {
      ...weekdayDraft,
      items: weekdayDraft.items.map((item) => item.taskId === "math-mon" || item.taskId === "reading-tue" ? { ...item, date: "2026-10-13" } : item),
      requirements: {
        ...SCENARIO_REQUIREMENTS.weekday,
        tasks: SCENARIO_REQUIREMENTS.weekday.tasks.map((task) => task.id === "math-mon" || task.id === "reading-tue" ? { ...task, date: "2026-10-13" } : task),
      },
    };
    const gateway = mockGateway([
      response([{ toolUse: { toolUseId: "moved-too-much", name: "publish_household_plan", input: revised } }], "tool_use"),
      response([{ text: "I cannot make the change." }]),
    ]);
    await expect(createChatService({ gateway, logger: vi.fn() })({
      message: "Move math-mon to October 13, 2026", history: [], currentPlan,
    })).rejects.toMatchObject({ code: "INVALID_TOOL_OUTPUT", message: expect.stringContaining("keep the required date") });
  });

  it("protects a preset commitment's fixed date before a model call", async () => {
    const currentPlan: HouseholdPlan = {
      ...weekdayDraft, scenarioId: "weekday", requirements: SCENARIO_REQUIREMENTS.weekday,
      items: weekdayDraft.items.map((item) => ({ ...item, id: `task-${item.taskId}` })),
      version: 1, updatedAt: "2026-09-21T12:00:00.000Z",
    };
    const gateway = mockGateway([]);
    await expect(createChatService({ gateway, logger: vi.fn() })({ message: "Move Jordan's fixed call to October 13, 2026", history: [], currentPlan, edit: { taskId: "jordan-call", date: "2026-10-13" } })).rejects.toMatchObject({ code: "VALIDATION", message: expect.stringContaining("fixed date") });
    expect(gateway.converse).not.toHaveBeenCalled();
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
    expect(result.meta.callCount).toBe(1);
  });

  it("answers an unrelated question without inventing a calendar plan", async () => {
    const gateway = mockGateway([response([{ text: "I can help organize household schedules; I cannot answer that unrelated question here." }])]);
    const result = await createChatService({ gateway, logger: vi.fn() })({
      message: "What is the capital of Mars?", history: [],
    });
    expect(result.plan).toBeUndefined();
    expect(result.meta.toolUsed).toBe(false);
    expect(gateway.converse).toHaveBeenCalledTimes(1);
  });

  it("captures free-text requirements before publishing without a narration call", async () => {
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
    expect(result.plan?.notes).toEqual([]);
    expect(result.reply).toContain("only the captured requirements were checked");
    expect(result.plan?.items[1].startTime).toBe("5:30 PM");
    expect(result.meta.callCount).toBe(2);
    expect(gateway.converse).toHaveBeenCalledTimes(2);
  });

  it("shortens a serial preset plan without another model call", async () => {
    const chores: PlanDraft = {
      title: "Saturday chores", objective: "Share chores fairly", participants: ["Alex", "Sam", "Riley"], notes: [],
      items: [
        { taskId: "kitchen", date: "2026-09-19", startTime: "9:00 AM", durationMinutes: 35, task: "Kitchen", assignee: "Alex" },
        { taskId: "vacuum", date: "2026-09-19", startTime: "9:35 AM", durationMinutes: 30, task: "Vacuum", assignee: "Sam" },
        { taskId: "start-laundry", date: "2026-09-19", startTime: "10:05 AM", durationMinutes: 20, task: "Start laundry", assignee: "Riley" },
        { taskId: "shared-break", date: "2026-09-19", startTime: "10:25 AM", durationMinutes: 15, task: "Break", assignee: "All" },
        { taskId: "fold-laundry", date: "2026-09-19", startTime: "10:40 AM", durationMinutes: 20, task: "Fold laundry", assignee: "Riley" },
      ],
    };
    const gateway = mockGateway([response([{ toolUse: { toolUseId: "chores", name: "publish_household_plan", input: chores } }], "tool_use")]);
    const result = await createChatService({ gateway, logger: vi.fn() })({
      message: "Plan chores", history: [], scenarioId: "chores",
    });

    expect(result.plan?.items.map((item) => item.startTime)).toEqual([
      "9:00 AM", "9:00 AM", "9:00 AM", "9:35 AM", "9:50 AM",
    ]);
    expect(result.reply).toContain("removing avoidable idle time");
    expect(gateway.converse).toHaveBeenCalledTimes(1);
  });

  it("keeps a preset checklist verified when a revision only changes times", async () => {
    const currentPlan: HouseholdPlan = {
      scenarioId: "chores", title: "Saturday chores", objective: "Share chores fairly",
      participants: ["Alex", "Sam", "Riley"], notes: [],
      items: [
        { id: "task-kitchen", taskId: "kitchen", startTime: "9:00 AM", durationMinutes: 35, task: "Clean the kitchen", assignee: "Alex" },
        { id: "task-vacuum", taskId: "vacuum", startTime: "9:00 AM", durationMinutes: 30, task: "Vacuum the floors", assignee: "Sam" },
        { id: "task-start-laundry", taskId: "start-laundry", startTime: "9:00 AM", durationMinutes: 20, task: "Sort and start laundry", assignee: "Riley" },
        { id: "task-shared-break", taskId: "shared-break", startTime: "9:35 AM", durationMinutes: 15, task: "Shared break", assignee: "Alex, Sam, Riley" },
        { id: "task-fold-laundry", taskId: "fold-laundry", startTime: "9:50 AM", durationMinutes: 20, task: "Fold and put away laundry", assignee: "Riley" },
      ],
      requirements: SCENARIO_REQUIREMENTS.chores, version: 1, updatedAt: "2026-09-17T18:00:00.000Z",
    };
    const revised: PlanDraft = {
      ...currentPlan,
      items: currentPlan.items.map((item) => ({
        ...item,
        startTime: item.startTime === "9:00 AM" ? "9:15 AM" : item.startTime === "9:35 AM" ? "9:50 AM" : "10:05 AM",
      })),
      requirements: { ...SCENARIO_REQUIREMENTS.chores, source: "interpreted" },
    };
    const gateway = mockGateway([response([{ toolUse: { toolUseId: "revision", name: "publish_household_plan", input: revised } }], "tool_use")]);

    const result = await createChatService({ gateway, logger: vi.fn() })({
      message: "Move the first task 15 minutes later", currentPlan, scenarioId: "chores", history: [], planDate: "2026-09-19",
    });

    expect(result.plan?.requirements).toEqual(SCENARIO_REQUIREMENTS.chores);
    expect(result.plan?.version).toBe(2);
    expect(result.plan?.title).toBe(currentPlan.title);
    expect(result.reply).not.toContain("interpreted requirements");
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

    expect(result.plan?.items[1].startTime).toBe("5:30 PM");
    expect(gateway.converse).toHaveBeenCalledTimes(3);
    expect(result.meta.callCount).toBe(3);
    const repairRequest = gateway.converse.mock.calls[2][0];
    expect(JSON.stringify(repairRequest)).toContain("overlap for Jordan");
  });

  it("repairs a preset when a helper is named but the required child is omitted", async () => {
    const valid: PlanDraft = {
      ...weekdayDraft,
      requirements: SCENARIO_REQUIREMENTS.weekday,
    };
    const invalid: PlanDraft = {
      ...valid,
      items: valid.items.map((item) => item.taskId === "math-mon" ? { ...item, assignee: "Casey" } : item),
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
    expect(result.plan?.items.find((item) => item.taskId === "math-mon")?.assignee).toBe("Maya, Casey");
  });

  it("increments the version when revising an existing plan", async () => {
    const currentPlan: HouseholdPlan = {
      ...draft,
      items: draft.items.map((item, index) => ({
        ...item,
        id: `plan-1-${index + 1}`,
        details: index === 0 ? "Use the dinner ingredients already prepared." : undefined,
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
              input: { ...draft, title: "A later evening", items: [{ ...draft.items[0], startTime: "6:15 PM" }, draft.items[1]] },
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
    expect(result.plan?.title).toBe(currentPlan.title);
    expect(result.plan?.items[0].details).toBe("Use the dinner ingredients already prepared.");
    expect(result.plan?.items[0].startTime).toBe("6:15 PM");
    expect(result.plan?.items[1].startTime).toBe("6:00 PM");
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

  it("accepts a repaired schedule on the third shared call after interpretation", async () => {
    const capture = { title: draft.title, objective: draft.objective, participants: draft.participants, requirements: draft.requirements };
    const gateway = mockGateway([
      response([{ toolUse: { toolUseId: "capture", name: "interpret_household_request", input: capture } }], "tool_use"),
      response([{ toolUse: { toolUseId: "invalid", name: "publish_household_plan", input: { title: "Incomplete" } } }], "tool_use"),
      response([{ toolUse: { toolUseId: "valid", name: "publish_household_plan", input: draft } }], "tool_use"),
    ]);
    const result = await createChatService({ gateway, logger: vi.fn() })({ message: "Make a plan", history: [] });
    expect(result.plan?.version).toBe(1);
    expect(result.meta.callCount).toBe(3);
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
    const weekday: PlanDraft = weekdayDraft;
    const gateway = mockGateway([response([{ toolUse: { toolUseId: "preset", name: "publish_household_plan", input: weekday } }], "tool_use")]);
    const chat = createChatService({ gateway, logger: vi.fn(), now: () => new Date("2026-09-18T15:00:00Z") });
    const result = await chat({ message: "Plan our evening", scenarioId: "weekday", history: [], planDate: "2026-09-18", timeZone: "America/Chicago" });
    expect(result.plan?.requirements).toEqual(SCENARIO_REQUIREMENTS.weekday);
    expect(result.plan?.scenarioId).toBe("weekday");
    expect(result.plan?.scenarioAnchor).toBe("2026-09-18");
    expect(gateway.converse.mock.calls[0][1].requirements).toEqual(SCENARIO_REQUIREMENTS.weekday);
  });

  it("does not repeat unchecked model prose that contradicts a validated preset calendar", async () => {
    const gateway = mockGateway([response([
      { text: "Everyone starts every activity at 8:00 PM." },
      { toolUse: { toolUseId: "preset", name: "publish_household_plan", input: weekdayDraft } },
    ], "tool_use")]);
    const result = await createChatService({ gateway, logger: vi.fn() })({
      message: "Plan our evening", scenarioId: "weekday", history: [],
    });
    expect(result.plan?.items.find((item) => item.taskId === "jordan-call")?.startTime).toBe("6:30 PM");
    expect(result.reply).toBe("Your household plan is ready.");
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
      message: expect.stringContaining("Keep the current task checklist"),
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

  it("rejects a gap silently added during an unrelated revision", async () => {
    const currentPlan: HouseholdPlan = {
      ...draft,
      items: draft.items.map((item) => ({ ...item, id: `task-${item.taskId}` })),
      version: 1,
      updatedAt: "2026-09-15T18:00:00.000Z",
    };
    const withExtraGap: PlanDraft = {
      ...draft,
      requirements: {
        ...draft.requirements!,
        gaps: [{ afterTaskId: "dinner", beforeTaskId: "math", minMinutes: 15 }],
      },
    };
    const gateway = mockGateway([
      response([{ toolUse: { toolUseId: "extra-gap", name: "publish_household_plan", input: withExtraGap } }], "tool_use"),
      response([{ text: "I cannot make that revision." }]),
    ]);

    await expect(createChatService({ gateway, logger: vi.fn() })({
      message: "Move dinner later", currentPlan, history: [],
    })).rejects.toMatchObject({
      code: "INVALID_TOOL_OUTPUT",
      message: expect.stringContaining("unless the user requested one"),
    });
  });

  it("does not accept an arbitrary idle gap without a named checklist relationship", async () => {
    const gateway = mockGateway([response([{ toolUse: { toolUseId: "bad-gap", name: "publish_household_plan", input: draft } }], "tool_use"), response([{ text: "Cannot complete." }])]);
    const chat = createChatService({ gateway, logger: vi.fn() });
    await expect(chat({ message: "Add a 10-minute transition buffer", history: [] })).rejects.toMatchObject({
      code: "INVALID_TOOL_OUTPUT",
      message: expect.stringContaining("Name the two affected tasks"),
    });
  });

  it("checks a conversational time edit and repairs a no-op proposal", async () => {
    const currentPlan = publishedDraft();
    const revised = { ...draft, items: [{ ...draft.items[0], startTime: "6:15 PM" }, draft.items[1]] };
    const gateway = mockGateway([
      response([{ toolUse: { toolUseId: "unchanged", name: "publish_household_plan", input: draft } }], "tool_use"),
      response([{ toolUse: { toolUseId: "changed", name: "publish_household_plan", input: revised } }], "tool_use"),
    ]);
    const result = await createChatService({ gateway, logger: vi.fn() })({
      message: "Move dinner to 6:15 PM", currentPlan, history: [],
    });
    expect(result.plan?.items[0].startTime).toBe("6:15 PM");
    expect(gateway.converse).toHaveBeenCalledTimes(2);
    expect(gateway.converse.mock.calls[0][1].requestedRevision).toMatchObject({ taskId: "dinner", start: { kind: "exact", value: 1095 } });
    expect(JSON.stringify(gateway.converse.mock.calls[1][0])).toContain("start at the requested time");
  });

  it("keeps the server-owned checklist when a model rewrites an unrelated requirement during an exact edit", async () => {
    const currentPlan = publishedDraft();
    const revised: PlanDraft = {
      ...draft,
      items: [{ ...draft.items[0], startTime: "6:15 PM" }, draft.items[1]],
      requirements: {
        ...draft.requirements!,
        tasks: [draft.requirements!.tasks[0], { ...draft.requirements!.tasks[1], durationMinutes: 20, label: "Changed by model" }],
      },
    };
    const gateway = mockGateway([response([{ toolUse: { toolUseId: "revision", name: "publish_household_plan", input: revised } }], "tool_use")]);
    const result = await createChatService({ gateway, logger: vi.fn() })({
      message: "Set the start of Prepare dinner to 6:15 PM", currentPlan, history: [],
    });
    expect(result.plan?.items[0].startTime).toBe("6:15 PM");
    expect(result.plan?.requirements).toEqual(currentPlan.requirements);
    expect(gateway.converse).toHaveBeenCalledTimes(1);
  });

  it("clarifies an unparsed multi-field chat edit without publishing an unchecked plan", async () => {
    const gateway = mockGateway([]);
    await expect(createChatService({ gateway, logger: vi.fn() })({
      message: "Move dinner to 6:15 PM. Also assign it to Leo", currentPlan: publishedDraft(), history: [],
    })).resolves.toMatchObject({ outcome: "clarification", reply: expect.stringContaining("one clear") });
    expect(gateway.converse).not.toHaveBeenCalled();
  });

  it("does not accept a text-only claim that a conversational edit succeeded", async () => {
    const gateway = mockGateway([response([{ text: "Done, dinner is moved." }]), response([{ text: "Done." }])]);
    await expect(createChatService({ gateway, logger: vi.fn() })({
      message: "Move dinner to 6:15 PM", currentPlan: publishedDraft(), history: [],
    })).rejects.toMatchObject({ code: "INVALID_TOOL_OUTPUT", message: expect.stringContaining("not published and checked") });
    expect(gateway.converse).toHaveBeenCalledTimes(2);
  });

  it("allows a requested interpreted duration correction only when the checklist and event agree", async () => {
    const currentPlan = publishedDraft();
    const revised: PlanDraft = {
      ...draft,
      items: [{ ...draft.items[0], durationMinutes: 45 }, draft.items[1]],
      requirements: {
        ...draft.requirements!,
        tasks: [{ ...draft.requirements!.tasks[0], durationMinutes: 45 }, draft.requirements!.tasks[1]],
      },
    };
    const gateway = mockGateway([response([{ toolUse: { toolUseId: "duration", name: "publish_household_plan", input: revised } }], "tool_use")]);
    const result = await createChatService({ gateway, logger: vi.fn() })({
      message: "Make dinner 45 minutes", currentPlan, history: [],
      edit: { taskId: "dinner", durationMinutes: 45 },
    });
    expect(result.plan?.requirements?.tasks[0].durationMinutes).toBe(45);
    expect(result.plan?.items[0].durationMinutes).toBe(45);
  });

  it("checks every field of a combined calendar edit", async () => {
    const currentPlan = publishedDraft();
    const revised: PlanDraft = {
      ...draft,
      items: [{ ...draft.items[0], startTime: "6:45 PM", durationMinutes: 45, assignee: "Jordan, Leo" }, draft.items[1]],
      requirements: {
        ...draft.requirements!,
        tasks: [{ ...draft.requirements!.tasks[0], durationMinutes: 45 }, draft.requirements!.tasks[1]],
      },
    };
    const gateway = mockGateway([response([{ toolUse: { toolUseId: "combined", name: "publish_household_plan", input: revised } }], "tool_use")]);
    const result = await createChatService({ gateway, logger: vi.fn() })({
      message: "Update dinner", currentPlan, history: [],
      edit: { taskId: "dinner", startTime: "6:45 PM", durationMinutes: 45, assignees: ["Jordan", "Leo"] },
    });
    expect(result.plan?.items[0]).toMatchObject({ startTime: "6:45 PM", durationMinutes: 45, assignee: "Jordan, Leo" });
  });

  it("honors a conversational duration change as an explicit checklist correction", async () => {
    const revised: PlanDraft = {
      ...draft,
      items: [{ ...draft.items[0], durationMinutes: 45 }, draft.items[1]],
      requirements: { ...draft.requirements!, tasks: [
        { ...draft.requirements!.tasks[0], durationMinutes: 45 }, draft.requirements!.tasks[1],
      ] },
    };
    const gateway = mockGateway([response([{ toolUse: { toolUseId: "duration-chat", name: "publish_household_plan", input: revised } }], "tool_use")]);
    const result = await createChatService({ gateway, logger: vi.fn() })({
      message: "Could you make dinner 45 minutes?", currentPlan: publishedDraft(), history: [],
    });
    expect(result.plan?.requirements?.tasks[0].durationMinutes).toBe(45);
    expect(result.plan?.items[0].durationMinutes).toBe(45);
  });

  it("verifies a conversational end-time change against the event and checklist", async () => {
    const revised: PlanDraft = {
      ...draft,
      items: [{ ...draft.items[0], durationMinutes: 45 }, draft.items[1]],
      requirements: { ...draft.requirements!, tasks: [
        { ...draft.requirements!.tasks[0], durationMinutes: 45 }, draft.requirements!.tasks[1],
      ] },
    };
    const wrongStart = { ...revised, items: [{ ...revised.items[0], startTime: "5:45 PM" }, revised.items[1]] };
    const gateway = mockGateway([
      response([{ toolUse: { toolUseId: "wrong-end-time", name: "publish_household_plan", input: wrongStart } }], "tool_use"),
      response([{ toolUse: { toolUseId: "end-time-chat", name: "publish_household_plan", input: revised } }], "tool_use"),
    ]);
    const result = await createChatService({ gateway, logger: vi.fn() })({
      message: "Set the end time of dinner to 6:15 PM", currentPlan: publishedDraft(), history: [],
    });
    expect(result.plan?.items[0].durationMinutes).toBe(45);
    expect(result.plan?.items[0].startTime).toBe("5:30 PM");
    expect(result.plan?.requirements?.tasks[0].durationMinutes).toBe(45);
    expect(gateway.converse).toHaveBeenCalledTimes(2);
  });

  it("rejects a fixed preset commitment before spending a Bedrock call", async () => {
    const currentPlan: HouseholdPlan = {
      ...publishedDraft(), scenarioId: "weekday", requirements: SCENARIO_REQUIREMENTS.weekday,
      participants: ["Maya", "Leo", "Jordan", "Casey"],
      items: [{ id: "task-jordan-call", taskId: "jordan-call", startTime: "6:30 PM", durationMinutes: 20, task: "Jordan's fixed call", assignee: "Jordan" }],
    };
    const gateway = mockGateway([]);
    await expect(createChatService({ gateway, logger: vi.fn() })({
      message: "Move Jordan's call to 7 PM", currentPlan, scenarioId: "weekday", history: [],
      edit: { taskId: "jordan-call", startTime: "7:00 PM" },
    })).rejects.toMatchObject({ code: "VALIDATION", message: expect.stringContaining("fixed start") });
    expect(gateway.converse).not.toHaveBeenCalled();
  });

  it("keeps canonical preset durations immutable after the checklist becomes additive", async () => {
    const currentPlan: HouseholdPlan = {
      ...publishedDraft(), scenarioId: "weekday",
      requirements: { ...SCENARIO_REQUIREMENTS.weekday, source: "interpreted", tasks: [
        ...SCENARIO_REQUIREMENTS.weekday.tasks,
        { id: "dessert", label: "Dessert", durationMinutes: 15 },
      ] },
      items: [{ id: "task-jordan-call", taskId: "jordan-call", startTime: "6:30 PM", durationMinutes: 20, task: "Jordan's fixed call", assignee: "Jordan" }],
    };
    const gateway = mockGateway([]);
    await expect(createChatService({ gateway, logger: vi.fn() })({
      message: "Make Jordan's call 30 minutes", currentPlan, scenarioId: "weekday", history: [],
      edit: { taskId: "jordan-call", durationMinutes: 30 },
    })).rejects.toMatchObject({ code: "VALIDATION", message: expect.stringContaining("required 20-minute duration") });
    expect(gateway.converse).not.toHaveBeenCalled();
  });

  it("verifies a common conversational assignee request", async () => {
    const currentPlan = publishedDraft();
    const gateway = mockGateway([
      response([{ toolUse: { toolUseId: "assignee", name: "publish_household_plan", input: draft } }], "tool_use"),
      response([{ text: "I cannot make that assignment." }]),
    ]);
    await expect(createChatService({ gateway, logger: vi.fn() })({
      message: "Assign dinner to Jordan and Leo", currentPlan, history: [],
    })).rejects.toMatchObject({ code: "INVALID_TOOL_OUTPUT", message: expect.stringContaining("assign exactly Jordan, Leo") });
    expect(gateway.converse).toHaveBeenCalledTimes(2);
  });

  it("accepts a flexible preset duration and carries its customized checklist into later revisions", async () => {
    const currentPlan = publishedChores();
    const first = choresRevision(currentPlan, { kitchen: { durationMinutes: 30 } });
    const gateway = mockGateway([
      response([{ toolUse: { toolUseId: "shorter-kitchen", name: "publish_household_plan", input: first } }], "tool_use"),
      response([{ toolUse: { toolUseId: "later-kitchen", name: "publish_household_plan", input: choresRevision({ ...currentPlan, items: first.items.map((item) => ({ ...item, id: `task-${item.taskId}` })) }, { kitchen: { startTime: "9:05 AM", durationMinutes: 30 } }) } }], "tool_use"),
    ]);
    const chat = createChatService({ gateway, logger: vi.fn(), now: () => new Date("2026-09-18T12:00:00Z") });
    const accepted = await chat({ message: "Make kitchen 30 minutes", history: [], currentPlan, planDate: "2026-09-19", edit: { taskId: "kitchen", durationMinutes: 30 } });
    expect(accepted.plan?.scenarioEdits).toEqual({ kitchen: { durationMinutes: 30 } });
    expect(accepted.plan?.requirements?.source).toBe("interpreted");
    expect(accepted.plan?.requirements?.tasks.find((task) => task.id === "kitchen")?.durationMinutes).toBe(30);
    const later = await chat({ message: "Move kitchen to 9:05 AM", history: [], currentPlan: accepted.plan, planDate: "2026-09-19", edit: { taskId: "kitchen", startTime: "9:05 AM" } });
    expect(later.plan?.items.find((item) => item.taskId === "kitchen")?.startTime).toBe("9:05 AM");
    expect(later.plan?.scenarioEdits).toEqual({ kitchen: { durationMinutes: 30 } });
    expect(gateway.converse).not.toHaveBeenCalled();
  });

  it("accepts a safe preset assignee edit when another flexible task is rebalanced", async () => {
    const currentPlan = publishedChores();
    const revised = choresRevision(currentPlan, { kitchen: { assignee: "Sam" }, vacuum: { assignee: "Alex" } });
    const gateway = mockGateway([
      response([{ toolUse: { toolUseId: "rebalance", name: "publish_household_plan", input: revised } }], "tool_use"),
      response([{ toolUse: { toolUseId: "restore", name: "publish_household_plan", input: choresRevision(currentPlan, {}) } }], "tool_use"),
    ]);
    const chat = createChatService({ gateway, logger: vi.fn(), now: () => new Date("2026-09-18T12:00:00Z") });
    const result = await chat({
      message: "Assign kitchen to Sam", history: [], currentPlan, planDate: "2026-09-19",
      edit: { taskId: "kitchen", assignees: ["Sam"] },
    });
    expect(result.plan?.items.find((item) => item.taskId === "kitchen")?.assignee).toBe("Sam");
    expect(result.plan?.items.find((item) => item.taskId === "vacuum")?.assignee).toBe("Alex");
    expect(result.plan?.scenarioEdits).toEqual({ kitchen: { assignees: ["Sam"] } });
    expect(result.plan?.requirements?.source).toBe("interpreted");
    expect(result.plan?.requirements?.tasks.find((task) => task.id === "kitchen")).toMatchObject({
      requiredParticipants: ["Sam"], allowedParticipants: ["Sam"],
    });
    expect(result.plan?.requirements?.workload).toEqual(SCENARIO_REQUIREMENTS.chores.workload);
    const restored = await chat({
      message: "Assign kitchen to Alex", history: [], currentPlan: result.plan, planDate: "2026-09-19",
      edit: { taskId: "kitchen", assignees: ["Alex"] },
    });
    expect(restored.plan?.items.find((item) => item.taskId === "kitchen")?.assignee).toBe("Alex");
    expect(restored.plan?.items.find((item) => item.taskId === "vacuum")?.assignee).toBe("Sam");
    expect(gateway.converse).not.toHaveBeenCalled();
    expect(result.meta).toMatchObject({ provider: "Home Huddle", toolUsed: false, callCount: 0 });
  });

  it("checks a preset end-time edit deterministically without a model call", async () => {
    const currentPlan = publishedChores();
    const gateway = mockGateway([
      response([{ toolUse: { toolUseId: "unchanged-end", name: "publish_household_plan", input: choresRevision(currentPlan, {}) } }], "tool_use"),
      response([{ toolUse: { toolUseId: "shorter-end", name: "publish_household_plan", input: choresRevision(currentPlan, { kitchen: { durationMinutes: 30 } }) } }], "tool_use"),
    ]);
    const result = await createChatService({ gateway, logger: vi.fn(), now: () => new Date("2026-09-18T12:00:00Z") })({
      message: "Set kitchen end to 9:30 AM", history: [], currentPlan, planDate: "2026-09-19",
      edit: { taskId: "kitchen", startTime: "9:00 AM", durationMinutes: 30 },
    });
    expect(result.plan?.items.find((item) => item.taskId === "kitchen")?.durationMinutes).toBe(30);
    expect(result.plan?.requirements?.tasks.find((task) => task.id === "kitchen")?.durationMinutes).toBe(30);
    expect(result.plan?.scenarioEdits).toEqual({ kitchen: { durationMinutes: 30 } });
    expect(gateway.converse).not.toHaveBeenCalled();
  });

  it("recovers from a model that would double-book an assignee by checking a safe swap locally", async () => {
    const currentPlan = publishedChores();
    const conflicting = choresRevision(currentPlan, { kitchen: { assignee: "Sam" } });
    const gateway = mockGateway([
      response([{ toolUse: { toolUseId: "conflict", name: "publish_household_plan", input: conflicting } }], "tool_use"),
      response([{ text: "I cannot safely make that change." }]),
    ]);
    const result = await createChatService({ gateway, logger: vi.fn(), now: () => new Date("2026-09-18T12:00:00Z") })({
      message: "Assign kitchen to Sam", history: [], currentPlan, planDate: "2026-09-19",
      edit: { taskId: "kitchen", assignees: ["Sam"] },
    });
    expect(result.plan?.items.find((item) => item.taskId === "kitchen")?.assignee).toBe("Sam");
    expect(result.plan?.items.find((item) => item.taskId === "vacuum")?.assignee).toBe("Alex");
    expect(gateway.converse).not.toHaveBeenCalled();
  });

  it("rejects a prohibited preset assignee before using Bedrock", async () => {
    const gateway = mockGateway([]);
    await expect(createChatService({ gateway, logger: vi.fn() })({
      message: "Assign kitchen to Riley", history: [], currentPlan: publishedChores(),
      edit: { taskId: "kitchen", assignees: ["Riley"] },
    })).rejects.toMatchObject({ code: "VALIDATION", message: expect.stringContaining("not an allowed assignee") });
    expect(gateway.converse).not.toHaveBeenCalled();
  });

  it("rejects a fixed commitment's duration and assignee before using Bedrock", async () => {
    const currentPlan: HouseholdPlan = {
      ...publishedDraft(), scenarioId: "weekday", requirements: SCENARIO_REQUIREMENTS.weekday,
      participants: ["Maya", "Leo", "Jordan", "Casey"],
      items: [{ id: "task-jordan-call", taskId: "jordan-call", date: "2026-09-21", startTime: "6:30 PM", durationMinutes: 20, task: "Jordan's fixed call", assignee: "Jordan" }],
    };
    const gateway = mockGateway([]);
    const chat = createChatService({ gateway, logger: vi.fn() });
    await expect(chat({ message: "Make Jordan's call 30 minutes", history: [], currentPlan, edit: { taskId: "jordan-call", durationMinutes: 30 } }))
      .rejects.toMatchObject({ code: "VALIDATION", message: expect.stringContaining("required 20-minute duration") });
    await expect(chat({ message: "Assign Jordan's call to Casey", history: [], currentPlan, edit: { taskId: "jordan-call", assignees: ["Casey"] } }))
      .rejects.toMatchObject({ code: "VALIDATION", message: expect.stringContaining("fixed assignees") });
    expect(gateway.converse).not.toHaveBeenCalled();
  });

  it("rejects a saved customized preset whose checklist no longer matches its accepted edit", async () => {
    const currentPlan: HouseholdPlan = {
      ...publishedChores(), scenarioEdits: { kitchen: { durationMinutes: 30 } },
      requirements: { ...SCENARIO_REQUIREMENTS.chores, source: "interpreted" },
      items: publishedChores().items.map((item) => item.taskId === "kitchen" ? { ...item, durationMinutes: 30 } : item),
    };
    const gateway = mockGateway([]);
    await expect(createChatService({ gateway, logger: vi.fn() })({
      message: "Move the first task later", history: [], currentPlan,
    })).rejects.toMatchObject({ code: "VALIDATION", message: expect.stringContaining("saved plan no longer matches") });
    expect(gateway.converse).not.toHaveBeenCalled();
  });
});
