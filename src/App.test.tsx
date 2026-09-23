import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { chatRequestSchema, type ChatResponse, type HouseholdPlan } from "../shared/contracts";
import { SCENARIO_REQUIREMENTS } from "../shared/scenarios";
import App from "./App";
import { PRESET_SCENARIOS, presetScenarios } from "./presets";
import { scenarioDates } from "../shared/scenarios";
import { formatPlanDate, suggestedPlanDate, todayInZone } from "./planDate";

beforeEach(() => {
  // These calendar fixtures are anchored in September 2026.
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-09-18T12:00:00Z"));
});

afterEach(() => vi.useRealTimers());

const plan: HouseholdPlan = {
  title: "A calmer evening",
  objective: "Finish dinner and homework before 8:00 PM.",
  participants: ["Maya", "Leo", "Jordan"],
  items: [
    {
      id: "plan-1-1",
      startTime: "5:30 PM",
      durationMinutes: 30,
      task: "Prepare dinner",
      assignee: "Jordan",
    },
  ],
  notes: ["Keep one adult available."],
  version: 1,
  updatedAt: "2026-09-15T18:00:00.000Z",
};

const success: ChatResponse = {
  reply: "I balanced dinner and homework before 8:00 PM.",
  plan,
  meta: {
    provider: "Amazon Bedrock",
    modelId: "us.amazon.nova-2-lite-v1:0",
    toolUsed: true,
    latencyMs: 842,
  },
};

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

