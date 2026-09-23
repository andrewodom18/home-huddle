import {
  planDraftSchema,
  interpretedPlanSchema,
  requirementChangesSchema,
  planningOutcomeSchema,
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
import { applyRequirementChanges, explicitAvailabilityChanges, fixedCommitmentConflict, naturalChangeIssues, requirementsIssues } from "./requirements";
import { AppError } from "./errors";
import { repairScheduleTiming } from "./scheduleRepair";
import { orderingCaptureIssues, resourceCaptureIssues } from "./captureValidation";
import { shortenSchedule } from "./scheduleOptimization";
import { assignedPeople, minutes, scheduleIssues } from "./scheduleValidation";
import { localNow, pastEventIssue, pastScheduleIssues } from "./pastSchedule";
import {
  isUnverifiedEventEditRequest,
  naturalRevisionIntent,
  preflightRevisionIssues,
  revisionIntentIssues,
  structuredRevisionIntent,
  type RevisionIntent,
} from "./revisionIntent";

export type ChatService = (request: ChatRequest) => Promise<ChatResponse>;

type ChatServiceOptions = {
  gateway?: BedrockGateway;
  now?: () => Date;
  logger?: (entry: Record<string, unknown>) => void;
};

type ScenarioEdits = NonNullable<HouseholdPlan["scenarioEdits"]>;

function normalizeClock(value: unknown): unknown {
  if (typeof value !== "string") return value;
  const text = value.trim();
  if (/^noon$/i.test(text)) return "12:00 PM";
  if (/^midnight$/i.test(text)) return "12:00 AM";
  const twelve = /^(0?[1-9]|1[0-2])(?::([0-5]\d))?\s*([ap])\.?m\.?$/i.exec(text);
  if (twelve) return `${Number(twelve[1])}:${twelve[2] ?? "00"} ${twelve[3].toUpperCase()}M`;
  const clock = /^([01]?\d|2[0-3]):([0-5]\d)$/.exec(text);
  if (!clock) return value;
  const hour = Number(clock[1]);
  return `${hour % 12 || 12}:${clock[2]} ${hour >= 12 ? "PM" : "AM"}`;
}

function normalizeToolTimes(input: unknown): unknown {
  if (!input || typeof input !== "object" || Array.isArray(input)) return input;
  const plan = input as Record<string, unknown>;
  const clockFields = (value: unknown, fields: string[]): unknown => {
    if (!value || typeof value !== "object" || Array.isArray(value)) return value;
    const record = value as Record<string, unknown>;
    return Object.fromEntries(Object.entries(record).map(([key, entry]) => [key, fields.includes(key) ? normalizeClock(entry) : entry]));
  };
  const checklist = plan.requirements && typeof plan.requirements === "object" && !Array.isArray(plan.requirements)
    ? plan.requirements as Record<string, unknown>
    : undefined;
  return {
    ...plan,
    items: Array.isArray(plan.items) ? plan.items.map((item) => clockFields(item, ["startTime"])) : plan.items,
    requirements: checklist ? {
      ...checklist,
      timeWindow: clockFields(checklist.timeWindow, ["startTime", "endTime"]),
      timeWindows: Array.isArray(checklist.timeWindows)
        ? checklist.timeWindows.map((window) => clockFields(window, ["startTime", "endTime"]))
        : checklist.timeWindows,
      availability: Array.isArray(checklist.availability)
        ? checklist.availability.map((window) => clockFields(window, ["startTime", "endTime"]))
        : checklist.availability,
      tasks: Array.isArray(checklist.tasks)
        ? checklist.tasks.map((task) => clockFields(task, ["fixedStartTime", "earliestStartTime", "latestEndTime"]))
        : checklist.tasks,
    } : plan.requirements,
  };
}

function normalizeChangeTimes(input: unknown): unknown {
  if (!input || typeof input !== "object" || !("changes" in input) || !Array.isArray(input.changes)) return input;
  return { ...input, changes: input.changes.map((entry: unknown) => {
    if (!entry || typeof entry !== "object") return entry;
    const change = entry as Record<string, unknown>;
    if (change.kind === "add_task" || change.kind === "update_task") {
      const normalized = normalizeToolTimes({ requirements: { tasks: [change.task] } }) as { requirements: { tasks: unknown[] } };
      return { ...change, task: normalized.requirements.tasks[0] };
    }
    if (change.kind === "constraints" && change.fields && typeof change.fields === "object") {
      const normalized = normalizeToolTimes({ requirements: change.fields }) as { requirements: Record<string, unknown> };
      return { ...change, fields: Object.fromEntries(Object.entries(normalized.requirements).filter(([, value]) => value !== undefined)) };
    }
    return change;
  }) };
}

function requiresChecklistRevision(message: string): boolean {
  return /\b(?:add|include|remove|cancel|delete|drop|skip|availability|available|resource|capacity|workload|preference)\b|\b(?:time|planning) window\b|\b(?:reduce|change)\b.*\b(?:gap|buffer|transition)\b/i.test(message)
    && (!/\b(?:gap|buffer|transition)\b/i.test(message) || /\b(?:remove|cancel|delete|drop|reduce|change)\b/i.test(message));
}

function exactAssigneeRequirement<T extends PlanRequirements["tasks"][number]>(task: T, assignees: string[]): T {
  // An explicit reassignment may replace who is required, but the canonical
  // eligibility rules are checked first and are never widened.
  const rest = { ...task };
  delete rest.atLeastOneOf;
  return {
    ...rest,
    requiredParticipants: assignees,
    allowedParticipants: assignees,
  } as T;
}

function scenarioEditIssues(canonical: PlanRequirements, plan: HouseholdPlan): string[] {
  const edits = plan.scenarioEdits ?? {};
  const issues: string[] = [];
  if (Object.keys(edits).length && plan.requirements?.source !== "interpreted") {
    issues.push("Customized examples must be labeled as interpreted, not canonical");
  }
  for (const [id, edit] of Object.entries(edits)) {
    const task = canonical.tasks.find((candidate) => candidate.id === id);
    if (!task) { issues.push(`Unknown scenario edit: ${id}`); continue; }
    if (task.fixedDate || task.fixedStartTime) issues.push(`${task.label} is a fixed commitment`);
    if (edit.durationMinutes === undefined && !edit.assignees) issues.push(`${task.label} has an empty scenario edit`);
    if (edit.assignees) {
      if (new Set(edit.assignees.map((person) => person.toLowerCase())).size !== edit.assignees.length) issues.push(`${task.label} has duplicate assignees`);
      for (const person of edit.assignees) {
        if (!plan.participants.includes(person)) issues.push(`${task.label}: ${person} is not a listed participant`);
        if (task.allowedParticipants && !task.allowedParticipants.includes(person)) issues.push(`${task.label}: ${person} is not an allowed assignee`);
        if (task.forbiddenParticipants?.includes(person)) issues.push(`${task.label}: do not assign ${person}`);
      }
    }
    const item = plan.items.find((candidate) => candidate.taskId === id);
    if (!item) issues.push(`${task.label}: saved scenario edit has no matching event`);
    if (edit.durationMinutes !== undefined && item?.durationMinutes !== edit.durationMinutes) issues.push(`${task.label}: saved duration does not match its edit`);
    if (edit.assignees && item) {
      const actual = assignedPeople(item.assignee, plan.participants);
      if (actual.length !== edit.assignees.length || !edit.assignees.every((person) => actual.some((name) => name.toLowerCase() === person.toLowerCase()))) issues.push(`${task.label}: saved assignees do not match its edit`);
    }
  }
  return issues;
}

function canonicalWithScenarioEdits(canonical: PlanRequirements, edits: ScenarioEdits): PlanRequirements {
  return {
    ...canonical,
    source: Object.keys(edits).length ? "interpreted" : canonical.source,
    tasks: canonical.tasks.map((task) => {
      const edit = edits[task.id];
      if (!edit) return task;
      const revised = edit.assignees ? exactAssigneeRequirement(task, edit.assignees) : task;
      return edit.durationMinutes === undefined ? revised : { ...revised, durationMinutes: edit.durationMinutes };
    }),
  };
}

function nextScenarioEdits(current: ScenarioEdits, intent: RevisionIntent, canonical: PlanRequirements): ScenarioEdits {
  const next = structuredClone(current);
  if (intent.durationMinutes === undefined && !intent.assignees) return next;
  const base = canonical.tasks.find((task) => task.id === intent.taskId);
  if (!base) return next;
  const edit = { ...next[intent.taskId] };
  if (intent.durationMinutes !== undefined) {
    if (intent.durationMinutes === base.durationMinutes) delete edit.durationMinutes;
    else edit.durationMinutes = intent.durationMinutes;
  }
  if (intent.assignees) edit.assignees = intent.assignees;
  if (edit.durationMinutes === undefined && !edit.assignees) delete next[intent.taskId];
  else next[intent.taskId] = edit;
  return next;
}

function directEditDraft(
  current: HouseholdPlan,
  intent: RevisionIntent,
  requirements: PlanRequirements,
  request: ChatRequest,
  now: Date,
): PlanDraft | undefined {
  const formatStart = (value: number) => `${Math.floor(value / 60) % 12 || 12}:${String(value % 60).padStart(2, "0")} ${value >= 720 ? "PM" : "AM"}`;
  const selected = current.items.find((item) => item.taskId === intent.taskId);
  if (!selected) return undefined;
  const base: PlanDraft = {
    title: current.title, objective: current.objective, participants: current.participants,
    notes: [], requirements,
    items: current.items.map(({ taskId, date, startTime, durationMinutes, task, assignee }) => ({
      taskId, date: taskId === intent.taskId ? intent.date ?? date : date,
      startTime: taskId === intent.taskId && intent.start?.kind === "exact" ? formatStart(intent.start.value) : startTime,
      durationMinutes: taskId === intent.taskId ? intent.durationMinutes ?? durationMinutes : durationMinutes,
      task, assignee: taskId === intent.taskId && intent.assignees ? intent.assignees.join(", ") : assignee,
    })),
  };
  const valid = (draft: PlanDraft) => scheduleIssues(draft, request, requirements).length === 0
    && pastScheduleIssues(draft, request, now).length === 0
    && revisionIntentIssues(draft, current, intent).length === 0;
  if (valid(base)) return base;
  if (!intent.assignees || intent.date || intent.start || intent.durationMinutes !== undefined) return undefined;

  // Resolve a single parallel-work collision by reassigning one flexible,
  // single-person activity. Every candidate still passes the full validator.
  const start = minutes(selected.startTime);
  if (start === undefined) return undefined;
  for (const [index, other] of current.items.entries()) {
    if (other.taskId === intent.taskId || other.date !== selected.date) continue;
    const otherStart = minutes(other.startTime);
    const people = assignedPeople(other.assignee, current.participants);
    const rule = requirements.tasks.find((task) => task.id === other.taskId);
    if (!rule || rule.fixedDate || rule.fixedStartTime || otherStart === undefined || people.length !== 1
      || !intent.assignees.includes(people[0])
      || start >= otherStart + other.durationMinutes || otherStart >= start + selected.durationMinutes) continue;
    for (const person of current.participants) {
      if (people.includes(person) || intent.assignees.includes(person)
        || rule.allowedParticipants && !rule.allowedParticipants.includes(person)
        || rule.forbiddenParticipants?.includes(person)
        || rule.requiredParticipants?.some((required) => required !== person)
        || rule.atLeastOneOf && !rule.atLeastOneOf.includes(person)) continue;
      const proposed = {
        ...base,
        items: base.items.map((item, candidate) => candidate === index ? { ...item, assignee: person } : item),
      };
      if (valid(proposed)) return proposed;
    }
  }
  return undefined;
}

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
  planDate: string | undefined,
  now: () => Date,
  requestedRevision?: RevisionIntent,
  scenarioEdits?: ScenarioEdits,
): HouseholdPlan {
  const version = (currentPlan?.version ?? 0) + 1;

  return {
    ...draft,
    title: requestedRevision && currentPlan ? currentPlan.title : draft.title,
    objective: requestedRevision && currentPlan ? currentPlan.objective : draft.objective,
    items: draft.items.map((item, index) => ({
      ...item,
      date: item.date ?? requirements.tasks.find((task) => task.id === item.taskId)?.date ?? currentPlan?.items.find((previous) => previous.taskId === item.taskId)?.date ?? planDate,
      task: requirements.tasks.find((task) => task.id === item.taskId)?.label ?? item.task,
      id: item.taskId ? `task-${item.taskId}` : `plan-${version}-${index + 1}`,
      details: item.taskId ? currentPlan?.items.find((previous) => previous.taskId === item.taskId)?.details : undefined,
    })),
    // Model-written notes are not checked against the validated calendar.
    notes: [],
    requirements,
    scenarioId,
    scenarioAnchor: scenarioId ? currentPlan ? currentPlan.scenarioAnchor : planDate : undefined,
    scenarioEdits: scenarioId && scenarioEdits && Object.keys(scenarioEdits).length ? scenarioEdits : undefined,
    version,
    updatedAt: now().toISOString(),
  };
}

