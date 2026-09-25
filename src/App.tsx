import { useEffect, useLayoutEffect, useRef, useState } from "react";
import {
  ChangeReviewCard,
  ConversationDisplay,
  PromptChips,
  type ConversationStatusValue,
} from "conversation-display-kit";
import type {
  ChatRequest,
  ChatResponse,
  HistoryMessage,
  HouseholdPlan,
  ScheduleEdit,
} from "../shared/contracts";
import { ChatApiError, sendChat } from "./api";
import { AboutPage } from "./AboutPage";
import { DraftReview } from "./DraftReview";
import { EvidencePanel } from "./EvidencePanel";
import { CalendarIcon, HomeIcon, InfoIcon, MicIcon, ResetIcon } from "./icons";
import { PlanBoard } from "./PlanBoard";
import { SharePanel } from "./SharePanel";
import { SharedApp } from "./SharedApp";
import { preservedFixedCommitments, reviewChanges } from "./planDiff";
import { asksToMoveWholePlanDate, formatPlanDate, isValidPlanDate, isPastEventStart, newPlanTimeIssue, pastPlanMoveIssue, planDates, requestedPlanDate, revisionTimeIssue, suggestedPlanDate, todayInZone } from "./planDate";
import { scenarioRequirements } from "../shared/scenarios";
import { isOutdatedExample } from "./planStatus";
import { shareTokenFromHash } from "./shareApi";
import { presetScenarios, revisionPromptsFor } from "./presets";
import { useSpeechRecognition } from "./useSpeechRecognition";
import { loadState, STORAGE_KEY, OLD_STORAGE_KEY, WELCOME_MESSAGE, type ConversationMessage, type FailedRequest, type StoredState } from "./storedState";
import { scrollBehavior } from "./motion";

function createId() {
  return globalThis.crypto?.randomUUID?.() ?? `message-${Date.now()}`;
}

function carryEventDetails(target: HouseholdPlan, source?: HouseholdPlan): HouseholdPlan {
  if (!source) return target;
  const details = new Map(source.items.map((item) => [item.taskId ?? item.id, item.details]));
  return {
    ...target,
    items: target.items.map((item) => {
      const key = item.taskId ?? item.id;
      return details.has(key) ? { ...item, details: details.get(key) } : item;
    }),
  };
}

function today() {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
}

function defaultTimeZone() {
  return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
}

function asHistory(messages: ConversationMessage[]): HistoryMessage[] {
  const recent = messages.filter(({ id, localOnly }) => id !== "welcome" && !localOnly).slice(-12);
  const firstUser = recent.findIndex(({ role }) => role === "user");
  return (firstUser < 0 ? [] : recent.slice(firstUser)).map(({ role, text, contextText }) => ({
    role,
    text: (contextText ?? text).slice(0, 1000),
  }));
}

function localReplyFor(message: string, hasPlan: boolean): string | undefined {
  const normalized = message.trim().toLowerCase().replace(/[.!?,]+$/g, "").trim();
  if (/^(hi|hi there|hello|hey|hey there|good morning|good afternoon|good evening)$/.test(normalized)) {
    return hasPlan
      ? "Hi! Tell me what you'd like to change in the current plan."
      : "Hi! Tell me what needs to happen and when, or try an example.";
  }
  if (/^(thanks|thank you|thank you so much)$/.test(normalized)) {
    return hasPlan
      ? "You're welcome! I can revise the current plan whenever you need."
      : "You're welcome! Tell me what you'd like to plan.";
  }
  return undefined;
}

function MicButton({
  disabled,
  listening,
  supported,
  onClick,
}: {
  disabled: boolean;
  listening: boolean;
  supported: boolean;
  onClick: () => void;
}) {
  const unavailable = !supported;
  const label = unavailable
    ? "Voice input unavailable in this browser"
    : listening
      ? "Stop voice input"
      : "Start voice input";

  return (
    <button
      aria-disabled={unavailable || disabled}
      aria-label={label}
      className={`mic-button ${listening ? "mic-button--active" : ""}`}
      disabled={disabled}
      onClick={unavailable ? undefined : onClick}
      title={label}
      type="button"
    >
      <MicIcon size={19} />
    </button>
  );
}

