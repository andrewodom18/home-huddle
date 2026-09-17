import {
  planDraftSchema,
  type ChatRequest,
  type ChatResponse,
  type HouseholdPlan,
  type PlanDraft,
  type PlanRequirements,
} from "../shared/contracts";
import { isDeepStrictEqual } from "node:util";
import { scenarioRequirements } from "../shared/scenarios";
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
  draft: PlanDraft,
  requirements: PlanRequirements,
  currentPlan: HouseholdPlan | undefined,
  scenarioId: ChatRequest["scenarioId"],
  now: () => Date,
): HouseholdPlan {
  const version = (currentPlan?.version ?? 0) + 1;

  return {
    ...draft,
    items: draft.items.map((item, index) => ({
      ...item,
      task: requirements.tasks.find((task) => task.id === item.taskId)?.label ?? item.task,
      id: item.taskId ? `task-${item.taskId}` : `plan-${version}-${index + 1}`,
    })),
    requirements,
    scenarioId,
    version,
    updatedAt: now().toISOString(),
  };
}

function requirementIssues(previous: PlanRequirements, next: PlanRequirements, message = ""): string[] {
  const issues: string[] = [];
  const correction = /^Correct requirement ([a-z][a-z0-9-]{0,63}):\s+.+/i.exec(message.trim());
  const windowCorrection = /^Correct time window:\s+.+/i.test(message.trim());
  if (!isDeepStrictEqual(previous.timeWindow, next.timeWindow) && !(previous.source === "interpreted" && windowCorrection)) {
    issues.push("The established planning window changed. Use the checklist correction action to change it.");
  }
  for (const prior of previous.tasks) {
    const proposed = next.tasks.find((task) => task.id === prior.id);
    if (!proposed || (!isDeepStrictEqual(prior, proposed) && !(previous.source === "interpreted" && correction?.[1] === prior.id))) {
      issues.push(`${prior.label}: preserve its established requirement or use its checklist correction action`);
    }
  }
  for (const field of ["ordering", "gaps"] as const) {
    const existing = previous[field] ?? [];
    const proposed = next[field] ?? [];
    for (const relation of existing) {
      if (!proposed.some((candidate) => isDeepStrictEqual(candidate, relation))) issues.push(`Preserve the existing ${field} requirement`);
    }
  }
  if (previous.workload && !isDeepStrictEqual(previous.workload, next.workload)) issues.push("Preserve the established workload limits");
  return issues;
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
    let lastIssue = "The schedule did not satisfy its requirements.";
    const scenarioId = request.scenarioId ?? request.currentPlan?.scenarioId;
    const canonical = scenarioRequirements(scenarioId);
    const priorRequirements = request.currentPlan?.requirements;
    const sameScenario = Boolean(canonical && priorRequirements && request.currentPlan?.scenarioId === scenarioId);
    const priorScenarioIssues = sameScenario ? requirementIssues(canonical!, priorRequirements!) : [];
    if (priorScenarioIssues.length > 0) {
      throw new AppError("VALIDATION", "The saved plan no longer matches this scenario's required constraints. Start a new plan to restore them.", { status: 400 });
    }
    const requiredContext = sameScenario ? priorRequirements : canonical ?? priorRequirements;

    for (let call = 1; call <= 3; call += 1) {
      const callStartedAt = performance.now();
      const response = await gateway.converse(messages, {
        currentPlan: request.currentPlan,
        requirements: requiredContext,
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
            `I couldn't publish this plan: ${lastIssue}`,
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
        const proposed = parsed.success ? parsed.data.requirements : undefined;
        const requirements = canonical && !sameScenario ? canonical : proposed ?? requiredContext;
        const conflicts = parsed.success && requiredContext && proposed && (!canonical || sameScenario)
          ? requirementIssues(requiredContext, proposed, request.message)
          : [];
        const timingIssues = parsed.success && requirements ? scheduleIssues(parsed.data, request, requirements) : [];
        if (parsed.success && !requirements) timingIssues.unshift("Include the interpreted requirements checklist before publishing this plan");
        if (parsed.success && !canonical && requirements && requirements.source !== "interpreted") timingIssues.unshift("Free-text requirements must be labeled as model-interpreted");
        const buffer = /\badd a (\d{1,2})-minute transition buffer\b/i.exec(request.message);
        if (parsed.success && buffer && requirements && !requirements.gaps?.some((gap) => gap.minMinutes >= Number(buffer[1]))) {
          timingIssues.unshift(`Name the two affected tasks in a ${buffer[1]}-minute gap requirement`);
        }
        if (!parsed.success || conflicts.length > 0 || timingIssues.length > 0) {
          invalidToolSeen = true;
          lastIssue = conflicts[0] ?? timingIssues[0] ?? "The plan is missing required fields.";
          result = {
            toolResult: {
              toolUseId: toolUse.toolUseId,
              status: "error",
              content: [
                {
                  json: {
                    error: "Plan failed validation",
                    issues: parsed.success
                      ? [...conflicts, ...timingIssues].map((message) => ({ path: "plan", message }))
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
          const publishedPlan = publishPlan(parsed.data, requirements!, request.currentPlan, scenarioId, now);
          return {
            reply: requirements!.source === "interpreted"
              ? "I made a plan from the interpreted requirements shown below. Please review them; only the captured requirements were checked."
              : textFrom(assistantMessage) || "Your household plan is ready.",
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
          `I couldn't publish this plan: ${lastIssue}`,
          { retryable: true, status: 502 },
        );
      }

      messages.push({ role: "user", content: [result] });
    }

    throw new AppError("TOOL_LOOP", "The planning agent exceeded its call limit.");
  };
}