describe("Home Huddle", () => {
  it("shows a reliable text experience when voice input is unavailable", () => {
    const { container } = render(<App />);

    expect(container.querySelector(".brand-mark")).toHaveAttribute("src", "/favicon.svg");
    expect(
      screen.getByRole("button", {
        name: "Voice input unavailable in this browser",
      }),
    ).toHaveAttribute("aria-disabled", "true");
    expect(screen.getByLabelText("Message")).toBeEnabled();
    expect(screen.queryByRole("region", { name: "Household calendar" })).not.toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "Calendar" })).not.toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "Conversation" })).not.toBeInTheDocument();
    expect(screen.getByRole("link", { name: "About this demo" })).toHaveAttribute("href", "?page=about");
  });

  it("dismisses example scenarios and restores them with a new plan", async () => {
    const user = userEvent.setup();
    render(<App />);

    const dismiss = screen.getByRole("button", { name: "Dismiss example scenarios" });
    expect(dismiss).toHaveAttribute("title", "Hide example scenarios");
    await user.click(dismiss);

    expect(screen.queryByRole("region", { name: "Example scenarios" })).not.toBeInTheDocument();
    expect(screen.getByRole("textbox", { name: "Message" })).toHaveFocus();

    await user.click(screen.getByRole("button", { name: "New plan" }));
    expect(screen.getByRole("region", { name: "Example scenarios" })).toBeInTheDocument();
    expect(screen.getAllByRole("button", { name: /The school-week rhythm|Share the chores|Three family outings/ })).toHaveLength(3);
  });

  it.each(["Hello!", "Thank you!"])("answers %s locally without using the Bedrock API", async (message) => {
    const fetchMock = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) => {
      void _input;
      void _init;
      return jsonResponse({ ...success, plan: undefined });
    });
    vi.stubGlobal("fetch", fetchMock);
    const user = userEvent.setup();
    render(<App />);

    await user.type(screen.getByRole("textbox", { name: "Message" }), `${message}{Enter}`);

    expect(screen.getByLabelText("user message")).toHaveTextContent(message);
    expect(screen.getByLabelText("assistant message")).toHaveTextContent(message.startsWith("Hello") ? "Hi! Tell me" : "You're welcome!");
    expect(screen.getByRole("log", { name: "Conversation messages" })).toHaveAttribute("tabindex", "0");
    expect(fetchMock).not.toHaveBeenCalled();
    expect(screen.queryByRole("region", { name: "Household calendar" })).not.toBeInTheDocument();

    await user.type(screen.getByRole("textbox", { name: "Message" }), "Plan dinner for Maya at 6 PM{Enter}");
    await waitFor(() => expect(fetchMock).toHaveBeenCalledOnce());
    const request = JSON.parse(String(fetchMock.mock.calls[0][1]?.body));
    expect(request.history).toEqual([]);
  });

  it("uses neutral thinking language for a substantive non-planning question", async () => {
    let resolveRequest: (response: Response) => void = () => undefined;
    const pendingResponse = new Promise<Response>((resolve) => {
      resolveRequest = resolve;
    });
    const fetchMock = vi.fn(() => pendingResponse);
    vi.stubGlobal("fetch", fetchMock);
    const user = userEvent.setup();
    render(<App />);

    await user.type(screen.getByRole("textbox", { name: "Message" }), "What is a volcano?{Enter}");

    expect(screen.getByRole("status")).toHaveTextContent("Thinking about your message…");
    expect(fetchMock).toHaveBeenCalledOnce();
    await act(async () => resolveRequest(jsonResponse({ ...success, reply: "I can help with a household plan.", plan: undefined })));
    expect(await screen.findByText("I can help with a household plan.")).toBeInTheDocument();
  });

  it("keeps a failed request and its retry action visible after reload", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => jsonResponse({
      error: { code: "INVALID_TOOL_OUTPUT", message: "The requested move conflicts with the schedule.", retryable: true },
    }, 502)));
    const user = userEvent.setup();
    const first = render(<App />);

    await user.type(screen.getByRole("textbox", { name: "Message" }), "Move dinner later{Enter}");
    expect(await screen.findByText("The requested move conflicts with the schedule.")).toBeInTheDocument();
    await waitFor(() => expect(JSON.parse(window.localStorage.getItem("home-huddle-state-v2") ?? "{}").failure?.message)
      .toBe("The requested move conflicts with the schedule."));

    first.unmount();
    render(<App />);
    expect(screen.getByText("The requested move conflicts with the schedule.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Retry" })).toBeInTheDocument();
  });

  it.each(PRESET_SCENARIOS)("shows and sends the complete $title scenario", async (legacyScenario) => {
    const anchor = todayInZone(Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC");
    const scenario = presetScenarios(anchor).find((candidate) => candidate.id === legacyScenario.id)!;
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      void input;
      void init;
      return jsonResponse({ ...success, plan: undefined });
    });
    vi.stubGlobal("fetch", fetchMock);
    const user = userEvent.setup();
    render(<App />);

    await user.click(screen.getByRole("button", { name: `${scenario.title}. ${scenario.description}` }));

    expect(screen.getByLabelText("user message")).toHaveTextContent(scenario.prompt);
    await screen.findByText(success.reply);
    const request = JSON.parse(String(fetchMock.mock.calls[0][1]?.body));
    expect(request.message).toBe(scenario.prompt);
    expect(request.scenarioId).toBe(scenario.id);
    expect(request.planDate).toBe(anchor);
    expect(request.timeZone).toBeTruthy();
    expect(chatRequestSchema.safeParse(request).success).toBe(true);
  });

  it("expands older shortened scenario messages when restoring a conversation", () => {
    window.localStorage.setItem("home-huddle-state-v1", JSON.stringify({
      messages: [{ id: "preset", role: "user", text: "Dinner + homework", contextText: PRESET_SCENARIOS[0].prompt }],
    }));

    render(<App />);

    expect(screen.getByLabelText("user message")).toHaveTextContent(PRESET_SCENARIOS[0].prompt);
  });

  it("offers a focused correction path for an interpreted checklist", async () => {
    window.localStorage.setItem("home-huddle-state-v2", JSON.stringify({
      messages: [{ id: "plan", role: "assistant", text: "Your plan is ready." }],
      plan: {
        ...plan,
        requirements: {
          source: "interpreted",
          timeWindow: { startTime: "5:30 PM", endTime: "8:00 PM" },
          tasks: [{ id: "dinner", label: "Prepare dinner", durationMinutes: 30 }],
        },
      },
    }));
    const user = userEvent.setup();
    render(<App />);

    await user.click(screen.getByText("Interpreted checklist — review it"));
    await user.click(screen.getByTitle("Correct the interpreted requirement for Prepare dinner"));
    expect(screen.getByRole("textbox", { name: "Message" })).toHaveValue("Correct requirement dinner: ");
    expect(screen.getByText(/What should I change about Prepare dinner/)).toBeInTheDocument();
  });

  it("opens a dedicated About view instead of an empty footer anchor", () => {
    window.history.replaceState(null, "", "/?page=about");

    render(<App />);

    expect(screen.getByRole("heading", { name: "Make room for everyone’s day." })).toBeInTheDocument();
    expect(document.title).toBe("About Home Huddle");
    expect(screen.queryByRole("textbox", { name: "Message" })).not.toBeInTheDocument();
    expect(screen.getByRole("link", { name: /Start planning/i })).toHaveAttribute("href", "./");
    expect(screen.getByRole("link", { name: "About this demo" })).toHaveAttribute("aria-current", "page");
  });

  it("shows a read-only error for a malformed share link", async () => {
    window.history.replaceState(null, "", "/#share=invalid");
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    render(<App />);

    expect(await screen.findByRole("alert")).toHaveTextContent("This view link is invalid.");
    expect(screen.queryByRole("textbox", { name: "Message" })).not.toBeInTheDocument();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("runs a preset and renders the resulting Bedrock plan", async () => {
    const fetchMock = vi.fn(
      async (input: RequestInfo | URL, init?: RequestInit) => {
        void input;
        void init;
        return jsonResponse(success);
      },
    );
    vi.stubGlobal("fetch", fetchMock);
    const user = userEvent.setup();
    render(<App />);

    await user.click(
      screen.getByRole("button", { name: /The school-week rhythm/i }),
    );

    expect(
      await screen.findByText("I balanced dinner and homework before 8:00 PM."),
    ).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "A calmer evening" })).toBeInTheDocument();
    expect(screen.getAllByText("Prepare dinner").length).toBeGreaterThan(0);
    expect(screen.getByText("Plan v1")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "View shared calendar" })).toHaveAttribute("href", "#calendar");
    expect(screen.getByRole("region", { name: "Household calendar" })).toBeInTheDocument();

    const request = JSON.parse(
      String(fetchMock.mock.calls[0][1]?.body),
    );
    expect(request.message).toContain("Jordan's Monday call is fixed at 6:30–6:50 PM");
    expect(request.history).toEqual([]);
    expect(screen.queryByText("Good to know")).not.toBeInTheDocument();
    expect(screen.getByLabelText("Plan date")).toBeInTheDocument();
  });

  it("uses an upcoming Saturday for chores and lets the user correct the plan date", async () => {
    const anchor = todayInZone(Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC");
    const choresDate = scenarioDates(anchor).chores;
    const chores = presetScenarios(anchor).find((scenario) => scenario.id === "chores")!;
    vi.stubGlobal("fetch", vi.fn(async () => jsonResponse({
      ...success,
      plan: { ...plan, title: "Saturday chores", objective: "Share chores fairly, with a break.", items: plan.items.map((item) => ({ ...item, date: choresDate })), notes: ["Riley only does laundry tasks"] },
    })));
    const user = userEvent.setup();
    render(<App />);

    await user.click(screen.getByRole("button", { name: `${chores.title}. ${chores.description}` }));
    expect(await screen.findByRole("heading", { name: "Saturday chores" })).toBeInTheDocument();
    const date = screen.getByLabelText("Plan date");
    expect(date).toHaveValue(choresDate);
    expect(screen.getByText("Riley only does laundry tasks")).toBeInTheDocument();

    const confirmation = screen.getByRole("checkbox", { name: "I confirm this date and time zone are correct." });
    await user.click(confirmation);
    expect(confirmation).toBeChecked();
    const nextSaturday = suggestedPlanDate("next Saturday", new Date(`${choresDate}T12:00:00`))!;
    fireEvent.change(date, { target: { value: nextSaturday } });
    expect(screen.getByRole("region", { name: "Proposed revision" })).toHaveTextContent(formatPlanDate(nextSaturday));
    expect(date).toHaveValue(choresDate);
    await user.click(screen.getByRole("button", { name: "Apply" }));
    expect(screen.getByLabelText("Plan date")).toHaveValue(nextSaturday);
    expect(screen.getByRole("checkbox", { name: "I confirm this date and time zone are correct." })).not.toBeChecked();
  });

  it("proposes a whole-plan date change in chat and can undo it without a model call", async () => {
    window.localStorage.setItem("home-huddle-state-v2", JSON.stringify({
      messages: [{ id: "plan", role: "assistant", text: "Your plan is ready." }],
      plan: { ...plan, title: "Saturday chores", objective: "Split Saturday chores fairly." },
      calendarDate: "2026-09-19",
    }));
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const user = userEvent.setup();
    render(<App />);

    await user.type(screen.getByRole("textbox", { name: "Message" }), "Move the plan to Sunday{Enter}");
    expect(fetchMock).not.toHaveBeenCalled();
    expect(screen.getByRole("region", { name: "Proposed revision" })).toHaveTextContent("Sunday, September 20, 2026");
    expect(screen.getByLabelText("Plan date")).toHaveValue("2026-09-19");
    await user.click(screen.getByRole("button", { name: "Apply" }));
    expect(screen.getByLabelText("Plan date")).toHaveValue("2026-09-20");
    expect(screen.getByRole("heading", { name: "Sunday chores" })).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Undo accepted revision" }));
    expect(screen.getByLabelText("Plan date")).toHaveValue("2026-09-19");
    expect(screen.getByRole("heading", { name: "Saturday chores" })).toBeInTheDocument();
  });

  it("warns locally and keeps the current plan when a whole-plan move would be in the past", () => {
    window.localStorage.setItem("home-huddle-state-v2", JSON.stringify({
      messages: [{ id: "plan", role: "assistant", text: "Your plan is ready." }],
      plan,
      calendarDate: "2026-09-19",
      timeZone: "America/Chicago",
    }));
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    render(<App />);

    fireEvent.change(screen.getByLabelText("Plan date"), { target: { value: "2000-01-01" } });
    expect(screen.getByRole("alert")).toHaveTextContent("Prepare dinner");
    expect(screen.getByRole("alert")).toHaveTextContent("in the past in America/Chicago");
    expect(screen.getByLabelText("Plan date")).toHaveValue("2026-09-19");
    expect(screen.queryByRole("region", { name: "Proposed revision" })).not.toBeInTheDocument();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it.each([
    ["2027-03-14", "2:30 AM", 30, "does not exist"],
    ["2026-11-01", "1:30 AM", 30, "occurs twice"],
    ["2027-03-14", "1:50 AM", 20, "crosses a daylight-saving change"],
    ["2026-11-01", "12:50 AM", 80, "crosses a daylight-saving change"],
  ])("keeps the accepted plan when date picker or chat moves into invalid daylight-saving timing on %s at %s", async (date, startTime, durationMinutes, issue) => {
    window.localStorage.setItem("home-huddle-state-v2", JSON.stringify({
      messages: [{ id: "plan", role: "assistant", text: "Your plan is ready." }],
      plan: { ...plan, items: [{ ...plan.items[0], startTime, durationMinutes }] },
      calendarDate: "2026-10-01",
      timeZone: "America/Chicago",
    }));
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const user = userEvent.setup();
    render(<App />);

    fireEvent.change(screen.getByLabelText("Plan date"), { target: { value: date } });
    expect(screen.getByRole("alert")).toHaveTextContent(issue);
    expect(screen.getByLabelText("Plan date")).toHaveValue("2026-10-01");
    expect(screen.queryByRole("region", { name: "Proposed revision" })).not.toBeInTheDocument();

    await user.type(screen.getByRole("textbox", { name: "Message" }), `Move the plan to ${date}{Enter}`);
    expect(screen.getAllByLabelText("assistant message").at(-1)).toHaveTextContent(issue);
    expect(screen.getByLabelText("Plan date")).toHaveValue("2026-10-01");
    expect(screen.queryByRole("region", { name: "Proposed revision" })).not.toBeInTheDocument();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("sends an event-specific date revision to the planner instead of moving the whole plan", async () => {
    const datedPlan: HouseholdPlan = {
      ...plan,
      items: [{ ...plan.items[0], taskId: "dinner", date: "2026-09-19" }],
      requirements: { source: "interpreted", timeWindow: { startTime: "5:00 PM", endTime: "8:00 PM" }, tasks: [{ id: "dinner", label: "Prepare dinner", durationMinutes: 30 }] },
    };
    const revisedPlan: HouseholdPlan = { ...datedPlan, items: [{ ...datedPlan.items[0], date: "2026-10-13" }], version: 2 };
    window.localStorage.setItem("home-huddle-state-v2", JSON.stringify({
      messages: [{ id: "plan", role: "assistant", text: "Your plan is ready." }],
      plan: datedPlan,
      calendarDate: "2026-09-19",
    }));
    const fetchMock = vi.fn<typeof fetch>(async () => jsonResponse({ ...success, plan: revisedPlan }));
    vi.stubGlobal("fetch", fetchMock);
    const user = userEvent.setup();
    render(<App />);

    await user.type(screen.getByRole("textbox", { name: "Message" }), "Move dinner to October 13, 2026{Enter}");
    await waitFor(() => expect(fetchMock).toHaveBeenCalledOnce());
    expect(JSON.parse(String(fetchMock.mock.calls[0][1]?.body)).message).toBe("Move dinner to October 13, 2026");
    expect(await screen.findByRole("region", { name: "Proposed revision" })).toHaveTextContent("2026-10-13");
    expect(screen.getByLabelText("Plan date")).toHaveValue("2026-09-19");
  });

  it("marks a saved example with older checks as outdated and blocks sharing", () => {
    window.localStorage.setItem("home-huddle-state-v2", JSON.stringify({
      messages: [{ id: "plan", role: "assistant", text: "Your plan is ready." }],
      plan: { ...plan, scenarioId: "chores", requirements: { ...SCENARIO_REQUIREMENTS.chores, ordering: undefined } },
      calendarDate: "2026-09-17",
    }));
    render(<App />);

    expect(screen.getByText(/made before the current schedule checks/)).toBeInTheDocument();
    expect(screen.getByText("Earlier example checklist — regenerate")).toBeInTheDocument();
    expect(screen.queryByText("Verified example checklist")).not.toBeInTheDocument();
    expect(screen.queryByText("Share or export this plan")).not.toBeInTheDocument();
  });

  it("keeps the request visible and retries a temporary failure", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        jsonResponse(
          {
            error: {
              code: "BEDROCK_UNAVAILABLE",
              message: "Amazon Bedrock is temporarily unavailable.",
              retryable: true,
            },
          },
          503,
        ),
      )
      .mockResolvedValueOnce(jsonResponse(success));
    vi.stubGlobal("fetch", fetchMock);
    const user = userEvent.setup();
    render(<App />);

    await user.click(
      screen.getByRole("button", { name: /The school-week rhythm/i }),
    );
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Amazon Bedrock is temporarily unavailable.",
    );
    expect(screen.getByLabelText("user message")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Retry" }));
    expect(await screen.findByText("Plan v1")).toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("reviews, applies, and undoes a conversational revision", async () => {
    const originalPlan: HouseholdPlan = {
      ...plan,
      items: [{ ...plan.items[0], taskId: "dinner", details: "Use the prepared ingredients." }],
    };
    window.localStorage.setItem(
      "home-huddle-state-v1",
      JSON.stringify({
        messages: [
          { id: "welcome", role: "assistant", text: "Welcome" },
          { id: "plan", role: "assistant", text: "The plan is ready." },
        ],
        plan: originalPlan,
        meta: success.meta,
      }),
    );
    const revisedPlan: HouseholdPlan = {
      ...originalPlan,
      title: "A later evening",
      items: [
        {
          ...originalPlan.items[0],
          id: "plan-2-1",
          startTime: "5:45 PM",
          details: undefined,
        },
      ],
      version: 2,
      updatedAt: "2026-09-15T18:05:00.000Z",
    };
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        jsonResponse({
          ...success,
          reply: "I moved dinner 15 minutes later.",
          plan: revisedPlan,
        }),
      ),
    );
    const user = userEvent.setup();
    render(<App />);

    await user.type(screen.getByLabelText("Message"), "Move dinner later{Enter}");

    expect(await screen.findByRole("heading", { name: "Review this revision" })).toBeInTheDocument();
    expect(screen.getByText("Plan v1")).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "A later evening" })).not.toBeInTheDocument();
    screen.getByRole("button", { name: "Apply" }).focus();
    await user.keyboard("{Enter}");
    expect(screen.getByText("Plan v2")).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "A later evening" })).toBeInTheDocument();
    expect(screen.getAllByText("5:45 PM").length).toBeGreaterThan(0);
    await waitFor(() => expect(JSON.parse(window.localStorage.getItem("home-huddle-state-v2") ?? "{}").plan.items[0].details)
      .toBe("Use the prepared ingredients."));
    await user.click(screen.getByRole("button", { name: "Undo accepted revision" }));
    expect(screen.getByText("Plan v3")).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "A calmer evening" })).toBeInTheDocument();
    await waitFor(() => expect(JSON.parse(window.localStorage.getItem("home-huddle-state-v2") ?? "{}").plan.items[0].details)
      .toBe("Use the prepared ingredients."));
  });

  it("routes calendar time and assignee edits through the chat review flow", async () => {
    const editablePlan: HouseholdPlan = {
      ...plan,
      items: [{ ...plan.items[0], id: "task-dinner", taskId: "dinner" }],
      requirements: {
        source: "interpreted",
        timeWindow: { startTime: "5:00 PM", endTime: "8:00 PM" },
        tasks: [{ id: "dinner", label: "Prepare dinner", durationMinutes: 30 }],
      },
    };
    const revisedPlan: HouseholdPlan = {
      ...editablePlan,
      items: [{ ...editablePlan.items[0], startTime: "6:00 PM", assignee: "Maya" }],
      version: 2,
      updatedAt: "2026-09-15T18:05:00.000Z",
    };
    window.localStorage.setItem("home-huddle-state-v2", JSON.stringify({
      messages: [{ id: "plan", role: "assistant", text: "Your plan is ready." }],
      plan: editablePlan,
      calendarDate: "2026-09-19",
    }));
    const fetchMock = vi.fn<typeof fetch>(async () => jsonResponse({ ...success, plan: revisedPlan }));
    vi.stubGlobal("fetch", fetchMock);
    HTMLDialogElement.prototype.showModal = function () { this.setAttribute("open", ""); };
    HTMLDialogElement.prototype.close = function () { this.removeAttribute("open"); };
    const user = userEvent.setup();
    render(<App />);

    await user.click(screen.getAllByRole("button", { name: /Open details for Prepare dinner/ })[0]);
    await user.type(screen.getByRole("textbox", { name: "Additional details" }), "Use the prepared ingredients.");
    fireEvent.change(screen.getByLabelText("Activity start time"), { target: { value: "18:00" } });
    await user.click(screen.getByRole("checkbox", { name: "Jordan" }));
    await user.click(screen.getByRole("checkbox", { name: "Maya" }));
    await user.click(screen.getByRole("button", { name: "Review schedule change" }));

    await waitFor(() => expect(fetchMock).toHaveBeenCalledOnce());
    const request = JSON.parse(String(fetchMock.mock.calls[0][1]?.body));
    expect(request.edit).toEqual({ taskId: "dinner", startTime: "6:00 PM", assignees: ["Maya"] });
    expect(request.message).toContain("Update “Prepare dinner”");
    expect(await screen.findByRole("region", { name: "Proposed revision" })).toHaveTextContent("6:00 PM");
    await waitFor(() => expect(screen.getByRole("region", { name: "Proposed revision" })).toHaveFocus());
    expect(screen.getByText("Plan v1")).toBeInTheDocument();
    await waitFor(() => expect(JSON.parse(window.localStorage.getItem("home-huddle-state-v2") ?? "{}").plan.items[0].details)
      .toBe("Use the prepared ingredients."));
    await user.click(screen.getByRole("button", { name: "Apply" }));
    expect(screen.getByText("Plan v2")).toBeInTheDocument();
    expect(screen.getAllByRole("button", { name: /Open details for Prepare dinner, 6:00 PM, assigned to Maya/ }).length).toBeGreaterThan(0);
    expect(JSON.parse(window.localStorage.getItem("home-huddle-state-v2") ?? "{}").plan.items[0].details).toBe("Use the prepared ingredients.");
    await user.click(screen.getByRole("button", { name: "Undo accepted revision" }));
    expect(screen.getAllByRole("button", { name: /Open details for Prepare dinner, 5:30 PM, assigned to Jordan/ }).length).toBeGreaterThan(0);
  });

  it("moves focus to a calendar edit error while keeping the newly saved note", async () => {
    const editablePlan: HouseholdPlan = {
      ...plan,
      items: [{ ...plan.items[0], id: "task-dinner", taskId: "dinner", date: "2026-09-19" }],
      requirements: {
        source: "interpreted",
        timeWindow: { startTime: "5:00 PM", endTime: "8:00 PM" },
        tasks: [{ id: "dinner", date: "2026-09-19", label: "Prepare dinner", durationMinutes: 30 }],
      },
    };
    window.localStorage.setItem("home-huddle-state-v2", JSON.stringify({
      messages: [{ id: "plan", role: "assistant", text: "Your plan is ready." }],
      plan: editablePlan,
      calendarDate: "2026-09-19",
    }));
    vi.stubGlobal("fetch", vi.fn(async () => jsonResponse({
      error: { code: "VALIDATION", message: "That start time conflicts with another activity.", retryable: false },
    }, 400)));
    HTMLDialogElement.prototype.showModal = function () { this.setAttribute("open", ""); };
    HTMLDialogElement.prototype.close = function () { this.removeAttribute("open"); };
    const user = userEvent.setup();
    render(<App />);

    await user.click(screen.getAllByRole("button", { name: /Open details for Prepare dinner/ })[0]);
    await user.type(screen.getByRole("textbox", { name: "Additional details" }), "Bring the timer.");
    fireEvent.change(screen.getByLabelText("Activity start time"), { target: { value: "18:00" } });
    await user.click(screen.getByRole("button", { name: "Review schedule change" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("That start time conflicts");
    await waitFor(() => expect(screen.getByRole("alert")).toHaveFocus());
    expect(JSON.parse(window.localStorage.getItem("home-huddle-state-v2") ?? "{}").plan.items[0].details).toBe("Bring the timer.");
  });

  it("reviews a calendar date edit across nonconsecutive weeks and restores it on undo", async () => {
    const multiPlan: HouseholdPlan = {
      ...plan,
      title: "Across the month",
      items: [
        { ...plan.items[0], id: "task-dinner", taskId: "dinner", date: "2026-09-21" },
        { id: "task-library", taskId: "library", date: "2026-09-23", startTime: "4:00 PM", durationMinutes: 30, task: "Library visit", assignee: "Maya" },
        { id: "task-call", taskId: "call", date: "2026-10-12", startTime: "6:00 PM", durationMinutes: 20, task: "Family call", assignee: "Leo" },
      ],
      requirements: {
        source: "interpreted",
        timeWindow: { startTime: "4:00 PM", endTime: "8:00 PM" },
        tasks: [
          { id: "dinner", label: "Prepare dinner", durationMinutes: 30, date: "2026-09-21" },
          { id: "library", label: "Library visit", durationMinutes: 30, date: "2026-09-23" },
          { id: "call", label: "Family call", durationMinutes: 20, date: "2026-10-12" },
        ],
      },
    };
    const revisedPlan: HouseholdPlan = {
      ...multiPlan,
      items: multiPlan.items.map((item) => item.taskId === "library" ? { ...item, date: "2026-10-13" } : item),
      requirements: { ...multiPlan.requirements!, tasks: multiPlan.requirements!.tasks.map((task) => task.id === "library" ? { ...task, date: "2026-10-13" } : task) },
      version: 2,
    };
    window.localStorage.setItem("home-huddle-state-v2", JSON.stringify({
      messages: [{ id: "plan", role: "assistant", text: "Your plan is ready." }], plan: multiPlan, calendarDate: "2026-09-21",
    }));
    const fetchMock = vi.fn<typeof fetch>(async () => jsonResponse({ ...success, plan: revisedPlan }));
    vi.stubGlobal("fetch", fetchMock);
    HTMLDialogElement.prototype.showModal = function () { this.setAttribute("open", ""); };
    HTMLDialogElement.prototype.close = function () { this.removeAttribute("open"); };
    const user = userEvent.setup();
    render(<App />);

    const days = screen.getByRole("navigation", { name: "Schedule days" });
    expect(within(days).getAllByRole("button", { name: /Sep 21|Sep 23|Oct 12/ })).toHaveLength(3);
    expect(screen.queryByLabelText("Plan date")).not.toBeInTheDocument();
    await user.click(within(days).getByRole("button", { name: /Sep 23/ }));
    await user.click(screen.getAllByRole("button", { name: /Open details for Library visit/ })[0]);
    fireEvent.change(screen.getByLabelText("Activity date"), { target: { value: "2026-10-13" } });
    await user.click(screen.getByRole("button", { name: "Review schedule change" }));

    await waitFor(() => expect(fetchMock).toHaveBeenCalledOnce());
    expect(JSON.parse(String(fetchMock.mock.calls[0][1]?.body)).edit).toEqual({ taskId: "library", date: "2026-10-13" });
    expect(await screen.findByRole("region", { name: "Proposed revision" })).toHaveTextContent("2026-10-13");
    await user.click(screen.getByRole("button", { name: "Apply" }));
    expect(within(days).getByRole("button", { name: /Oct 13/ })).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Undo accepted revision" }));
    expect(within(days).getByRole("button", { name: /Sep 23/ })).toBeInTheDocument();
  });

  it("saves an activity note on this device and restores it after reload", async () => {
    HTMLDialogElement.prototype.showModal = function () { this.setAttribute("open", ""); };
    HTMLDialogElement.prototype.close = function () { this.removeAttribute("open"); };
    window.localStorage.setItem("home-huddle-state-v2", JSON.stringify({
      messages: [{ id: "plan", role: "assistant", text: "Your plan is ready." }],
      plan,
    }));
    const user = userEvent.setup();
    const first = render(<App />);

    await user.click(screen.getAllByRole("button", { name: /Open details for Prepare dinner/ })[0]);
    await user.type(screen.getByRole("textbox", { name: "Additional details" }), "Use the prepared ingredients.");
    await user.click(screen.getByRole("button", { name: "Save details" }));
    await waitFor(() => expect(JSON.parse(window.localStorage.getItem("home-huddle-state-v2") ?? "{}").plan.items[0].details)
      .toBe("Use the prepared ingredients."));

    first.unmount();
    render(<App />);
    await user.click(screen.getAllByRole("button", { name: /Open details for Prepare dinner/ })[0]);
    expect(screen.getByRole("textbox", { name: "Additional details" })).toHaveValue("Use the prepared ingredients.");
  });

  it("resets saved conversation and plan state", async () => {
    window.localStorage.setItem(
      "home-huddle-state-v1",
      JSON.stringify({
        messages: [{ id: "old", role: "assistant", text: "Old session" }],
        plan,
      }),
    );
    const user = userEvent.setup();
    render(<App />);

    expect(screen.getByText("Old session")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: /New plan/i }));

    expect(screen.queryByText("Old session")).not.toBeInTheDocument();
    expect(screen.queryByText("Plan v1")).not.toBeInTheDocument();
    expect(screen.queryByRole("region", { name: "Household calendar" })).not.toBeInTheDocument();
    expect(
      screen.getByRole("heading", { name: "Hello, how can we plan together?" }),
    ).toBeInTheDocument();
    await waitFor(() => {
      const persisted = JSON.parse(
        window.localStorage.getItem("home-huddle-state-v1") ?? "{}",
      );
      expect(persisted.plan).toBeUndefined();
    });
  });

  it("keeps the calendar hidden when the assistant asks for more details", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => jsonResponse({ ...success, plan: undefined })));
    const user = userEvent.setup();
    render(<App />);

    await user.click(screen.getByRole("button", { name: /The school-week rhythm/i }));

    expect(await screen.findByText(success.reply)).toBeInTheDocument();
    expect(screen.queryByRole("region", { name: "Household calendar" })).not.toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "View shared calendar" })).not.toBeInTheDocument();
  });

  it("does not restore a cleared plan when an old request finishes", async () => {
    let resolveRequest: (response: Response) => void = () => undefined;
    const pendingResponse = new Promise<Response>((resolve) => {
      resolveRequest = resolve;
    });
    vi.stubGlobal("fetch", vi.fn(() => pendingResponse));
    const user = userEvent.setup();
    render(<App />);

    await user.click(screen.getByRole("button", { name: /The school-week rhythm/i }));
    expect(screen.getByRole("status")).toHaveTextContent("Thinking about your message…");
    await user.click(screen.getByRole("button", { name: "New plan" }));
    await act(async () => resolveRequest(jsonResponse(success)));

    expect(screen.getByRole("heading", { name: "Hello, how can we plan together?" })).toBeInTheDocument();
    expect(screen.queryByText(success.reply)).not.toBeInTheDocument();
    expect(screen.queryByRole("region", { name: "Household calendar" })).not.toBeInTheDocument();
  });
});