function PlannerApp() {
  const [stored] = useState(loadState);
  const [messages, setMessages] = useState<ConversationMessage[]>(stored.messages);
  const [plan, setPlan] = useState<HouseholdPlan | undefined>(stored.plan);
  const [draftPlan, setDraftPlan] = useState<HouseholdPlan | undefined>(stored.draftPlan);
  const [draftSourceMessage, setDraftSourceMessage] = useState(stored.draftSourceMessage ?? "");
  const [draftNeedsResolution, setDraftNeedsResolution] = useState(stored.draftNeedsResolution ?? false);
  const [draftCorrectionStartId, setDraftCorrectionStartId] = useState(stored.draftCorrectionStartId);
  const [proposal, setProposal] = useState<HouseholdPlan | undefined>(stored.proposal);
  const [proposalDate, setProposalDate] = useState<string | undefined>(stored.proposalDate);
  const [undoPlan, setUndoPlan] = useState<HouseholdPlan | undefined>(stored.undoPlan);
  const [undoDate, setUndoDate] = useState<string | undefined>(stored.undoDate);
  const [scenarioId, setScenarioId] = useState<ChatRequest["scenarioId"]>(stored.scenarioId ?? stored.plan?.scenarioId);
  const [calendarDate, setCalendarDate] = useState(stored.calendarDate ?? today());
  const [timeZone, setTimeZone] = useState(stored.timeZone ?? defaultTimeZone());
  const [meta, setMeta] = useState<ChatResponse["meta"] | undefined>(stored.meta);
  const [input, setInput] = useState("");
  const [showScenarios, setShowScenarios] = useState(true);
  const [pending, setPending] = useState(false);
  const [failure, setFailure] = useState<FailedRequest | null>(stored.failure ?? null);
  const [dateChangeError, setDateChangeError] = useState("");
  const [reviewError, setReviewError] = useState("");
  const [storageWarning, setStorageWarning] = useState(stored.warning ?? "");
  const [storageUnavailable, setStorageUnavailable] = useState(Boolean(stored.warning?.includes("memory")));
  const focusComposer = useRef(false);
  const inputRef = useRef<HTMLInputElement | HTMLTextAreaElement>(null);
  const conversationRef = useRef<HTMLDivElement>(null);
  const abortRef = useRef<AbortController | null>(null);
  const requestId = useRef(0);
  const scheduleEditNeedsFocus = useRef(false);
  const editErrorRef = useRef<HTMLDivElement>(null);
  const proposalRef = useRef<HTMLDivElement>(null);
  const draftReviewRef = useRef<HTMLDivElement>(null);
  const isAboutPage = new URLSearchParams(window.location.search).get("page") === "about";
  const speech = useSpeechRecognition((transcript) => setInput(transcript));

  useEffect(() => {
    document.title = isAboutPage ? "About Home Huddle" : "Home Huddle — Make room for everyone";
  }, [isAboutPage]);

  useLayoutEffect(() => {
    let active = true;
    try {
      window.localStorage.setItem(
        STORAGE_KEY,
        JSON.stringify({ messages: messages.slice(-13), plan, draftPlan, draftSourceMessage: draftPlan ? draftSourceMessage : undefined, draftNeedsResolution: draftPlan ? draftNeedsResolution : undefined, draftCorrectionStartId: draftPlan ? draftCorrectionStartId : undefined, proposal, proposalDate, undoPlan, undoDate, scenarioId, calendarDate, timeZone, meta, failure } satisfies StoredState),
      );
    } catch {
      queueMicrotask(() => {
        if (!active) return;
        setStorageUnavailable(true);
        setStorageWarning("Browser storage is unavailable. Your plan will stay in memory for this visit only. You can still export or share it.");
      });
    }
    return () => { active = false; };
  }, [messages, plan, draftPlan, draftSourceMessage, draftNeedsResolution, draftCorrectionStartId, proposal, proposalDate, undoPlan, undoDate, scenarioId, calendarDate, timeZone, meta, failure]);

  useEffect(() => {
    if (proposal) proposalRef.current?.scrollIntoView?.({ behavior: scrollBehavior(), block: "center" });
  }, [proposal]);

  useEffect(() => {
    if (draftPlan && !pending) draftReviewRef.current?.focus();
  }, [draftPlan, pending]);

  useEffect(() => {
    if (!scheduleEditNeedsFocus.current || pending) return;
    const result = failure ? editErrorRef.current : proposal ? proposalRef.current : undefined;
    if (!result) return;
    result.focus();
    scheduleEditNeedsFocus.current = false;
  }, [failure, pending, proposal]);

  useEffect(() => {
    if (focusComposer.current && !pending && !proposal) { inputRef.current?.focus(); focusComposer.current = false; }
  }, [pending, proposal, messages]);

  useEffect(() => () => { requestId.current += 1; abortRef.current?.abort(); }, []);

  const status: ConversationStatusValue = failure
    ? "error"
    : speech.listening
      ? "listening"
      : pending
        ? "thinking"
        : "idle";

  function applyResponse(response: ChatResponse, request: ChatRequest) {
    if (response.plan && !plan && !request.scenarioId && response.plan.requirements?.source !== "interpreted") {
      throw new ChatApiError({ code: "INVALID_TOOL_OUTPUT", message: "The planning service did not return a reviewable checklist. Ask it to try again before using a plan.", retryable: true });
    }
    setReviewError("");
    setDateChangeError("");
    setMessages((current) => [
      ...current,
      { id: createId(), role: "assistant", text: plan && response.plan
        ? `Proposed revision: ${response.reply} Review the changes before applying.`
        : response.plan && !request.scenarioId
          ? `${response.reply} Review the captured requirements before using this draft.`
          : response.reply },
    ]);
    if (response.plan) {
      const acceptedDates = new Map((plan ?? draftPlan)?.items.map((item) => [item.taskId ?? item.id, item.date]) ?? []);
      const datedPlan = {
        ...response.plan,
        items: response.plan.items.map((item) => ({
          ...item,
          date: item.date ?? acceptedDates.get(item.taskId ?? item.id) ?? request.planDate ?? calendarDate,
        })),
      };
      if (plan) { setProposal(datedPlan); setProposalDate(undefined); }
      else if (!request.scenarioId) {
        setDraftPlan(datedPlan);
        setDraftSourceMessage((current) => draftPlan ? current : request.message);
        setDraftNeedsResolution(false);
        setDraftCorrectionStartId(undefined);
        setCalendarDate(planDates(datedPlan, request.planDate ?? calendarDate)[0]);
        setUndoPlan(undefined);
      }
      else {
        setPlan(datedPlan);
        setCalendarDate(planDates(datedPlan, request.planDate ?? calendarDate)[0]);
        setUndoPlan(undefined);
      }
    } else if (draftPlan && request.currentPlan) {
      setDraftNeedsResolution(true);
    }
    setMeta(response.meta);
    setFailure(null);
  }

  async function execute(request: ChatRequest) {
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    const activeRequest = ++requestId.current;
    speech.stop();
    setPending(true);
    setFailure(null);
    try {
      const response = await sendChat(request, { signal: controller.signal });
      if (activeRequest === requestId.current) applyResponse(response, request);
    } catch (error) {
      if (activeRequest !== requestId.current || controller.signal.aborted) return;
      if (draftPlan && request.currentPlan) setDraftNeedsResolution(true);
      const apiError =
        error instanceof ChatApiError
          ? error
          : new ChatApiError({
              code: "BEDROCK_UNAVAILABLE",
              message: "Home Huddle could not reach the planning service.",
              retryable: true,
            });
      setFailure({
        request,
        message: apiError.message,
        retryable: apiError.retryable,
      });
    } finally {
      if (activeRequest === requestId.current) setPending(false);
    }
  }

  function proposePlanDate(nextDate: string, source: "picker" | "chat" = "picker") {
    if (!plan || !isValidPlanDate(nextDate) || proposal || pending) return;
    setDateChangeError("");
    const dates = planDates(plan, calendarDate);
    if (dates.length > 1) {
      setMessages((current) => [...current, { id: createId(), role: "assistant", text: "This plan spans several dates. Open an activity to change its day, or ask me to move a named activity to a specific date.", localOnly: true }]);
      return;
    }
    if (scenarioRequirements(plan.scenarioId, plan.scenarioAnchor)?.tasks.some((task) => task.fixedDate)) {
      setMessages((current) => [...current, { id: createId(), role: "assistant", text: "This plan includes a fixed-date commitment. I can't move the whole plan; open a flexible activity to propose a date change instead.", localOnly: true }]);
      return;
    }
    const started = plan.items.find((item) => isPastEventStart(item.date ?? calendarDate, item.startTime, timeZone));
    if (started) {
      setDateChangeError(`“${started.task}” has already started. Keep its recorded time and move a future activity instead.`);
      return;
    }
    const pastIssue = pastPlanMoveIssue(plan, nextDate, timeZone);
    if (pastIssue) {
      setDateChangeError(pastIssue);
      if (source === "chat") setMessages((current) => [...current, { id: createId(), role: "assistant", text: pastIssue, localOnly: true }]);
      return;
    }
    const currentDate = dates[0];
    if (nextDate === currentDate) {
      if (source === "chat") setMessages((current) => [...current, { id: createId(), role: "assistant", text: `This plan is already set for ${formatPlanDate(nextDate)}.`, localOnly: true }]);
      return;
    }
    const oldDay = formatPlanDate(currentDate).split(",")[0];
    const newDay = formatPlanDate(nextDate).split(",")[0];
    const replaceWeekday = (value: string) => value.replace(new RegExp(`\\b${oldDay}\\b`, "gi"), (found) => found === found.toLowerCase() ? newDay.toLowerCase() : newDay);
    setProposal({
      ...plan,
      title: replaceWeekday(plan.title),
      objective: replaceWeekday(plan.objective),
      items: plan.items.map((item) => ({ ...item, date: nextDate })),
      requirements: plan.requirements && {
        ...plan.requirements,
        tasks: plan.requirements.tasks.map((task) => task.date === currentDate ? { ...task, date: nextDate } : task),
        timeWindows: plan.requirements.timeWindows?.map((window) => window.date === currentDate ? { ...window, date: nextDate } : window),
        availability: plan.requirements.availability?.map((entry) => entry.date === currentDate ? { ...entry, date: nextDate } : entry),
      },
      version: plan.version + 1,
      updatedAt: new Date().toISOString(),
    });
    setProposalDate(nextDate);
    setMessages((current) => [...current, {
      id: createId(), role: "assistant", text: `Proposed moving the whole plan to ${formatPlanDate(nextDate)}. Review the date before applying.`, localOnly: true,
    }]);
  }

  function submitMessage(value: string, selectedScenarioId?: ChatRequest["scenarioId"], edit?: ScheduleEdit) {
    const message = value.trim();
    if (!message || pending || proposal || message.length > 1000) return;
    const activePlan = plan ?? draftPlan;
    speech.stop();

    // Exact, social-only messages need no model call or Bedrock quota reservation.
    const localReply = selectedScenarioId ? undefined : localReplyFor(message, Boolean(activePlan));
    if (localReply) {
      setMessages((current) => [
        ...current,
        { id: createId(), role: "user", text: message, localOnly: true },
        { id: createId(), role: "assistant", text: localReply, localOnly: true },
      ]);
      setInput("");
      setFailure(null);
      return;
    }

    if (plan && !selectedScenarioId && !edit) {
      const nextDate = requestedPlanDate(message, planDates(plan, calendarDate)[0]);
      if (nextDate) {
        setMessages((current) => [...current, { id: createId(), role: "user", text: message, localOnly: true }]);
        setInput("");
        setFailure(null);
        proposePlanDate(nextDate, "chat");
        return;
      }
      if (asksToMoveWholePlanDate(message)) {
        setMessages((current) => [
          ...current,
          { id: createId(), role: "user", text: message, localOnly: true },
          { id: createId(), role: "assistant", text: "To move a whole one-day plan, say ‘Move the plan to Sunday’ or give a full date. For a multi-day plan, name the activity and its new date.", localOnly: true },
        ]);
        setInput("");
        return;
      }
    }

    const mentionedDate = !activePlan && !selectedScenarioId ? suggestedPlanDate(message, new Date(), timeZone) : undefined;
    const request: ChatRequest = {
      message,
      history: asHistory(messages),
      currentPlan: activePlan,
      scenarioId: selectedScenarioId ?? scenarioId,
      planDate: selectedScenarioId ? todayInZone(timeZone) : mentionedDate ?? (activePlan ? calendarDate : todayInZone(timeZone)),
      timeZone,
      edit,
    };
    if (selectedScenarioId) setScenarioId(selectedScenarioId);
    if (mentionedDate) setCalendarDate(mentionedDate);
    const userMessageId = createId();
    if (draftPlan) {
      if (!draftCorrectionStartId) setDraftCorrectionStartId(userMessageId);
      setDraftNeedsResolution(true);
    }
    setMessages((current) => [
      ...current,
      { id: userMessageId, role: "user", text: message },
    ]);
    setInput("");
    void execute(request);
  }

  function reset() {
    requestId.current += 1;
    abortRef.current?.abort();
    scheduleEditNeedsFocus.current = false;
    speech.stop();
    try {
      window.localStorage.removeItem(STORAGE_KEY);
      window.localStorage.removeItem(OLD_STORAGE_KEY);
    } catch {
      setStorageUnavailable(true);
      setStorageWarning("Browser storage is unavailable. Your new plan will stay in memory for this visit only.");
    }
    window.history.replaceState(null, "", window.location.pathname + window.location.search);
    window.scrollTo({ top: 0, behavior: scrollBehavior() });
    setMessages([WELCOME_MESSAGE]);
    setPlan(undefined);
    setDraftPlan(undefined);
    setDraftSourceMessage("");
    setDraftNeedsResolution(false);
    setDraftCorrectionStartId(undefined);
    setProposal(undefined);
    setProposalDate(undefined);
    setUndoPlan(undefined);
    setUndoDate(undefined);
    setScenarioId(undefined);
    setCalendarDate(today());
    setTimeZone(defaultTimeZone());
    setMeta(undefined);
    setInput("");
    setShowScenarios(true);
    setFailure(null);
    setDateChangeError("");
    setPending(false);
    setReviewError("");
    focusComposer.current = true;
  }

  const revisionSuggestions = plan ? revisionPromptsFor(plan) : [];
  const examples = presetScenarios(todayInZone(timeZone));
  const conversationMessages = messages.filter(({ id }) => id !== "welcome");
  const hasConversation = conversationMessages.length > 0 || Boolean(plan || draftPlan);
  const changes = plan && proposal ? [...(proposalDate ? [{ id: "plan-date", label: "Plan date", before: formatPlanDate(planDates(plan, calendarDate)[0]), after: formatPlanDate(proposalDate) }] : []), ...reviewChanges(plan, proposal)] : [];
  const fixed = plan && proposal ? preservedFixedCommitments(plan, proposal) : [];
  const outdatedExample = plan ? isOutdatedExample(plan) : false;

  function acceptDraft() {
    if (!draftPlan || pending || draftNeedsResolution) return;
    const timeIssue = newPlanTimeIssue(draftPlan, calendarDate, timeZone);
    if (timeIssue) { setReviewError(timeIssue); return; }
    setPlan(draftPlan);
    setDraftPlan(undefined);
    setDraftSourceMessage("");
    setDraftCorrectionStartId(undefined);
    setDraftNeedsResolution(false);
    setReviewError("");
    setFailure(null);
    focusComposer.current = true;
    setMessages((current) => [...current, { id: createId(), role: "assistant", text: "Plan accepted. You can now edit, share, or export it.", localOnly: true }]);
  }

  function returnToDraft() {
    if (!draftPlan || pending) return;
    setMessages((current) => {
      const start = current.findIndex((entry) => entry.id === draftCorrectionStartId);
      // Truncated saved history may no longer contain the correction's first
      // message. In that case, omit all old chat from future model context;
      // the pending draft itself remains the authoritative requirements.
      return current.map((entry, index) => start < 0 || index >= start ? { ...entry, localOnly: true } : entry);
    });
    setDraftCorrectionStartId(undefined);
    setDraftNeedsResolution(false);
    setFailure(null);
    setReviewError("");
    setMessages((current) => [...current, { id: createId(), role: "assistant", text: "Returned to the previous draft. Review it before using it.", localOnly: true }]);
    draftReviewRef.current?.focus();
  }

  function focusDraftCorrection() {
    setInput("");
    inputRef.current?.focus();
    conversationRef.current?.scrollIntoView?.({ behavior: scrollBehavior(), block: "center" });
  }

  function applyProposal() {
    if (!plan || !proposal) return;
    const timeIssue = revisionTimeIssue(plan, proposal, calendarDate, timeZone);
    if (timeIssue) { setReviewError(timeIssue); return; }
    setReviewError("");
    setUndoPlan(plan);
    setUndoDate(calendarDate);
    setPlan(carryEventDetails(proposal, plan));
    if (proposalDate) setCalendarDate(proposalDate);
    setProposal(undefined);
    setProposalDate(undefined);
    setFailure(null);
    focusComposer.current = true;
    setMessages((current) => [...current, { id: createId(), role: "assistant", text: "Revision applied. You can undo it if you change your mind." }]);
  }

  function keepCurrent() {
    setReviewError("");
    setProposal(undefined);
    setProposalDate(undefined);
    setFailure(null);
    focusComposer.current = true;
    setMessages((current) => [...current, { id: createId(), role: "assistant", text: "Kept your current plan." }]);
  }

  function undoRevision() {
    if (!plan || !undoPlan) return;
    const timeIssue = revisionTimeIssue(plan, undoPlan, calendarDate, timeZone);
    if (timeIssue) { setReviewError(timeIssue); return; }
    setReviewError("");
    setPlan({ ...carryEventDetails(undoPlan, plan), version: plan.version + 1, updatedAt: new Date().toISOString() });
    if (undoDate) setCalendarDate(undoDate);
    setUndoPlan(undefined);
    setUndoDate(undefined);
    setFailure(null);
    focusComposer.current = true;
    setMessages((current) => [...current, { id: createId(), role: "assistant", text: "Restored the previous plan." }]);
  }

  function updateEventDetails(itemId: string, details: string) {
    const nextDetails = details.trim().slice(0, 500) || undefined;
    setPlan((current) => {
      if (!current) return current;
      const item = current.items.find((entry) => entry.id === itemId);
      if (!item || item.details === nextDetails) return current;
      return {
        ...current,
        items: current.items.map((entry) => entry.id === itemId ? { ...entry, details: nextDetails } : entry),
        // Notes do not change the schedule revision number. This also keeps a
        // simultaneous schedule proposal based on the same plan version.
        updatedAt: new Date().toISOString(),
      };
    });
  }

  function requestScheduleEdit(edit: ScheduleEdit) {
    const item = plan?.items.find((entry) => entry.taskId === edit.taskId);
    if (!item || pending || proposal) return;
    const changes = [
      edit.date && `move to ${formatPlanDate(edit.date)}`,
      edit.startTime && `start at ${edit.startTime}`,
      edit.durationMinutes !== undefined && `last ${edit.durationMinutes} minutes`,
      edit.assignees && `assign to ${edit.assignees.join(", ")}`,
    ].filter(Boolean);
    scheduleEditNeedsFocus.current = true;
    submitMessage(`Update “${item.task}”: ${changes.join("; ")}.`, undefined, edit);
    conversationRef.current?.scrollIntoView?.({ behavior: scrollBehavior(), block: "center" });
  }

  function correctRequirement(id: string, label: string) {
    setInput(id === "window" ? "Correct time window: " : `Correct requirement ${id}: `);
    setMessages((current) => [...current, { id: createId(), role: "assistant", text: `What should I change about ${label}? Add the correction in the message box.` }]);
    conversationRef.current?.scrollIntoView?.({ behavior: scrollBehavior() });
    inputRef.current?.focus();
  }

  const conversation = (
    <ConversationDisplay
      className={`home-huddle-conversation ${hasConversation ? "home-huddle-conversation--active" : "home-huddle-conversation--welcome"}`}
      composerAction={
        <MicButton
          disabled={pending || Boolean(proposal)}
          listening={speech.listening}
          onClick={speech.listening ? speech.stop : speech.start}
          supported={speech.supported}
        />
      }
      disabled={pending || Boolean(proposal)}
      emptyState=""
      messages={conversationMessages}
      inputRef={inputRef}
      maxLength={1000}
      multiline
      onSubmit={(value) => submitMessage(value)}
      onValueChange={setInput}
      placeholder="Ask Home Huddle"
      status={status}
      statusLabels={{ thinking: "Thinking about your message…", listening: "Listening for your message…" }}
      submitLabel={pending ? "Thinking…" : "Send"}
      value={input}
    />
  );

  const errorBanner = (speech.error || failure) && (
    <div className="error-banner" ref={editErrorRef} role="alert" tabIndex={-1}>
      <div>
        <strong>{failure ? "Reply paused" : "Voice input paused"}</strong>
        <span>{failure?.message ?? speech.error}</span>
      </div>
      {failure?.retryable && (
        <button
          disabled={pending}
          onClick={() => void execute(failure.request)}
          type="button"
        >
          Retry
        </button>
      )}
    </div>
  );

  return (
    <div
      className={`app-shell ${isAboutPage ? 'app-shell--about' : hasConversation ? 'app-shell--active' : 'app-shell--welcome'}`}
    >
      <a className='skip-link' href='#main-content'>
        Skip to main content
      </a>
      <header className='site-header'>
        <a
          aria-label='Home Huddle home'
          className='brand'
          href={isAboutPage ? './' : '#top'}
        >
          <img
            alt=''
            aria-hidden='true'
            className='brand-mark'
            height='31'
            src={`${import.meta.env.BASE_URL}favicon.svg`}
            width='31'
          />
          <strong>Home Huddle</strong>
        </a>
        <div className='site-header__actions'>
          {!isAboutPage && (
            <button
              aria-label='New plan'
              className='reset-button'
              onClick={reset}
              title='New plan'
              type='button'
            >
              <ResetIcon />
            </button>
          )}
          <a
            className='header-page-link'
            href={isAboutPage ? './' : '?page=about'}
          >
            {isAboutPage ? 'Plan' : 'About'}
          </a>
        </div>
      </header>

      <nav aria-label='Page sections' className='side-rail'>
        <a
          aria-label='Start'
          aria-current={!isAboutPage ? 'page' : undefined}
          href={isAboutPage ? './' : '#top'}
          title='Start'
        >
          <HomeIcon />
        </a>
        {!isAboutPage && plan && (
          <a aria-label='Calendar' href='#calendar' title='Calendar'>
            <CalendarIcon />
          </a>
        )}
        <a
          aria-label='About this demo'
          aria-current={isAboutPage ? 'page' : undefined}
          href={isAboutPage ? '#main-content' : '?page=about'}
          title='About this demo'
        >
          <InfoIcon />
        </a>
      </nav>

      {isAboutPage ? (
        <AboutPage />
      ) : (
        <main id='main-content'>
          <section
            aria-label='Home Huddle conversation'
            className='alexa-stage'
            id='top'
          >
            {!hasConversation && <h1>Hello, how can we plan together?</h1>}
            {hasConversation && (
              <h1 className='screen-reader-only'>
                Your household conversation
              </h1>
            )}
            <div className='stage-conversation' id='conversation' ref={conversationRef}>
              {conversation}
              <span aria-hidden='true' className='send-hint'>
                Send message
              </span>
            </div>
            {errorBanner}
            {reviewError && !draftPlan && <p className="persistence-warning" role="alert">{reviewError}</p>}
            {storageWarning && <p className='persistence-warning' role='alert'>{storageWarning}</p>}
            {(pending || speech.listening) && (
              <p className='conversation-feedback' aria-hidden='true'>
                {pending
                  ? 'Thinking about your message…'
                  : 'Listening for your message…'}
              </p>
            )}
            {!hasConversation && showScenarios && (
              <section
                aria-label='Example scenarios'
                className='scenario-section'
              >
                <h2 className='screen-reader-only'>Try a starting point</h2>
                <div className='scenario-grid'>
                  {examples.map((scenario) => (
                    <button
                      aria-label={`${scenario.title}. ${scenario.description}`}
                      className='scenario-chip'
                      disabled={pending}
                      key={scenario.id}
                      onClick={() => submitMessage(scenario.prompt, scenario.id as ChatRequest["scenarioId"])}
                      title={scenario.description}
                      type='button'
                    >
                      <span>{scenario.title}</span>
                      <span aria-hidden='true' className='scenario-chip__arrow'>
                        →
                      </span>
                    </button>
                  ))}
                </div>
                <button
                  aria-label='Dismiss example scenarios'
                  className='scenario-dismiss'
                  onClick={() => {
                    setShowScenarios(false);
                    inputRef.current?.focus();
                  }}
                  title='Hide example scenarios'
                  type='button'
                >
                  Dismiss examples
                </button>
              </section>
            )}
            {hasConversation && revisionSuggestions.length > 0 && (
              <PromptChips
                disabled={pending || Boolean(proposal)}
                label='Suggested plan revisions'
                onSelect={(value) => { setInput(value); inputRef.current?.focus(); }}
                suggestions={revisionSuggestions}
              />
            )}
            {draftPlan && (
              <DraftReview
                date={calendarDate}
                error={reviewError}
                needsResolution={draftNeedsResolution}
                onAccept={acceptDraft}
                onCorrect={focusDraftCorrection}
                onKeepDraft={returnToDraft}
                onStartOver={reset}
                pending={pending}
                plan={draftPlan}
                ref={draftReviewRef}
                sourceMessage={draftSourceMessage}
                timeZone={timeZone}
              />
            )}
            {plan && proposal && (
              <div className='proposal-wrap' role='region' aria-label='Proposed revision' ref={proposalRef} tabIndex={-1}>
                <ChangeReviewCard
                  title='Review this revision'
                  summary={`${changes.length} proposed ${changes.length === 1 ? "change" : "changes"}. ${fixed.length ? `Preserved: ${fixed.join("; ")}.` : "Review the changes before applying."}`}
                  changes={changes}
                  onAccept={applyProposal}
                  onReject={keepCurrent}
                />
              </div>
            )}
            {plan && undoPlan && !proposal && (
              <button className='undo-button' disabled={pending} onClick={undoRevision} title='Restore the plan before the last accepted revision' type='button'>
                Undo accepted revision
              </button>
            )}
            <div aria-live='polite' className='calendar-prompt'>
              {plan && (
                <a href='#calendar'>
                  View shared calendar <span aria-hidden='true'>↓</span>
                </a>
              )}
            </div>
            {hasConversation && meta && !plan && !draftPlan && <EvidencePanel meta={meta} />}
          </section>

          {draftPlan && (
            <section aria-label='Draft calendar preview' className='calendar-section draft-calendar' id='draft-calendar'>
              <div className='calendar-section__heading'>
                <span className='section-kicker'>Preview</span>
                <h2>Draft calendar</h2>
                <p>Review the captured requirements above before using this schedule. Activities cannot be edited or shared until then.</p>
              </div>
              <PlanBoard date={calendarDate} draftPreview plan={draftPlan} timeZone={timeZone} />
              {meta && <EvidencePanel meta={meta} />}
            </section>
          )}

          {plan && (
            <section
              aria-label='Household calendar'
              className='calendar-section'
              id='calendar'
            >
              <div className='calendar-section__heading'>
                <span className='section-kicker'>Calendar</span>
                <h2>Your calendar</h2>
                <p>
                  Open an activity to adjust its date, time, or people.
                </p>
                {plan.requirements?.source === "scenario" && <p className='verified-banner'>This example was checked against its preset requirements. Open the verified checklist below to review them.</p>}
              </div>
              <PlanBoard date={calendarDate} dateChangeDisabled={Boolean(proposal || pending)} dateError={dateChangeError} onDateChange={(value) => proposePlanDate(value)} onCorrectRequirement={proposal || pending ? undefined : correctRequirement} onDetailsChange={updateEventDetails} onScheduleChange={proposal || pending ? undefined : requestScheduleEdit} persistenceUnavailable={storageUnavailable} plan={plan} timeZone={timeZone} />
              {!outdatedExample && <SharePanel
                key={`${plan.version}-${plan.updatedAt}`}
                plan={plan}
                date={calendarDate}
                dateChangeDisabled={Boolean(proposal || pending)}
                timeZone={timeZone}
                dateError={dateChangeError}
                onDateChange={(value) => proposePlanDate(value)}
                onTimeZoneChange={(value) => { setTimeZone(value); setDateChangeError(""); }}
              />}
              {meta && <EvidencePanel meta={meta} />}
            </section>
          )}
        </main>
      )}

      <footer className='site-footer'>
        <span>
          Home Huddle is an independent Alexa+ concept for the Amazon Developer
          Hackathon.
        </span>
        <span>Powered by Amazon Bedrock · For demo purposes only</span>
      </footer>
    </div>
  );
}

export default function App() {
  const token = shareTokenFromHash();
  return token !== null ? <SharedApp key={token} token={token} /> : <PlannerApp />;
}
