import {
  planDraftSchema,
  type ChatRequest,
  type ChatResponse,
  type HouseholdPlan,
} from "../shared/contracts";
import {
  createBedrockGateway,
  type BedrockGateway,
  type BedrockMessage,
  type BedrockToolResultBlock,
  type BedrockToolUseBlock,
} from "./bedrock";
import { AppError } from "./errors";
import { scheduleIssues } from "./scheduleValidation";

export type ChatService = (request: ChatRequest) => Promise<ChatResponse>;

type ChatServiceOptions = {
  gateway?: BedrockGateway;
  now?: () => Date;
  logger?: (entry: Record<string, unknown>) => void;
};

function isToolUseBlock(block: unknown): block is BedrockToolUseBlock {
  return Boolean(
    block &&
      typeof block === "object" &&
      "toolUse" in block &&
      (block as BedrockToolUseBlock).toolUse,
  );
}

function textFrom(message: BedrockMessage): string {
  return message.content
    .flatMap((block) => ("text" in block ? [block.text.trim()] : []))
    .filter(Boolean)
    .join("\n");
}

function publishPlan(
  input: unknown,
  currentPlan: HouseholdPlan | undefined,
  now: () => Date,
): HouseholdPlan {
  const draft = planDraftSchema.parse(input);
  const version = (currentPlan?.version ?? 0) + 1;

  return {
    ...draft,
    items: draft.items.map((item, index) => ({
      ...item,
      id: `plan-${version}-${index + 1}`,
    })),
    version,
    updatedAt: now().toISOString(),
  };
}

export function createChatService(
  options: ChatServiceOptions = {},
): ChatService {
  const gateway = options.gateway ?? createBedrockGateway();
  const now = options.now ?? (() => new Date());
  const logger = options.logger ?? ((entry) => console.info(JSON.stringify(entry)));

  return async (request) => {
    const startedAt = performance.now();
    const firstUser = request.history.findIndex((message) => message.role === "user");
    const history = firstUser < 0 ? [] : request.history.slice(firstUser);
    const messages: BedrockMessage[] = [
      ...history.map(
        (message): BedrockMessage => ({
          role: message.role,
          content: [{ text: message.text }],
        }),
      ),
      { role: "user", content: [{ text: request.message }] },
    ];

    let invalidToolSeen = false;

    for (let call = 1; call <= 3; call += 1) {
      const callStartedAt = performance.now();
      const response = await gateway.converse(messages, {
        currentPlan: request.currentPlan,
      });
      const assistantMessage = response.output.message;
      const toolBlocks = assistantMessage.content.filter(isToolUseBlock);

      logger({
        event: "bedrock.converse",
        requestId: response.requestId ?? "unavailable",
        modelId: gateway.modelId,
        latencyMs: Math.round(performance.now() - callStartedAt),
        stopReason: response.stopReason,
        toolName: toolBlocks[0]?.toolUse.name ?? "none",
        call,
      });

      messages.push(assistantMessage);

      if (toolBlocks.length === 0) {
        if (invalidToolSeen) {
          throw new AppError(
            "INVALID_TOOL_OUTPUT",
            "The generated plan was incomplete. Please retry your request.",
            { retryable: true, status: 502 },
          );
        }

        return {
          reply: textFrom(assistantMessage) || "What timing should I use for this plan?",
          meta: {
            provider: "Amazon Bedrock",
            modelId: gateway.modelId,
            toolUsed: false,
            latencyMs: Math.round(performance.now() - startedAt),
          },
        };
      }

      if (toolBlocks.length > 1) {
        throw new AppError(
          "TOOL_LOOP",
          "The planning agent could not finish safely. Please try a simpler request.",
          { retryable: true, status: 502 },
        );
      }

      const toolUse = toolBlocks[0].toolUse;
      let result: BedrockToolResultBlock;

      if (toolUse.name !== "publish_household_plan") {
        invalidToolSeen = true;
        result = {
          toolResult: {
            toolUseId: toolUse.toolUseId,
            status: "error",
            content: [{ json: { error: "Unknown tool" } }],
          },
        };
      } else {
        const parsed = planDraftSchema.safeParse(toolUse.input);
        const timingIssues = parsed.success ? scheduleIssues(parsed.data, request) : [];
        if (!parsed.success || timingIssues.length > 0) {
          invalidToolSeen = true;
          result = {
            toolResult: {
              toolUseId: toolUse.toolUseId,
              status: "error",
              content: [
                {
                  json: {
                    error: "Plan failed validation",
                    issues: parsed.success
                      ? timingIssues.map((message) => ({ path: "items", message }))
                      : parsed.error.issues.map((issue) => ({
                          path: issue.path.join("."),
                          message: issue.message,
                        })),
                  },
                },
              ],
            },
          };
        } else {
          const publishedPlan = publishPlan(parsed.data, request.currentPlan, now);
          return {
            reply: textFrom(assistantMessage) || "Your household plan is ready.",
            plan: publishedPlan,
            meta: {
              provider: "Amazon Bedrock",
              modelId: gateway.modelId,
              toolUsed: true,
              latencyMs: Math.round(performance.now() - startedAt),
            },
          };
        }
      }

      if (call === 3) {
        throw new AppError(
          "INVALID_TOOL_OUTPUT",
          "The generated plan was incomplete. Please retry your request.",
          { retryable: true, status: 502 },
        );
      }

      messages.push({ role: "user", content: [result] });
    }

    throw new AppError("TOOL_LOOP", "The planning agent exceeded its call limit.");
  };
}
