import { z } from "zod";

export const historyMessageSchema = z.object({
  role: z.enum(["user", "assistant"]),
  text: z.string().trim().min(1).max(500),
});

export const planItemSchema = z.object({
  id: z.string().min(1),
  taskId: z.string().trim().min(1).max(64).optional(),
  startTime: z.string().trim().min(1).max(40),
  durationMinutes: z.number().int().min(1).max(480),
  task: z.string().trim().min(1).max(160),
  assignee: z.string().trim().min(1).max(80),
});

const taskIdSchema = z.string().trim().regex(/^[a-z][a-z0-9_-]{0,63}$/);

export const planRequirementsSchema = z.object({
  source: z.enum(["scenario", "interpreted"]),
  timeWindow: z.object({
    startTime: z.string().trim().min(1).max(40),
    endTime: z.string().trim().min(1).max(40),
  }),
  tasks: z.array(z.object({
    id: taskIdSchema,
    label: z.string().trim().min(1).max(160),
    durationMinutes: z.number().int().min(1).max(480),
    kind: z.enum(["task", "break", "travel"]).optional(),
    requiredParticipants: z.array(z.string().trim().min(1).max(80)).max(12).optional(),
    atLeastOneOf: z.array(z.string().trim().min(1).max(80)).max(12).optional(),
    allowedParticipants: z.array(z.string().trim().min(1).max(80)).max(12).optional(),
    forbiddenParticipants: z.array(z.string().trim().min(1).max(80)).max(12).optional(),
    fixedStartTime: z.string().trim().min(1).max(40).optional(),
  })).min(1).max(20),
  ordering: z.array(z.object({ beforeTaskId: taskIdSchema, afterTaskId: taskIdSchema })).max(30).optional(),
  gaps: z.array(z.object({ afterTaskId: taskIdSchema, beforeTaskId: taskIdSchema, minMinutes: z.number().int().min(1).max(120) })).max(20).optional(),
  workload: z.object({
    participants: z.array(z.string().trim().min(1).max(80)).min(1).max(12),
    minMinutes: z.number().int().min(0).max(480),
    maxMinutes: z.number().int().min(1).max(480),
    excludeTaskIds: z.array(taskIdSchema).max(20).optional(),
  }).optional(),
});

export const householdPlanSchema = z.object({
  scenarioId: z.enum(["weekday", "chores", "outing"]).optional(),
  title: z.string().trim().min(1).max(100),
  objective: z.string().trim().min(1).max(240),
  participants: z.array(z.string().trim().min(1).max(80)).min(1).max(12),
  items: z.array(planItemSchema).min(1).max(20),
  requirements: planRequirementsSchema.optional(),
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
        taskId: taskIdSchema.optional(),
        startTime: z.string().trim().min(1).max(40),
        durationMinutes: z.number().int().min(1).max(480),
        task: z.string().trim().min(1).max(160),
        assignee: z.string().trim().min(1).max(80),
      }),
    )
    .min(1)
    .max(20),
  notes: z.array(z.string().trim().min(1).max(200)).max(8),
  requirements: planRequirementsSchema.optional(),
});

export const chatRequestSchema = z.object({
  message: z.string().trim().min(1).max(500),
  history: z.array(historyMessageSchema).max(12),
  currentPlan: householdPlanSchema.optional(),
  scenarioId: z.enum(["weekday", "chores", "outing"]).optional(),
});

export type HistoryMessage = z.infer<typeof historyMessageSchema>;
export type HouseholdPlan = z.infer<typeof householdPlanSchema>;
export type PlanDraft = z.infer<typeof planDraftSchema>;
export type PlanRequirements = z.infer<typeof planRequirementsSchema>;
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
