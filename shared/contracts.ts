import { z } from "zod";

export const historyMessageSchema = z.object({
  role: z.enum(["user", "assistant"]),
  text: z.string().trim().min(1).max(500),
});

export const planItemSchema = z.object({
  id: z.string().min(1),
  startTime: z.string().trim().min(1).max(40),
  durationMinutes: z.number().int().min(1).max(480),
  task: z.string().trim().min(1).max(160),
  assignee: z.string().trim().min(1).max(80),
});

export const householdPlanSchema = z.object({
  title: z.string().trim().min(1).max(100),
  objective: z.string().trim().min(1).max(240),
  participants: z.array(z.string().trim().min(1).max(80)).min(1).max(12),
  items: z.array(planItemSchema).min(1).max(20),
  notes: z.array(z.string().trim().min(1).max(200)).max(8),
  version: z.number().int().positive(),
  updatedAt: z.string().datetime(),
});

export const planDraftSchema = z.object({
  title: z.string().trim().min(1).max(100),
  objective: z.string().trim().min(1).max(240),
  participants: z.array(z.string().trim().min(1).max(80)).min(1).max(12),
  items: z
    .array(
      z.object({
        startTime: z.string().trim().min(1).max(40),
        durationMinutes: z.number().int().min(1).max(480),
        task: z.string().trim().min(1).max(160),
        assignee: z.string().trim().min(1).max(80),
      }),
    )
    .min(1)
    .max(20),
  notes: z.array(z.string().trim().min(1).max(200)).max(8),
});

export const chatRequestSchema = z.object({
  message: z.string().trim().min(1).max(500),
  history: z.array(historyMessageSchema).max(12),
  currentPlan: householdPlanSchema.optional(),
});

export type HistoryMessage = z.infer<typeof historyMessageSchema>;
export type HouseholdPlan = z.infer<typeof householdPlanSchema>;
export type PlanDraft = z.infer<typeof planDraftSchema>;
export type ChatRequest = z.infer<typeof chatRequestSchema>;

export type ChatResponse = {
  reply: string;
  plan?: HouseholdPlan;
  meta: {
    provider: "Amazon Bedrock";
    modelId: string;
    toolUsed: boolean;
    latencyMs: number;
  };
};

export type ChatErrorCode =
  | "VALIDATION"
  | "RATE_LIMIT"
  | "BEDROCK_AUTH"
  | "BEDROCK_TIMEOUT"
  | "BEDROCK_UNAVAILABLE"
  | "INVALID_TOOL_OUTPUT"
  | "TOOL_LOOP";

export type ChatErrorResponse = {
  error: {
    code: ChatErrorCode;
    message: string;
    retryable: boolean;
  };
};
