import { useEffect, useRef, useState } from "react";
import {
  ChangeReviewCard,
  ConversationDisplay,
  PromptChips,
  type ConversationStatusValue,
  type DisplayMessage,
} from "conversation-display-kit";
import type {
  ChatRequest,
  ChatResponse,
  HistoryMessage,
  HouseholdPlan,
} from "../shared/contracts";
import { ChatApiError, sendChat } from "./api";
import { AboutPage } from "./AboutPage";
import { EvidencePanel } from "./EvidencePanel";
import { CalendarIcon, HomeIcon, InfoIcon, MicIcon, ResetIcon } from "./icons";
import { PlanBoard } from "./PlanBoard";
import { SharePanel } from "./SharePanel";
import { SharedApp } from "./SharedApp";
import { preservedFixedCommitments, reviewChanges } from "./planDiff";
import { shareTokenFromHash } from "./shareApi";
import { PRESET_SCENARIOS, REVISION_PROMPTS } from "./presets";
import { useSpeechRecognition } from "./useSpeechRecognition";

const STORAGE_KEY = "home-huddle-state-v2";
const OLD_STORAGE_KEY = "home-huddle-state-v1";

type ConversationMessage = DisplayMessage & { contextText?: string };

const WELCOME_MESSAGE: ConversationMessage = {
  id: "welcome",
  role: "assistant",
  text: "Tell me who is involved, what needs to happen, and the time you have. I’ll shape it into a plan everyone can follow.",
};

type StoredState = {
  messages: ConversationMessage[];
  plan?: HouseholdPlan;
  proposal?: HouseholdPlan;
  undoPlan?: HouseholdPlan;
  scenarioId?: ChatRequest["scenarioId"];
  calendarDate?: string;
  timeZone?: string;
  meta?: ChatResponse["meta"];
};

type FailedRequest = {
  request: ChatRequest;
  message: string;
  retryable: boolean;
};

function createId() {
  return globalThis.crypto?.randomUUID?.() ?? `message-${Date.now()}`;
}

function today() {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
}

function defaultTimeZone() {
  return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
}

function loadState(): StoredState {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY) ?? window.localStorage.getItem(OLD_STORAGE_KEY);
    if (!raw) return { messages: [WELCOME_MESSAGE] };
    const stored = JSON.parse(raw) as Partial<StoredState>;
    if (!Array.isArray(stored.messages)) {
      return { messages: [WELCOME_MESSAGE] };
    }
    return {
      messages: stored.messages.slice(-13).map((message) =>
        message.contextText ? { ...message, text: message.contextText } : message,
      ),
      plan: stored.plan,
      proposal: stored.proposal,
      undoPlan: stored.undoPlan,
      scenarioId: stored.scenarioId,
      calendarDate: stored.calendarDate,
      timeZone: stored.timeZone,
      meta: stored.meta,
    };
  } catch {
    return { messages: [WELCOME_MESSAGE] };
  }
}