function requirementIssues(
  previous: PlanRequirements,
  next: PlanRequirements,
  message = "",
  allowedDuration?: RevisionIntent,
  allowPriorScenarioDateChanges = false,
): string[] {
  const issues: string[] = [];
  const correction = /^Correct requirement ([a-z][a-z0-9_-]{0,63}):\s+.+/i.exec(message.trim());
  const windowCorrection = /^Correct time window:\s+.+/i.test(message.trim());
  if (!isDeepStrictEqual(previous.timeWindow, next.timeWindow) && !(previous.source === "interpreted" && windowCorrection)) {
    issues.push("The established planning window changed. Use the checklist correction action to change it.");
  }
  if (!isDeepStrictEqual(previous.timeWindows ?? [], next.timeWindows ?? []) && !(previous.source === "interpreted" && windowCorrection)) {
    issues.push("The established date-specific planning windows changed. Use the checklist correction action to change them.");
  }
  for (const prior of previous.tasks) {
    const proposed = next.tasks.find((task) => task.id === prior.id);
    const exactDurationCorrection = previous.source === "interpreted"
      && prior.id === allowedDuration?.taskId
      && allowedDuration.durationMinutes !== undefined
      && proposed && isDeepStrictEqual(proposed, { ...prior, durationMinutes: allowedDuration.durationMinutes });
    const exactDateCorrection = (previous.source === "interpreted" || previous.source === "scenario")
      && prior.id === allowedDuration?.taskId
      && allowedDuration.date !== undefined
      && !prior.fixedDate
      && proposed && isDeepStrictEqual(proposed, { ...prior, date: allowedDuration.date });
    const savedScenarioDateChange = allowPriorScenarioDateChanges && previous.source === "scenario" && !prior.fixedDate
      && proposed?.date !== undefined && isDeepStrictEqual(proposed, { ...prior, date: proposed.date });
    if (!proposed || (!isDeepStrictEqual(prior, proposed) && !(previous.source === "interpreted" && correction?.[1] === prior.id) && !exactDurationCorrection && !exactDateCorrection && !savedScenarioDateChange)) {
      issues.push(`${prior.label}: preserve its established requirement or use its checklist correction action`);
    }
  }
  for (const field of ["availability", "resources", "preferences", "assumptions"] as const) {
    if (!isDeepStrictEqual(previous[field] ?? [], next[field] ?? [])) issues.push(`Preserve established ${field} or request an explicit constraint change`);
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

function sameRequirementsApartFromSource(left: PlanRequirements, right: PlanRequirements): boolean {
  return left.tasks.length === right.tasks.length
    && (left.ordering ?? []).length === (right.ordering ?? []).length
    && (left.gaps ?? []).length === (right.gaps ?? []).length
    && requirementIssues(left, right).length === 0
    && requirementIssues(right, left).length === 0;
}

export function createChatService(
  options: ChatServiceOptions = {},
): ChatService {
  const gateway = options.gateway ?? createBedrockGateway();
  const now = options.now ?? (() => new Date());
  const logger = options.logger ?? ((entry) => console.info(JSON.stringify(entry)));

  return async (request) => {
    const startedAt = performance.now();
    const requestDeadlineMs = Date.now() + 95_000;
    let attemptedCalls = 0;
    let stage: "interpret" | "revise" | "schedule" = "schedule";
    let lastStopReason: string | undefined;
    try {
    const requestInstant = now();
    const currentLocal = localNow(requestInstant, request.timeZone);
    const startsNewPlan = !request.currentPlan && (Boolean(request.scenarioId) || /\b(?:plan|schedule|create|add|book|arrange)\b/i.test(request.message));
    if (startsNewPlan && request.planDate && request.planDate < currentLocal.date) {
      throw new AppError("VALIDATION", `The selected date ${request.planDate} has already passed in ${currentLocal.zone}. Choose today or a future date.`, { status: 400 });
    }
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
    // Saved preset plans without an anchor predate rolling scenarios. Keep
    // validating them against the original checklist rather than silently
    // rebasing their dates to the current selection.
    const canonical = scenarioRequirements(scenarioId, request.currentPlan ? request.currentPlan.scenarioAnchor : request.planDate);
    const priorRequirements = request.currentPlan?.requirements;
    const sameScenario = Boolean(canonical && priorRequirements && request.currentPlan?.scenarioId === scenarioId);
    const priorScenarioIssues = sameScenario
      ? [
          ...scenarioEditIssues(canonical!, request.currentPlan!),
          ...requirementIssues(canonicalWithScenarioEdits(canonical!, request.currentPlan!.scenarioEdits ?? {}), priorRequirements!, "", undefined, true),
        ]
      : request.currentPlan?.scenarioEdits ? ["Scenario edits require a matching scenario checklist"] : [];
    if (priorScenarioIssues.length > 0) {
      throw new AppError("VALIDATION", "The saved plan no longer matches this scenario's required constraints. Start a new plan to restore them.", { status: 400 });
    }
    let requiredContext = sameScenario ? priorRequirements : canonical ?? priorRequirements;
    let captured: ReturnType<typeof interpretedPlanSchema.parse> | undefined;
    let authoritativeChanges = false;
    if (request.changes) {
      if (!request.currentPlan) throw new AppError("VALIDATION", "Create a plan before changing its requirements.", { status: 400 });
      try { requiredContext = applyRequirementChanges(request.currentPlan, request.changes); authoritativeChanges = true; }
      catch (error) { throw new AppError("VALIDATION", error instanceof Error ? error.message : "Invalid requirement changes.", { status: 400 }); }
    }
    if (request.currentPlan && !canonical && !request.edit && !request.changes) {
      const availabilityChanges = explicitAvailabilityChanges(request.currentPlan, request.message);
      if (availabilityChanges) {
        requiredContext = applyRequirementChanges(request.currentPlan, availabilityChanges);
        authoritativeChanges = true;
      }
    }
    const checklistRevision = Boolean(request.currentPlan && !canonical && !request.edit && !request.changes && !authoritativeChanges && requiresChecklistRevision(request.message));
    let requestedRevision: RevisionIntent | undefined;
    let acceptedScenarioEdits = request.currentPlan?.scenarioEdits;
    if (request.edit) {
      if (!request.currentPlan) throw new AppError("VALIDATION", "Create a plan before editing an event.", { status: 400 });
      try {
        requestedRevision = structuredRevisionIntent(request.edit, request.currentPlan);
      } catch (error) {
        throw new AppError("VALIDATION", error instanceof Error ? error.message : "Invalid event edit.", { status: 400 });
      }
    } else if (request.currentPlan && !request.changes && !authoritativeChanges) {
      requestedRevision = naturalRevisionIntent(request.message, request.currentPlan);
      if (!requestedRevision && !checklistRevision && isUnverifiedEventEditRequest(request.message, request.currentPlan)) {
        const repeated = request.currentPlan.items.filter((item) => request.currentPlan!.items.filter((other) => other.task.toLowerCase() === item.task.toLowerCase()).length > 1);
        const choices = repeated.map((item) => `${item.task} on ${item.date ?? request.planDate ?? "its scheduled date"} (${item.assignee})`).join("; ");
        return {
          outcome: "clarification",
          reply: choices ? `Which activity should I change: ${choices}? Please include its date.` : "Which exact change should I make first? Please give one clear activity, start time, end time, duration, assignee, or YYYY-MM-DD date.",
          meta: { provider: "Home Huddle", modelId: "Checked revision clarification", toolUsed: false, latencyMs: Math.round(performance.now() - startedAt), callCount: 0 },
        };
      }
    }
    if (requestedRevision && request.currentPlan) {
      const event = request.currentPlan.items.find((item) => item.taskId === requestedRevision.taskId || item.id === requestedRevision.taskId);
      if (event) {
        const date = requestedRevision.date ?? event.date ?? request.planDate;
        if (date && date < currentLocal.date) {
          throw new AppError("VALIDATION", `${event.task}: ${date} has already passed in ${currentLocal.zone}. Choose today or a future date.`, { status: 400 });
        }
        if (requestedRevision.start?.kind === "exact") {
          const hour = Math.floor(requestedRevision.start.value / 60);
          const minute = requestedRevision.start.value % 60;
          const formatted = `${hour % 12 || 12}:${String(minute).padStart(2, "0")} ${hour >= 12 ? "PM" : "AM"}`;
          const past = pastEventIssue(event.task, date, formatted, requestInstant, request.timeZone);
          if (past) throw new AppError("VALIDATION", past, { status: 400 });
        }
      }
      const issues = canonical && sameScenario
        ? preflightRevisionIssues(requestedRevision, request.currentPlan, canonical, true)
        : preflightRevisionIssues(requestedRevision, request.currentPlan, requiredContext, true, true);
      if (issues.length > 0) throw new AppError("VALIDATION", `I can't make that change: ${issues[0]}`, { status: 400 });
      if (canonical && sameScenario) {
        acceptedScenarioEdits = nextScenarioEdits(request.currentPlan.scenarioEdits ?? {}, requestedRevision, canonical);
      }
    }

    if (request.edit && requestedRevision && request.currentPlan && requiredContext) {
      const requirements: PlanRequirements = {
        ...requiredContext,
        source: acceptedScenarioEdits && Object.keys(acceptedScenarioEdits).length ? "interpreted" : requiredContext.source,
        tasks: requiredContext.tasks.map((task) => task.id === requestedRevision.taskId
          ? {
              ...(requestedRevision.assignees ? exactAssigneeRequirement(task, requestedRevision.assignees) : task),
              ...(requestedRevision.date ? { date: requestedRevision.date } : {}),
              ...(requestedRevision.durationMinutes !== undefined ? { durationMinutes: requestedRevision.durationMinutes } : {}),
              ...(!canonical && task.fixedStartTime && request.edit?.startTime ? { fixedStartTime: request.edit.startTime } : {}),
            } : task),
      };
      const direct = directEditDraft(request.currentPlan, requestedRevision, requirements, request, requestInstant);
      const directPlan = direct && publishPlan(direct, requirements, request.currentPlan, scenarioId, request.planDate, now, requestedRevision, acceptedScenarioEdits);
      if (directPlan && scheduleIssues(directPlan, request, requirements).length === 0 && pastScheduleIssues(directPlan, request, requestInstant).length === 0) return {
        reply: "Here is a checked schedule change.",
        outcome: "plan",
        plan: directPlan,
        meta: {
          provider: "Home Huddle", modelId: "Deterministic schedule edit", toolUsed: false,
          latencyMs: Math.round(performance.now() - startedAt), callCount: 0,
        },
      };
    }

    stage = !request.currentPlan && !canonical ? "interpret" : checklistRevision && !requestedRevision ? "revise" : "schedule";
    if (authoritativeChanges && requiredContext) {
      const conflict = fixedCommitmentConflict(requiredContext, request.planDate);
      if (conflict) return {
        outcome: "conflict", reply: conflict,
        meta: { provider: "Home Huddle", modelId: "Fixed commitment check", toolUsed: false, latencyMs: Math.round(performance.now() - startedAt), callCount: 0 },
      };
    }
    for (let call = 1; call <= 3; call += 1) {
      const callStartedAt = performance.now();
      attemptedCalls = call;
      const response = await gateway.converse(messages, {
        currentPlan: request.currentPlan,
        requirements: requiredContext,
        requestedRevision,
        planDate: request.planDate,
        stage,
        localTime: currentLocal,
        requestDeadlineMs,
      });
      lastStopReason = response.stopReason;
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
      if (["max_tokens", "model_context_window_exceeded"].includes(response.stopReason)) {
        invalidToolSeen = true;
        lastIssue = "the model response was truncated; no partial plan was accepted";
        if (call === 3) throw new AppError("INVALID_TOOL_OUTPUT", lastIssue, { retryable: true, status: 502 });
        const repair = { error: lastIssue, instruction: "Return one complete concise tool payload without prose. Keep every required activity and constraint." };
        messages.push({ role: "user", content: toolBlocks.length ? toolBlocks.map(({ toolUse }) => ({ toolResult: { toolUseId: toolUse.toolUseId, status: "error" as const, content: [{ json: repair }] } })) : [{ text: JSON.stringify(repair) }] });
        continue;
      }
      if (toolBlocks.length === 1 && toolBlocks[0].toolUse.name === "explain_planning_outcome") {
        const outcome = planningOutcomeSchema.safeParse(toolBlocks[0].toolUse.input);
        if (!outcome.success) throw new AppError("INVALID_TOOL_OUTPUT", "The planning explanation was incomplete.", { retryable: true, status: 502 });
        return { reply: outcome.data.message, outcome: outcome.data.outcome, meta: { provider: "Amazon Bedrock", modelId: gateway.modelId, toolUsed: true, latencyMs: Math.round(performance.now() - startedAt), callCount: call, stage } };
      }

      if (toolBlocks.length === 0) {
        if (invalidToolSeen) {
          throw new AppError(
            "INVALID_TOOL_OUTPUT",
            `I couldn't publish this plan: ${lastIssue}`,
            { retryable: true, status: 502 },
          );
        }

        if (requestedRevision || captured || authoritativeChanges) {
          invalidToolSeen = true;
          lastIssue = "the requested event change was not published and checked";
          if (call === 3) {
            throw new AppError("INVALID_TOOL_OUTPUT", `I couldn't publish this plan: ${lastIssue}`, { retryable: true, status: 502 });
          }
          messages.push({
            role: "user",
            content: [{ text: "This was an explicit schedule edit. Publish a complete replacement using the planning tool so the requested change can be checked, or explain why it conflicts." }],
          });
          continue;
        }

        return {
          reply: textFrom(assistantMessage) || "What timing should I use for this plan?",
          outcome: "clarification",
          meta: {
            provider: "Amazon Bedrock",
            modelId: gateway.modelId,
            toolUsed: false,
            latencyMs: Math.round(performance.now() - startedAt),
            callCount: call,
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

      if (stage === "interpret" || stage === "revise") {
        let issues: string[] = [];
        if (stage === "interpret" && toolUse.name === "interpret_household_request") {
          const parsed = interpretedPlanSchema.safeParse(normalizeToolTimes(toolUse.input));
          if (!parsed.success) issues = parsed.error.issues.map((issue) => `${issue.path.join(".")}: ${issue.message}`);
          else {
            issues = requirementsIssues(parsed.data.requirements, parsed.data.participants);
            issues.push(...resourceCaptureIssues(parsed.data.requirements, request.message, request.history));
            issues.push(...orderingCaptureIssues(parsed.data.requirements, request.message, request.history));
            if (parsed.data.requirements.source !== "interpreted") issues.push("Free-text requirements must be interpreted");
            if (!issues.length) {
              captured = parsed.data;
              requiredContext = parsed.data.requirements;
              const conflict = fixedCommitmentConflict(requiredContext, request.planDate);
              if (conflict) return {
                outcome: "conflict", reply: conflict,
                meta: { provider: "Amazon Bedrock", modelId: gateway.modelId, toolUsed: true, latencyMs: Math.round(performance.now() - startedAt), callCount: call, stage },
              };
            }
          }
        } else if (stage === "revise" && toolUse.name === "revise_household_requirements" && request.currentPlan) {
          const input = normalizeChangeTimes(toolUse.input) as { changes?: unknown } | null;
          const parsed = requirementChangesSchema.safeParse(input?.changes);
          if (!parsed.success) issues = ["Return valid typed requirement changes"];
          else {
            try {
              const scopeIssues = naturalChangeIssues(request.currentPlan, parsed.data, request.message);
              if (scopeIssues.length) throw new Error(scopeIssues[0]);
              requiredContext = applyRequirementChanges(request.currentPlan, parsed.data);
              authoritativeChanges = true;
              const conflict = fixedCommitmentConflict(requiredContext, request.planDate);
              if (conflict) return {
                outcome: "conflict", reply: conflict,
                meta: { provider: "Amazon Bedrock", modelId: gateway.modelId, toolUsed: true, latencyMs: Math.round(performance.now() - startedAt), callCount: call, stage },
              };
            } catch (error) { issues = [error instanceof Error ? error.message : "Invalid requirement changes"]; }
          }
        } else issues = [stage === "interpret" ? "Capture the interpreted requirements checklist with interpret_household_request before publishing a schedule" : "Use revise_household_requirements to describe only the requested changes"];
        if (!issues.length) {
          stage = "schedule";
          invalidToolSeen = false;
          if (call === 3) throw new AppError("INVALID_TOOL_OUTPUT", "The requirements were captured, but the request reached its call limit before a schedule could be checked. Please retry.", { retryable: true, status: 502 });
          messages.push({ role: "user", content: [{ toolResult: { toolUseId: toolUse.toolUseId, status: "success", content: [{ json: { requirements: requiredContext, instruction: "Requirements accepted. Now publish the complete schedule against this server-owned checklist. Preserve participants and historical events. Explain any infeasibility instead of dropping constraints. You must explicitly include every activity; the schedule cannot change the accepted checklist." } }] } }] });
          continue;
        }
        invalidToolSeen = true;
        lastIssue = issues[0];
        result = { toolResult: { toolUseId: toolUse.toolUseId, status: "error", content: [{ json: { error: "Requirements failed validation", issues } }] } };
      } else if (toolUse.name !== "publish_household_plan") {
        invalidToolSeen = true;
        result = {
          toolResult: {
            toolUseId: toolUse.toolUseId,
            status: "error",
            content: [{ json: { error: "Unknown tool" } }],
          },
        };
      } else {
        // Nova sometimes emits an otherwise valid schedule in 24-hour HH:MM.
        // Canonicalize only unambiguous clock values before all safety checks.
        const parsed = planDraftSchema.safeParse(normalizeToolTimes(toolUse.input));
        const proposed = parsed.success ? parsed.data.requirements : undefined;
        let requirements = captured || authoritativeChanges ? requiredContext : canonical && !sameScenario ? canonical : proposed ?? requiredContext;
        if (requiredContext && request.currentPlan && !requestedRevision && !authoritativeChanges && !/^Correct (?:requirement|time window)\b/i.test(request.message) && !/\b(?:gap|buffer|transition)\b/i.test(request.message)) requirements = requiredContext;
        const participantIssues = parsed.success && captured && !isDeepStrictEqual(parsed.data.participants, captured.participants) ? ["Keep the participants from the captured request"] : [];
        if (sameScenario && proposed && requiredContext) {
          // A model may relabel an unchanged preset checklist as interpreted.
          // An exact, checked event-date move is still a verified preset
          // checklist; only genuinely additive constraints become interpreted.
          const dateAdjusted = requestedRevision?.date && requestedRevision.taskId
            ? { ...requiredContext, tasks: requiredContext.tasks.map((task) => task.id === requestedRevision.taskId
              ? { ...task, date: requestedRevision.date }
              : task) }
            : requiredContext;
          requirements = sameRequirementsApartFromSource(dateAdjusted, proposed)
            ? { ...proposed, source: requiredContext.source }
            : { ...proposed, source: "interpreted" };
        }
        // An explicit event edit does not authorize the model to rewrite the
        // established checklist. Apply only its permitted date/duration delta
        // to server-owned requirements, then validate the entire model schedule
        // against that authoritative version. Separate checklist corrections
        // and gap requests still use the model's proposed requirements.
        if (requestedRevision && requiredContext) {
          requirements = {
            ...requiredContext,
            source: canonical && sameScenario && acceptedScenarioEdits && Object.keys(acceptedScenarioEdits).length
              ? "interpreted"
              : requiredContext.source,
            tasks: requiredContext.tasks.map((task) => task.id === requestedRevision.taskId
              ? (() => {
                  const revised = requestedRevision.assignees
                    ? exactAssigneeRequirement(task, requestedRevision.assignees)
                    : task;
                  return {
                    ...revised,
                    ...(requestedRevision.date !== undefined && (!task.fixedDate || !canonical) ? { date: requestedRevision.date } : {}),
                    ...(!canonical && task.fixedStartTime && requestedRevision.start?.kind === "exact" ? { fixedStartTime: `${Math.floor(requestedRevision.start.value / 60) % 12 || 12}:${String(requestedRevision.start.value % 60).padStart(2, "0")} ${requestedRevision.start.value >= 720 ? "PM" : "AM"}` } : {}),
                    ...(requestedRevision.durationMinutes !== undefined
                      ? { durationMinutes: requestedRevision.durationMinutes }
                      : {}),
                  };
                })()
              : task),
          };
        }
        // Validate the exact dates that publication will use; omitted model dates
        // must never be checked on one day and then published on another.
        if (parsed.success) parsed.data.items = parsed.data.items.map((item) => ({
          ...item, date: item.date ?? requirements?.tasks.find((task) => task.id === item.taskId)?.date ?? request.currentPlan?.items.find((previous) => previous.taskId === item.taskId)?.date ?? request.planDate,
        }));
        const conflicts = parsed.success && requiredContext && proposed && !captured && !authoritativeChanges && !requestedRevision && (!canonical || sameScenario)
          ? requirementIssues(requiredContext, proposed, request.message, requestedRevision)
          : [];
        conflicts.push(...participantIssues);
        if (parsed.success && request.currentPlan && !isDeepStrictEqual([...parsed.data.participants].map((person) => person.toLowerCase()).sort(), [...request.currentPlan.participants].map((person) => person.toLowerCase()).sort())) conflicts.push("Keep the established participants for a revision");
        if (parsed.success && sameScenario && canonical && proposed && !requestedRevision) {
          conflicts.push(...requirementIssues(canonical, proposed, request.message, requestedRevision, true));
        }
        if (parsed.success && requestedRevision && request.currentPlan) {
          const samePeople = isDeepStrictEqual(
            parsed.data.participants.map((person) => person.toLowerCase()).sort(),
            request.currentPlan.participants.map((person) => person.toLowerCase()).sort(),
          );
          if (!samePeople) conflicts.push("Keep the current participants for an event edit");
          if (requiredContext && proposed && !isDeepStrictEqual(
            proposed.tasks.map((task) => task.id).sort(),
            requiredContext.tasks.map((task) => task.id).sort(),
          )) conflicts.push("Keep the current task checklist for an event edit");
        }
        if (request.currentPlan && requiredContext && proposed && !authoritativeChanges && !/\b(?:gap|buffer|transition)\b|\b\d{1,2}\s*-?\s*minutes?\s+between\b/i.test(request.message)) {
          const addedGap = (proposed.gaps ?? []).some((gap) => !(requiredContext!.gaps ?? []).some((existing) => isDeepStrictEqual(existing, gap)));
          if (addedGap) conflicts.push("Do not add a new transition gap unless the user requested one");
        }
        const completionInstant = now();
        if (parsed.success && requirements && !request.currentPlan && !conflicts.length) {
          parsed.data = repairScheduleTiming(parsed.data, request, requirements, completionInstant);
        }
        const pastIssues = parsed.success ? pastScheduleIssues(parsed.data, request, completionInstant) : [];
        const editIssues = parsed.success && request.currentPlan && requestedRevision
          ? revisionIntentIssues(parsed.data, request.currentPlan, requestedRevision)
          : [];
        const timingIssues = parsed.success && requirements ? scheduleIssues(parsed.data, request, requirements) : [];
        timingIssues.unshift(...pastIssues, ...editIssues);
        if (parsed.success && !requirements) timingIssues.unshift("Include the interpreted requirements checklist before publishing this plan");
        if (parsed.success && !canonical && requirements && requirements.source !== "interpreted") timingIssues.unshift("Free-text requirements must be labeled as model-interpreted");
        const buffer = /\badd a (\d{1,2})-minute transition buffer\b/i.exec(request.message);
        if (parsed.success && buffer && requirements && !requirements.gaps?.some((gap) => gap.minMinutes >= Number(buffer[1]))) {
          timingIssues.unshift(`Name the two affected tasks in a ${buffer[1]}-minute gap requirement`);
        }
        if (!parsed.success || conflicts.length > 0 || timingIssues.length > 0) {
          invalidToolSeen = true;
          lastIssue = pastIssues[0] ?? conflicts[0] ?? timingIssues[0] ?? "The plan is missing required fields.";
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
          // A new plan may have valid but unnecessarily serial work. Compact it
          // without another model call; leave revisions alone so explicit moves
          // and otherwise preserved times remain under the user's control.
          const schedule = request.currentPlan
            ? parsed.data
            : shortenSchedule(parsed.data, request, requirements!, completionInstant);
          const publishedPlan = publishPlan(schedule, requirements!, request.currentPlan, scenarioId, request.planDate, () => completionInstant, requestedRevision, acceptedScenarioEdits);
          const finalIssues = [...scheduleIssues(publishedPlan, request, requirements!), ...pastScheduleIssues(publishedPlan, request, completionInstant)];
          if (finalIssues.length) throw new AppError("INVALID_TOOL_OUTPUT", `I couldn't publish this plan: ${finalIssues[0]}`, { retryable: true, status: 502 });
          const shortened = schedule !== parsed.data;
          return {
            reply: requirements!.source === "interpreted"
              ? shortened
                ? "I shortened the plan by removing avoidable idle time. Please review the interpreted requirements below; only the captured requirements were checked."
                : "I made a plan from the interpreted requirements shown below. Please review them; only the captured requirements were checked."
              : shortened
                ? "I shortened the plan by removing avoidable idle time. Your household plan is ready."
                : "Your household plan is ready.",
            plan: publishedPlan,
            outcome: "plan",
            meta: {
              provider: "Amazon Bedrock",
              modelId: gateway.modelId,
              toolUsed: true,
              latencyMs: Math.round(performance.now() - startedAt),
              callCount: call,
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
    } catch (error) {
      if (error instanceof AppError) {
        error.diagnostics = { callCount: error.code === "RATE_LIMIT" ? Math.max(0, attemptedCalls - 1) : attemptedCalls, stage, stopReason: lastStopReason?.slice(0, 80) };
        throw error;
      }
      const failure = new AppError("BEDROCK_UNAVAILABLE", "The planning service could not complete this request.", { retryable: true, status: 502, cause: error });
      failure.diagnostics = { callCount: attemptedCalls, stage, stopReason: lastStopReason?.slice(0, 80) };
      throw failure;
    }
  };
}
