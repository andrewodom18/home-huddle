import { z } from "zod";

export const isoDateSchema = z.iso.date();

export const historyMessageSchema = z.object({
  role: z.enum(["user", "assistant"]),
  text: z.string().trim().min(1).max(1000),
});

export const planItemSchema = z.object({
  id: z.string().min(1),
  taskId: z.string().trim().min(1).max(64).optional(),
  details: z.string().max(500).optional(),
  date: isoDateSchema.optional(),
  startTime: z.string().trim().min(1).max(40),
  durationMinutes: z.number().int().min(1).max(480),
  task: z.string().trim().min(1).max(160),
  assignee: z.string().trim().min(1).max(80),
});

export const taskIdSchema = z.string().trim().regex(/^[a-z][a-z0-9_-]{0,63}$/);

export const planRequirementsSchema = z.object({
  source: z.enum(["scenario", "interpreted"]),
  timeWindow: z.object({
    startTime: z.string().trim().min(1).max(40),
    endTime: z.string().trim().min(1).max(40),
  }),
  timeWindows: z.array(z.object({ date: isoDateSchema, startTime: z.string().trim().min(1).max(40), endTime: z.string().trim().min(1).max(40) })).max(20).optional(),
  assumptions: z.array(z.string().trim().min(1).max(240)).max(12).optional(),
  availability: z.array(z.object({ participant: z.string().trim().min(1).max(80), date: isoDateSchema.optional(), startTime: z.string().min(1).max(40), endTime: z.string().min(1).max(40) })).max(48).optional(),
  resources: z.array(z.object({ id: taskIdSchema, label: z.string().trim().min(1).max(80), capacity: z.number().int().min(1).max(12) })).max(12).optional().describe("Declare every shared machine, vehicle, room, or other limited resource and its simultaneous capacity. Also attach its ID and units to every task that uses it."),
  preferences: z.array(z.object({ description: z.string().trim().min(1).max(240), kind: z.enum(["earlier_finish", "balanced_workload", "minimize_changes"]) })).max(8).optional(),
  tasks: z.array(z.object({
    id: taskIdSchema,
    date: isoDateSchema.optional(),
    fixedDate: z.boolean().optional(),
    label: z.string().trim().min(1).max(160),
    durationMinutes: z.number().int().min(1).max(480),
    kind: z.enum(["task", "break", "travel"]).optional(),
    resources: z.array(z.object({ resourceId: taskIdSchema, units: z.number().int().min(1).max(12) })).max(12).optional().describe("Required capacity occupied for this whole task. Include each shared resource this activity explicitly needs; declaring the resource at plan level alone does not enforce a conflict."),
    requiredParticipants: z.array(z.string().trim().min(1).max(80)).max(12).optional(),
    atLeastOneOf: z.array(z.string().trim().min(1).max(80)).max(12).optional(),
    allowedParticipants: z.array(z.string().trim().min(1).max(80)).max(12).optional(),
    forbiddenParticipants: z.array(z.string().trim().min(1).max(80)).max(12).optional(),
    fixedStartTime: z.string().trim().min(1).max(40).optional(),
    earliestStartTime: z.string().trim().min(1).max(40).optional(),
    latestEndTime: z.string().trim().min(1).max(40).optional(),
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

export const requirementChangeSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("add_task"), task: planRequirementsSchema.shape.tasks.element }),
  z.object({ kind: z.literal("remove_task"), taskId: taskIdSchema }),
  z.object({ kind: z.literal("update_task"), taskId: taskIdSchema, task: planRequirementsSchema.shape.tasks.element }),
  z.object({ kind: z.literal("constraints"), fields: planRequirementsSchema.omit({ source: true, tasks: true }).partial().extend({ workload: planRequirementsSchema.shape.workload.nullable() }), clear: z.array(z.enum(["workload", "availability", "resources", "ordering", "gaps", "preferences", "assumptions", "timeWindows"])).max(8).optional() }),
]);
export const requirementChangesSchema = z.array(requirementChangeSchema).min(1).max(20);
export type RequirementChange = z.infer<typeof requirementChangeSchema>;

export const interpretedPlanSchema = z.object({
  title: z.string().trim().min(1).max(100),
  objective: z.string().trim().min(1).max(240),
  participants: z.array(z.string().trim().min(1).max(80)).min(1).max(12),
  requirements: planRequirementsSchema,
});
export const planningOutcomeSchema = z.object({
  outcome: z.enum(["clarification", "conflict"]),
  message: z.string().trim().min(1).max(1000),
});

export const householdPlanSchema = z.object({
  scenarioId: z.enum(["weekday", "chores", "outing"]).optional(),
  scenarioAnchor: isoDateSchema.optional(),
  // Accepted, explicit departures from a preset's editable task defaults.
  // These are checked against the canonical scenario on later revisions.
  scenarioEdits: z.record(taskIdSchema, z.object({
    durationMinutes: z.number().int().min(1).max(480).optional(),
    assignees: z.array(z.string().trim().min(1).max(80)).min(1).max(12).optional(),
  })).optional(),
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
        date: isoDateSchema.optional(),
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

export const scheduleEditSchema = z.object({
  taskId: taskIdSchema,
  date: isoDateSchema.optional(),
  startTime: z.string().trim().min(1).max(40).optional(),
  durationMinutes: z.number().int().min(1).max(480).optional(),
  assignees: z.array(z.string().trim().min(1).max(80)).min(1).max(12).optional(),
}).refine((edit) => edit.date !== undefined || edit.startTime !== undefined || edit.durationMinutes !== undefined || edit.assignees !== undefined, {
  message: "Change at least one schedule field.",
});

export const chatRequestSchema = z.object({
  message: z.string().trim().min(1).max(1000),
  history: z.array(historyMessageSchema).max(12),
  currentPlan: householdPlanSchema.optional(),
  scenarioId: z.enum(["weekday", "chores", "outing"]).optional(),
  planDate: isoDateSchema.optional(),
  timeZone: z.string().min(1).max(80).refine((zone) => {
    try {
      new Intl.DateTimeFormat("en-US", { timeZone: zone });
      return true;
    } catch {
      return false;
    }
  }, "Choose a valid IANA time zone.").optional(),
  edit: scheduleEditSchema.optional(),
  changes: requirementChangesSchema.optional(),
});

export type HistoryMessage = z.infer<typeof historyMessageSchema>;
export type HouseholdPlan = z.infer<typeof householdPlanSchema>;
export type PlanDraft = z.infer<typeof planDraftSchema>;
export type PlanRequirements = z.infer<typeof planRequirementsSchema>;
export type ScheduleEdit = z.infer<typeof scheduleEditSchema>;
export type ChatRequest = z.infer<typeof chatRequestSchema>;

export const chatMetaSchema = z.object({
  provider: z.enum(["Amazon Bedrock", "Home Huddle"]),
  modelId: z.string().min(1).max(200),
  toolUsed: z.boolean(),
  latencyMs: z.number().finite().nonnegative(),
  callCount: z.number().int().min(0).max(3).optional(),
  stage: z.enum(["interpret", "revise", "schedule"]).optional(),
});
export const chatResponseSchema = z.object({
  reply: z.string().trim().min(1).max(4000),
  plan: householdPlanSchema.optional(),
  outcome: z.enum(["plan", "clarification", "conflict"]).optional(),
  meta: chatMetaSchema,
}).refine((response) => response.outcome !== "plan" || Boolean(response.plan), { message: "A plan outcome must include a plan." });
export type ChatResponse = z.infer<typeof chatResponseSchema>;
export const callDiagnosticsSchema = z.object({
  callCount: z.number().int().min(0).max(3),
  stage: z.enum(["interpret", "revise", "schedule"]),
  stopReason: z.string().max(80).optional(),
});
export type CallDiagnostics = z.infer<typeof callDiagnosticsSchema>;

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
    diagnostics?: CallDiagnostics;
  };
};