function asHistory(messages: ConversationMessage[]): HistoryMessage[] {
  const recent = messages.filter(({ id }) => id !== "welcome").slice(-12);
  const firstUser = recent.findIndex(({ role }) => role === "user");
  return (firstUser < 0 ? [] : recent.slice(firstUser)).map(({ role, text, contextText }) => ({
    role,
    text: contextText ?? text,
  }));
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
  const [proposal, setProposal] = useState<HouseholdPlan | undefined>(stored.proposal);
  const [undoPlan, setUndoPlan] = useState<HouseholdPlan | undefined>(stored.undoPlan);
  const [scenarioId, setScenarioId] = useState<ChatRequest["scenarioId"]>(stored.scenarioId ?? stored.plan?.scenarioId);
  const [calendarDate, setCalendarDate] = useState(stored.calendarDate ?? today());
  const [timeZone, setTimeZone] = useState(stored.timeZone ?? defaultTimeZone());
  const [meta, setMeta] = useState<ChatResponse["meta"] | undefined>(stored.meta);
  const [input, setInput] = useState("");
  const [showScenarios, setShowScenarios] = useState(true);
  const [pending, setPending] = useState(false);
  const [failure, setFailure] = useState<FailedRequest | null>(null);
  const requestId = useRef(0);
  const isAboutPage = new URLSearchParams(window.location.search).get("page") === "about";
  const speech = useSpeechRecognition((transcript) => setInput(transcript));

  useEffect(() => {
    document.title = isAboutPage ? "About Home Huddle" : "Home Huddle — Make room for everyone";
  }, [isAboutPage]);

  useEffect(() => {
    window.localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({ messages, plan, proposal, undoPlan, scenarioId, calendarDate, timeZone, meta } satisfies StoredState),
    );
  }, [messages, plan, proposal, undoPlan, scenarioId, calendarDate, timeZone, meta]);

  const status: ConversationStatusValue = failure
    ? "error"
    : speech.listening
      ? "listening"
      : pending
        ? "thinking"
        : "idle";

  function applyResponse(response: ChatResponse) {
    setMessages((current) => [
      ...current,
      { id: createId(), role: "assistant", text: plan && response.plan ? `Proposed revision: ${response.reply} Review the changes before applying.` : response.reply },
    ]);
    if (response.plan) {
      if (plan) setProposal(response.plan);
      else { setPlan(response.plan); setUndoPlan(undefined); }
    }
    setMeta(response.meta);
    setFailure(null);
  }

  async function execute(request: ChatRequest) {
    const activeRequest = ++requestId.current;
    setPending(true);
    setFailure(null);
    try {
      const response = await sendChat(request);
      if (activeRequest === requestId.current) applyResponse(response);
    } catch (error) {
      if (activeRequest !== requestId.current) return;
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

  function submitMessage(value: string, selectedScenarioId?: ChatRequest["scenarioId"]) {
    const message = value.trim();
    if (!message || pending || proposal) return;

    const request: ChatRequest = {
      message,
      history: asHistory(messages),
      currentPlan: plan,
      scenarioId: selectedScenarioId ?? scenarioId,
    };
    if (selectedScenarioId) setScenarioId(selectedScenarioId);
    setMessages((current) => [
      ...current,
      { id: createId(), role: "user", text: message },
    ]);
    setInput("");
    void execute(request);
  }

  function reset() {
    requestId.current += 1;
    speech.stop();
    window.localStorage.removeItem(STORAGE_KEY);
    window.localStorage.removeItem(OLD_STORAGE_KEY);
    window.history.replaceState(null, "", window.location.pathname + window.location.search);
    window.scrollTo({ top: 0, behavior: "smooth" });
    setMessages([WELCOME_MESSAGE]);
    setPlan(undefined);
    setProposal(undefined);
    setUndoPlan(undefined);
    setScenarioId(undefined);
    setCalendarDate(today());
    setTimeZone(defaultTimeZone());
    setMeta(undefined);
    setInput("");
    setShowScenarios(true);
    setFailure(null);
    setPending(false);
  }

  const revisionSuggestions = plan ? REVISION_PROMPTS : [];
  const conversationMessages = messages.filter(({ id }) => id !== "welcome");
  const hasConversation = conversationMessages.length > 0 || Boolean(plan);
  const changes = plan && proposal ? reviewChanges(plan, proposal) : [];
  const fixed = plan && proposal ? preservedFixedCommitments(plan, proposal) : [];

  function applyProposal() {
    if (!proposal) return;
    setUndoPlan(plan);
    setPlan(proposal);
    setProposal(undefined);
    setMessages((current) => [...current, { id: createId(), role: "assistant", text: "Revision applied. You can undo it if you change your mind." }]);
  }

  function keepCurrent() {
    setProposal(undefined);
    setMessages((current) => [...current, { id: createId(), role: "assistant", text: "Kept your current plan." }]);
  }

  function undoRevision() {
    if (!plan || !undoPlan) return;
    setPlan({ ...undoPlan, version: plan.version + 1, updatedAt: new Date().toISOString() });
    setUndoPlan(undefined);
    setMessages((current) => [...current, { id: createId(), role: "assistant", text: "Restored the previous plan." }]);
  }

  function correctRequirement(id: string, label: string) {
    setInput(id === "window" ? "Correct time window: " : `Correct requirement ${id}: `);
    setMessages((current) => [...current, { id: createId(), role: "assistant", text: `What should I change about ${label}? Add the correction in the message box.` }]);
    document.getElementById("conversation")?.scrollIntoView({ behavior: "smooth" });
    window.setTimeout(() => document.getElementById("cdk-message-input")?.focus(), 100);
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
      onSubmit={(value) => submitMessage(value)}
      onValueChange={setInput}
      placeholder="Ask Home Huddle"
      status={status}
      submitLabel={pending ? "Planning…" : "Send"}
      value={input}
    />
  );

  const errorBanner = (speech.error || failure) && (
    <div className="error-banner" role="alert">
      <div>
        <strong>{failure ? "Planning paused" : "Voice input paused"}</strong>
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
            <div className='stage-conversation' id='conversation'>
              {conversation}
              <span aria-hidden='true' className='send-hint'>
                Send message
              </span>
            </div>
            {errorBanner}
            {(pending || speech.listening) && (
              <p className='conversation-feedback' role='status'>
                {pending
                  ? 'Planning your schedule…'
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
                  {PRESET_SCENARIOS.map((scenario) => (
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
                    document.querySelector<HTMLInputElement>('.cdk-composer input')?.focus();
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
                onSelect={setInput}
                suggestions={revisionSuggestions}
              />
            )}
            {plan && proposal && (
              <div className='proposal-wrap' role='region' aria-label='Proposed revision'>
                <ChangeReviewCard
                  title='Review this revision'
                  summary={`${changes.length} changed ${changes.length === 1 ? "activity" : "activities"}. ${fixed.length ? `Preserved: ${fixed.join("; ")}.` : "Review the changes before applying."}`}
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
            {hasConversation && meta && !plan && <EvidencePanel meta={meta} />}
          </section>

          {plan && (
            <section
              aria-label='Household calendar'
              className='calendar-section'
              id='calendar'
            >
              <div className='calendar-section__heading'>
                <span className='section-kicker'>Calendar</span>
                <h2>Your day, in one place.</h2>
                <p>
                  See the plan at a glance, then keep the conversation going
                  when life changes.
                </p>
              </div>
              <PlanBoard date={calendarDate} onCorrectRequirement={correctRequirement} plan={plan} />
              <SharePanel
                key={`${plan.version}-${plan.updatedAt}`}
                plan={plan}
                date={calendarDate}
                timeZone={timeZone}
                onDateChange={setCalendarDate}
                onTimeZoneChange={setTimeZone}
              />
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
  return token ? <SharedApp token={token} /> : <PlannerApp />;
}
