import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { chatRequestSchema, type ChatResponse, type HouseholdPlan } from "../shared/contracts";
import App from "./App";
import { PRESET_SCENARIOS } from "./presets";

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
    expect(screen.getAllByRole("button", { name: /Dinner \+ homework|Share the chores|Accessible outing/ })).toHaveLength(3);
  });

  it.each(PRESET_SCENARIOS)("shows and sends the complete $title scenario", async (scenario) => {
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
      screen.getByRole("button", { name: /Dinner \+ homework/i }),
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
    expect(request.message).toContain("Jordan has a fixed call from 6:30 PM to 6:50 PM");
    expect(request.history).toEqual([]);
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
      screen.getByRole("button", { name: /Dinner \+ homework/i }),
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
    window.localStorage.setItem(
      "home-huddle-state-v1",
      JSON.stringify({
        messages: [
          { id: "welcome", role: "assistant", text: "Welcome" },
          { id: "plan", role: "assistant", text: "The plan is ready." },
        ],
        plan,
        meta: success.meta,
      }),
    );
    const revisedPlan: HouseholdPlan = {
      ...plan,
      title: "A later evening",
      items: [
        {
          ...plan.items[0],
          id: "plan-2-1",
          startTime: "5:45 PM",
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
    await user.click(screen.getByRole("button", { name: "Undo accepted revision" }));
    expect(screen.getByText("Plan v3")).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "A calmer evening" })).toBeInTheDocument();
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

    await user.click(screen.getByRole("button", { name: /Dinner \+ homework/i }));

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

    await user.click(screen.getByRole("button", { name: /Dinner \+ homework/i }));
    expect(screen.getByText("Planning your schedule…")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "New plan" }));
    await act(async () => resolveRequest(jsonResponse(success)));

    expect(screen.getByRole("heading", { name: "Hello, how can we plan together?" })).toBeInTheDocument();
    expect(screen.queryByText(success.reply)).not.toBeInTheDocument();
    expect(screen.queryByRole("region", { name: "Household calendar" })).not.toBeInTheDocument();
  });
});
