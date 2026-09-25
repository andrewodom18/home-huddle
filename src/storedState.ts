import { z } from "zod";
import { chatRequestSchema, chatMetaSchema, householdPlanSchema, type ChatRequest, type ChatResponse, type HouseholdPlan } from "../shared/contracts";
import type { DisplayMessage } from "conversation-display-kit";
import { isValidPlanDate, planDates } from "./planDate";

export const STORAGE_KEY = "home-huddle-state-v2";
export const OLD_STORAGE_KEY = "home-huddle-state-v1";
export type ConversationMessage = DisplayMessage & { contextText?: string; localOnly?: boolean };
export type FailedRequest = { request: ChatRequest; message: string; retryable: boolean };
export type StoredState = {
  messages: ConversationMessage[];
  plan?: HouseholdPlan;
  draftPlan?: HouseholdPlan;
  draftSourceMessage?: string;
  draftNeedsResolution?: boolean;
  draftCorrectionStartId?: string;
  proposal?: HouseholdPlan;
  proposalDate?: string;
  undoPlan?: HouseholdPlan;
  undoDate?: string;
  scenarioId?: ChatRequest["scenarioId"];
  calendarDate?: string;
  timeZone?: string;
  meta?: ChatResponse["meta"];
  failure?: FailedRequest | null;
};
export const WELCOME_MESSAGE: ConversationMessage = {
  id: "welcome", role: "assistant",
  text: "Tell me who is involved, what needs to happen, and the time you have. I’ll shape it into a plan everyone can follow.",
};
const messageSchema = z.object({ id: z.string().min(1), role: z.enum(["user", "assistant"]), text: z.string().min(1).max(8000), contextText: z.string().max(1000).optional(), localOnly: z.boolean().optional() });
const failureSchema = z.object({ request: chatRequestSchema, message: z.string().min(1).max(2000), retryable: z.boolean() });
const dateSchema = z.string().refine(isValidPlanDate);
const zoneSchema = chatRequestSchema.shape.timeZone;

export function loadState(): StoredState & { warning?: string } {
  let raw: string | null;
  try { raw = window.localStorage.getItem(STORAGE_KEY) ?? window.localStorage.getItem(OLD_STORAGE_KEY); }
  catch { return { messages: [WELCOME_MESSAGE], warning: "Browser storage is unavailable. Your plan will stay in memory for this visit only." }; }
  if (!raw) return { messages: [WELCOME_MESSAGE] };
  let stored: Record<string, unknown>;
  try {
    const value: unknown = JSON.parse(raw);
    if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Invalid saved state");
    stored = value as Record<string, unknown>;
  } catch { return { messages: [WELCOME_MESSAGE], warning: "The saved conversation could not be read. Start a new plan; this visit is ready to use." }; }
  let recovered = false;
  function optional<T>(value: unknown, schema: z.ZodType<T>): T | undefined {
    if (value === undefined || value === null) return undefined;
    const result = schema.safeParse(value);
    if (result.success) return result.data;
    recovered = true;
    return undefined;
  }
  const messages = Array.isArray(stored.messages) ? stored.messages.slice(-13).flatMap((value) => {
    const parsed = optional(value, messageSchema);
    return parsed ? [{ ...parsed, text: parsed.contextText || parsed.text }] : [];
  }) : [];
  if (!Array.isArray(stored.messages)) recovered = true;
  const savedDate = optional(stored.calendarDate, dateSchema);
  const proposalDate = optional(stored.proposalDate, dateSchema);
  const undoDate = optional(stored.undoDate, dateSchema);
  const migrate = (value: unknown, fallback?: string) => {
    const parsed = optional(value, householdPlanSchema);
    return parsed && { ...parsed, items: parsed.items.map((item) => ({ ...item, date: item.date ?? fallback })) };
  };
  const plan = migrate(stored.plan, savedDate);
  const possibleDraft = migrate(stored.draftPlan, savedDate);
  const draftSourceMessage = optional(stored.draftSourceMessage, z.string().trim().min(1).max(1000));
  const draftNeedsResolution = optional(stored.draftNeedsResolution, z.boolean()) ?? false;
  const draftCorrectionStartId = optional(stored.draftCorrectionStartId, z.string().min(1).max(120));
  const draftPlan = !plan && possibleDraft?.requirements?.source === "interpreted" && draftSourceMessage
    ? possibleDraft : undefined;
  if (possibleDraft && !draftPlan || draftSourceMessage && !draftPlan) recovered = true;
  const proposal = migrate(stored.proposal, proposalDate ?? savedDate);
  const undoPlan = migrate(stored.undoPlan, undoDate ?? savedDate);
  const timeZone = optional(stored.timeZone, zoneSchema);
  const meta = optional(stored.meta, chatMetaSchema);
  const failure = optional(stored.failure, failureSchema);
  const scenarioId = optional(stored.scenarioId, chatRequestSchema.shape.scenarioId);
  if (!plan && (proposal || undoPlan)) recovered = true;
  return {
    messages: messages.length ? messages : [WELCOME_MESSAGE], plan, draftPlan,
    draftSourceMessage: draftPlan ? draftSourceMessage : undefined,
    draftNeedsResolution: draftPlan && draftNeedsResolution,
    draftCorrectionStartId: draftPlan ? draftCorrectionStartId : undefined,
    proposal: plan ? proposal : undefined, proposalDate: plan && proposal ? proposalDate : undefined,
    undoPlan: plan ? undoPlan : undefined, undoDate: plan && undoPlan ? undoDate : undefined,
    calendarDate: plan && savedDate ? planDates(plan, savedDate)[0] : savedDate,
    timeZone, meta, scenarioId: plan?.scenarioId ?? (stored.plan && !plan ? undefined : scenarioId),
    failure: recovered ? null : failure,
    warning: recovered ? "Some saved information was invalid and was removed. Review the recovered plan before continuing." : undefined,
  };
}