it("keeps planning usable when saving to browser storage is denied", async () => {
  vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => { throw new Error("storage denied"); });
  const user = userEvent.setup();
  render(<App />);
  expect(await screen.findByRole("alert")).toHaveTextContent("stay in memory");
  await user.type(screen.getByRole("textbox", { name: "Message" }), "Hello{Enter}");
  expect(screen.getByLabelText("assistant message")).toHaveTextContent("Hi! Tell me");
  await user.click(screen.getByRole("button", { name: "New plan" }));
  expect(screen.getByRole("textbox", { name: "Message" })).toBeEnabled();
});

it("keeps the accepted plan when a successful HTTP response is malformed", async () => {
  window.localStorage.setItem("home-huddle-state-v2", JSON.stringify({ messages: [{ id: "saved", role: "assistant", text: "Existing plan" }], plan, calendarDate: "2026-10-01" }));
  vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ reply: "Done", plan: { items: null } }))));
  const user = userEvent.setup();
  render(<App />);
  await user.type(screen.getByRole("textbox", { name: "Message" }), "Start dinner later{Enter}");
  expect(await screen.findByRole("alert")).toHaveTextContent("incomplete response");
  expect(screen.getByRole("heading", { name: plan.title })).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Retry" })).toBeEnabled();
  expect(screen.queryByRole("region", { name: "Proposed revision" })).not.toBeInTheDocument();
});
