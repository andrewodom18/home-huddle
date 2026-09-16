import { useEffect, useRef, useState } from "react";
import {
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
import { EvidencePanel } from "./EvidencePanel";
import { CalendarIcon, ConversationIcon, HomeIcon, InfoIcon, MicIcon, ResetIcon } from "./icons";
import { PlanBoard } from "./PlanBoard";
import { PRESET_SCENARIOS, REVISION_PROMPTS } from "./presets";
import { useSpeechRecognition } from "./useSpeechRecognition";

const STORAGE_KEY = "home-huddle-state-v1";

type ConversationMessage = DisplayMessage & { contextText?: string };

const WELCOME_MESSAGE: ConversationMessage = {
  id: "welcome",
  role: "assistant",
  text: "Tell me who is involved, what needs to happen, and the time you have. I’ll shape it into a plan everyone can follow.",
};

type StoredState = {
  messages: ConversationMessage[];
  plan?: HouseholdPlan;
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

function loadState(): StoredState {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return { messages: [WELCOME_MESSAGE] };
    const stored = JSON.parse(raw) as Partial<StoredState>;
    if (!Array.isArray(stored.messages)) {
      return { messages: [WELCOME_MESSAGE] };
    }
    return {
      messages: stored.messages.slice(-13),
      plan: stored.plan,
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

export default function App() {
  const [stored] = useState(loadState);
  const [messages, setMessages] = useState<ConversationMessage[]>(stored.messages);
  const [plan, setPlan] = useState<HouseholdPlan | undefined>(stored.plan);
  const [meta, setMeta] = useState<ChatResponse["meta"] | undefined>(stored.meta);
  const [input, setInput] = useState("");
  const [pending, setPending] = useState(false);
  const [failure, setFailure] = useState<FailedRequest | null>(null);
  const requestId = useRef(0);
  const speech = useSpeechRecognition((transcript) => setInput(transcript));

  useEffect(() => {
    window.localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({ messages, plan, meta } satisfies StoredState),
    );
  }, [messages, plan, meta]);

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
      { id: createId(), role: "assistant", text: response.reply },
    ]);
    if (response.plan) setPlan(response.plan);
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

  function submitMessage(value: string, displayText?: string) {
    const message = value.trim();
    if (!message || pending) return;

    const request: ChatRequest = {
      message,
      history: asHistory(messages),
      currentPlan: plan,
    };
    setMessages((current) => [
      ...current,
      { id: createId(), role: "user", text: displayText ?? message, contextText: displayText ? message : undefined },
    ]);
    setInput("");
    void execute(request);
  }

  function reset() {
    requestId.current += 1;
    speech.stop();
    window.localStorage.removeItem(STORAGE_KEY);
    window.history.replaceState(null, "", window.location.pathname + window.location.search);
    window.scrollTo({ top: 0, behavior: "smooth" });
    setMessages([WELCOME_MESSAGE]);
    setPlan(undefined);
    setMeta(undefined);
    setInput("");
    setFailure(null);
    setPending(false);
  }

  const revisionSuggestions = plan ? REVISION_PROMPTS : [];
  const conversationMessages = messages.filter(({ id }) => id !== "welcome");
  const hasConversation = conversationMessages.length > 0 || Boolean(plan);

  const conversation = (
    <ConversationDisplay
      className={`home-huddle-conversation ${hasConversation ? "home-huddle-conversation--active" : "home-huddle-conversation--welcome"}`}
      composerAction={
        <MicButton
          disabled={pending}
          listening={speech.listening}
          onClick={speech.listening ? speech.stop : speech.start}
          supported={speech.supported}
        />
      }
      disabled={pending}
      emptyState=""
      messages={conversationMessages}
      onSubmit={submitMessage}
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
    <div className={`app-shell ${hasConversation ? "app-shell--active" : "app-shell--welcome"}`}>
      <a className="skip-link" href="#main-content">Skip to planning</a>
      <header className="site-header">
        <a aria-label="Home Huddle home" className="brand" href="#top">
          <span aria-hidden="true" className="brand-mark"><span /></span>
          <strong>Home Huddle</strong>
        </a>
        <button aria-label="New plan" className="reset-button" onClick={reset} title="New plan" type="button">
          <ResetIcon />
        </button>
      </header>

      <nav aria-label="Page sections" className="side-rail">
        <a aria-label="Start" href="#top" title="Start"><HomeIcon /></a>
        <a aria-label="Conversation" href={hasConversation ? "#conversation" : "#cdk-message-input"} title="Conversation"><ConversationIcon /></a>
        {plan && <a aria-label="Calendar" href="#calendar" title="Calendar"><CalendarIcon /></a>}
        <a aria-label="About this demo" href="#about" title="About this demo"><InfoIcon /></a>
      </nav>

      <main id="main-content">
        <section aria-label="Home Huddle conversation" className="alexa-stage" id="top">
          {!hasConversation && <h1>Hello, how can we plan together?</h1>}
          {hasConversation && <h1 className="screen-reader-only">Your household conversation</h1>}
          <div className="stage-conversation" id="conversation">
            {conversation}
            <span aria-hidden="true" className="send-hint">Send message</span>
          </div>
          {errorBanner}
          {(pending || speech.listening) && (
            <p className="conversation-feedback" role="status">
              {pending ? "Planning your schedule…" : "Listening for your message…"}
            </p>
          )}
          {!hasConversation && (
            <section aria-label="Example scenarios" className="scenario-section">
              <h2 className="screen-reader-only">Try a starting point</h2>
              <div className="scenario-grid">
                {PRESET_SCENARIOS.map((scenario) => (
                  <button
                    aria-label={`${scenario.title}. ${scenario.description}`}
                    className="scenario-chip"
                    disabled={pending}
                    key={scenario.id}
                    onClick={() => submitMessage(scenario.prompt, scenario.title)}
                    title={scenario.description}
                    type="button"
                  >
                    <span>{scenario.title}</span>
                    <span aria-hidden="true" className="scenario-chip__arrow">→</span>
                  </button>
                ))}
              </div>
            </section>
          )}
          {hasConversation && revisionSuggestions.length > 0 && (
            <PromptChips
              disabled={pending}
              label="Suggested plan revisions"
              onSelect={setInput}
              suggestions={revisionSuggestions}
            />
          )}
          <div aria-live="polite" className="calendar-prompt">
            {plan && <a href="#calendar">View shared calendar <span aria-hidden="true">↓</span></a>}
          </div>
          {hasConversation && meta && !plan && <EvidencePanel meta={meta} />}
        </section>

        {plan && <section aria-label="Household calendar" className="calendar-section" id="calendar">
          <div className="calendar-section__heading">
            <span className="section-kicker">Calendar</span>
            <h2>Your day, in one place.</h2>
            <p>See the plan at a glance, then keep the conversation going when life changes.</p>
          </div>
          <PlanBoard plan={plan} />
          {meta && <EvidencePanel meta={meta} />}
        </section>}
      </main>

      <footer className="site-footer" id="about">
        <span>Home Huddle is an independent Alexa+ concept for the Amazon Developer Hackathon.</span>
        <span>Powered by Amazon Bedrock · Use fictional details · Plans stay on this device</span>
      </footer>
    </div>
  );
}
