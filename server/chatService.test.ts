// @vitest-environment node
import { describe, expect, it, vi } from "vitest";
import type { HouseholdPlan, PlanDraft } from "../shared/contracts";
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
      startTime: "5:30 PM",
      durationMinutes: 30,
      task: "Prepare dinner",
      assignee: "Jordan",
    },
    {
      startTime: "6:00 PM",
      durationMinutes: 45,
      task: "Math homework",
      assignee: "Maya",
    },
  ],
  notes: ["Keep one adult available for homework help."],
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
    expect(result.plan?.items[0].id).toBe("plan-1-1");
    expect(result.reply).toBe("Your household plan is ready.");
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
    expect(result.plan?.items[0].id).toBe("plan-2-1");
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
});
