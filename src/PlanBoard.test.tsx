import { fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { HouseholdPlan } from "../shared/contracts";
import { SCENARIO_REQUIREMENTS } from "../shared/scenarios";
import { PlanBoard } from "./PlanBoard";

const plan: HouseholdPlan = {
  title: "Saturday chores",
  objective: "Share the work",
  participants: ["Alex", "Sam"],
  items: [
    { id: "kitchen", startTime: "9:00 AM", durationMinutes: 35, task: "Clean the kitchen", assignee: "Alex" },
    { id: "vacuum", startTime: "9:00 AM", durationMinutes: 30, task: "Vacuum", assignee: "Sam", details: "Use the quiet setting." },
  ],
  notes: [],
  version: 1,
  updatedAt: "2026-09-17T12:00:00.000Z",
};

beforeEach(() => {
  // Keep the dated schedule fixtures in the future unless a test overrides now.
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-09-18T12:00:00Z"));
});

afterEach(() => vi.useRealTimers());

beforeAll(() => {
  // jsdom does not implement the native modal methods yet.
  HTMLDialogElement.prototype.showModal = function () { this.setAttribute("open", ""); };
  HTMLDialogElement.prototype.close = function () { this.removeAttribute("open"); };
});

describe("calendar activity details", () => {
  it("keeps the editor open and explains a past date or same-day start", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-09-18T15:00:00Z"));
    try {
      const editablePlan: HouseholdPlan = {
        ...plan,
        items: [{ ...plan.items[0], taskId: "kitchen", date: "2026-09-19" }],
        requirements: { source: "interpreted", timeWindow: { startTime: "8:00 AM", endTime: "11:00 AM" }, tasks: [{ id: "kitchen", label: "Clean the kitchen", durationMinutes: 35 }] },
      };
      const onScheduleChange = vi.fn();
      render(<PlanBoard date="2026-09-19" onScheduleChange={onScheduleChange} plan={editablePlan} timeZone="America/Chicago" />);
      fireEvent.click(screen.getAllByRole("button", { name: /Open details for Clean the kitchen/ })[0]);
      fireEvent.change(screen.getByLabelText("Activity date"), { target: { value: "2026-09-18" } });
      fireEvent.click(screen.getByRole("button", { name: "Review schedule change" }));
      expect(screen.getByRole("dialog")).toBeInTheDocument();
      expect(screen.getByRole("alert")).toHaveTextContent("in the past in America/Chicago");
      expect(onScheduleChange).not.toHaveBeenCalled();
      fireEvent.change(screen.getByLabelText("Activity start time"), { target: { value: "10:30" } });
      fireEvent.click(screen.getByRole("button", { name: "Review schedule change" }));
      expect(onScheduleChange).toHaveBeenCalledWith({ taskId: "kitchen", date: "2026-09-18", startTime: "10:30 AM" });
    } finally {
      vi.useRealTimers();
    }
  });

  it("shows the schedule editor directly and sends only changed fields for review", async () => {
    const editablePlan: HouseholdPlan = {
      ...plan,
      items: [
        { ...plan.items[0], taskId: "kitchen" },
        { ...plan.items[1], taskId: "vacuum" },
      ],
      requirements: {
        source: "interpreted",
        timeWindow: { startTime: "9:00 AM", endTime: "11:00 AM" },
        tasks: [
          { id: "kitchen", label: "Clean the kitchen", durationMinutes: 35 },
          { id: "vacuum", label: "Vacuum", durationMinutes: 30 },
        ],
      },
    };
    const user = userEvent.setup();
    const onScheduleChange = vi.fn();
    render(<PlanBoard date="2026-09-19" onScheduleChange={onScheduleChange} plan={editablePlan} />);

    await user.click(screen.getAllByRole("button", { name: /Open details for Clean the kitchen/ })[0]);
    expect(screen.getByLabelText("Activity date")).toHaveValue("2026-09-19");
    fireEvent.change(screen.getByLabelText("Activity start time"), { target: { value: "09:15" } });
    expect(screen.getByLabelText("Activity end time")).toHaveValue("09:50");
    await user.click(screen.getByRole("checkbox", { name: "Alex" }));
    await user.click(screen.getByRole("checkbox", { name: "Sam" }));
    await user.click(screen.getByRole("button", { name: "Review schedule change" }));

    expect(onScheduleChange).toHaveBeenCalledWith({ taskId: "kitchen", startTime: "9:15 AM", assignees: ["Sam"] });
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("keeps the original start fixed when someone edits only an event's end", async () => {
    const editablePlan: HouseholdPlan = {
      ...plan,
      items: [{ ...plan.items[0], taskId: "kitchen" }],
      requirements: {
        source: "interpreted",
        timeWindow: { startTime: "9:00 AM", endTime: "11:00 AM" },
        tasks: [{ id: "kitchen", label: "Clean the kitchen", durationMinutes: 35 }],
      },
    };
    const onScheduleChange = vi.fn();
    const user = userEvent.setup();
    render(<PlanBoard date="2026-09-19" onScheduleChange={onScheduleChange} plan={editablePlan} />);

    await user.click(screen.getAllByRole("button", { name: /Open details for Clean the kitchen/ })[0]);
    fireEvent.change(screen.getByLabelText("Activity end time"), { target: { value: "09:45" } });
    expect(screen.getByLabelText("Activity duration in minutes")).toHaveValue(45);
    await user.click(screen.getByRole("button", { name: "Review schedule change" }));
    expect(onScheduleChange).toHaveBeenCalledWith({ taskId: "kitchen", startTime: "9:00 AM", durationMinutes: 45 });
  });

  it("saves an edited note when reviewing a schedule change", async () => {
    const editablePlan: HouseholdPlan = {
      ...plan,
      items: [{ ...plan.items[0], taskId: "kitchen" }],
      requirements: {
        source: "interpreted",
        timeWindow: { startTime: "9:00 AM", endTime: "11:00 AM" },
        tasks: [{ id: "kitchen", label: "Clean the kitchen", durationMinutes: 35 }],
      },
    };
    const onDetailsChange = vi.fn();
    const onScheduleChange = vi.fn();
    const user = userEvent.setup();
    render(<PlanBoard date="2026-09-19" onDetailsChange={onDetailsChange} onScheduleChange={onScheduleChange} plan={editablePlan} />);

    await user.click(screen.getAllByRole("button", { name: /Open details for Clean the kitchen/ })[0]);
    await user.type(screen.getByRole("textbox", { name: "Additional details" }), "Use the blue sponge.");
    fireEvent.change(screen.getByLabelText("Activity start time"), { target: { value: "09:15" } });
    await user.click(screen.getByRole("button", { name: "Review schedule change" }));

    expect(onDetailsChange).toHaveBeenCalledWith("kitchen", "Use the blue sponge.");
    expect(onScheduleChange).toHaveBeenCalledWith({ taskId: "kitchen", startTime: "9:15 AM" });
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("explains fixed commitments instead of presenting unusable edit fields", async () => {
    const canonical = SCENARIO_REQUIREMENTS.weekday;
    const examplePlan: HouseholdPlan = {
      ...plan,
      scenarioId: "weekday",
      participants: ["Maya", "Leo", "Jordan", "Casey"],
      items: [{ id: "task-jordan-call", taskId: "jordan-call", date: "2026-09-21", startTime: "6:30 PM", durationMinutes: 20, task: "Jordan's fixed call", assignee: "Jordan" }],
      requirements: canonical,
    };
    const user = userEvent.setup();
    render(<PlanBoard date="2026-09-21" onScheduleChange={vi.fn()} plan={examplePlan} />);

    await user.click(screen.getAllByRole("button", { name: /Open details for Jordan's fixed call/ })[0]);
    expect(screen.queryByLabelText("Activity date")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Review schedule change" })).not.toBeInTheDocument();
    expect(screen.getByText(/fixed commitment in the example/)).toBeInTheDocument();
  });

  it("lets a flexible example propose an end, duration, and eligible assignee change", async () => {
    const examplePlan: HouseholdPlan = {
      ...plan,
      scenarioId: "chores",
      participants: ["Alex", "Sam", "Riley"],
      items: [{ ...plan.items[0], taskId: "kitchen", date: "2026-09-19" }],
      requirements: SCENARIO_REQUIREMENTS.chores,
    };
    const onScheduleChange = vi.fn();
    const user = userEvent.setup();
    render(<PlanBoard date="2026-09-19" onScheduleChange={onScheduleChange} plan={examplePlan} />);
    await user.click(screen.getAllByRole("button", { name: /Open details for Clean the kitchen/ })[0]);
    expect(screen.getByLabelText("Activity end time")).toBeEnabled();
    expect(screen.getByLabelText("Activity duration in minutes")).toBeEnabled();
    expect(screen.getByRole("checkbox", { name: "Riley" })).toBeDisabled();
    fireEvent.change(screen.getByLabelText("Activity end time"), { target: { value: "09:30" } });
    expect(screen.getByLabelText("Activity duration in minutes")).toHaveValue(30);
    await user.click(screen.getByRole("checkbox", { name: "Alex" }));
    await user.click(screen.getByRole("checkbox", { name: "Sam" }));
    await user.click(screen.getByRole("button", { name: "Review schedule change" }));
    expect(onScheduleChange).toHaveBeenCalledWith({ taskId: "kitchen", startTime: "9:00 AM", durationMinutes: 30, assignees: ["Sam"] });
  });

  it("switches between person lanes and one shared calendar lane", async () => {
    const user = userEvent.setup();
    render(<PlanBoard date="2026-09-19" plan={plan} />);
    const switcher = within(screen.getByRole("group", { name: "Calendar view" }));
    expect(switcher.getByRole("button", { name: "By person" })).toHaveAttribute("aria-pressed", "true");
    await user.click(switcher.getByRole("button", { name: "Shared" }));
    const shared = within(screen.getByRole("group", { name: "Shared calendar day view" }));
    expect(shared.getAllByRole("button", { name: /Open details for Clean the kitchen/ })).toHaveLength(1);
    expect(shared.getAllByRole("button", { name: /Open details for Vacuum/ })).toHaveLength(1);
    expect(switcher.getByRole("button", { name: "Shared" })).toHaveAttribute("aria-pressed", "true");
    await user.click(switcher.getByRole("button", { name: "By person" }));
    expect(screen.getByRole("group", { name: "Calendar day view" })).toBeInTheDocument();
  });

  it("keeps canonical eligible people available after accepting a narrower assignment", async () => {
    const requirements = structuredClone(SCENARIO_REQUIREMENTS.chores);
    requirements.source = "interpreted";
    requirements.tasks = requirements.tasks.map((task) => task.id === "kitchen"
      ? { ...task, requiredParticipants: ["Sam"], allowedParticipants: ["Sam"] }
      : task);
    const revised: HouseholdPlan = {
      ...plan, scenarioId: "chores", participants: ["Alex", "Sam", "Riley"],
      scenarioEdits: { kitchen: { assignees: ["Sam"] } }, requirements,
      items: [{ ...plan.items[0], taskId: "kitchen", date: "2026-09-19", assignee: "Sam" }],
    };
    const onScheduleChange = vi.fn();
    const user = userEvent.setup();
    render(<PlanBoard date="2026-09-19" onScheduleChange={onScheduleChange} plan={revised} />);
    await user.click(screen.getAllByRole("button", { name: /Open details for Clean the kitchen/ })[0]);
    expect(screen.getByRole("checkbox", { name: "Alex" })).toBeEnabled();
    expect(screen.getByRole("checkbox", { name: "Riley" })).toBeDisabled();
    await user.click(screen.getByRole("checkbox", { name: "Sam" }));
    await user.click(screen.getByRole("checkbox", { name: "Alex" }));
    await user.click(screen.getByRole("button", { name: "Review schedule change" }));
    expect(onScheduleChange).toHaveBeenCalledWith({ taskId: "kitchen", assignees: ["Alex"] });
  });

  it("opens a desktop event, saves a note, and returns focus to the event", async () => {
    const user = userEvent.setup();
    const onDetailsChange = vi.fn();
    render(<PlanBoard date="2026-09-19" onDetailsChange={onDetailsChange} plan={plan} />);

    const event = screen.getAllByRole("button", { name: /Open details for Clean the kitchen/ })[0];
    await user.click(event);

    const dialog = screen.getByRole("dialog", { name: "Clean the kitchen" });
    expect(dialog).toHaveTextContent("Saturday, September 19, 2026");
    expect(dialog).toHaveTextContent("9:00 AM–9:35 AM");
    expect(dialog).toHaveTextContent("Alex");
    expect(screen.getByRole("button", { name: "Close activity details" })).toHaveFocus();
    await user.keyboard("{Shift>}{Tab}{/Shift}");
    expect(screen.getByRole("button", { name: "Save details" })).toHaveFocus();
    await user.keyboard("{Tab}");
    expect(screen.getByRole("button", { name: "Close activity details" })).toHaveFocus();

    const details = screen.getByRole("textbox", { name: "Additional details" });
    expect(details).toHaveAttribute("maxlength", "500");
    await user.type(details, "Wipe counters first.");
    await user.click(screen.getByRole("button", { name: "Save details" }));
    expect(onDetailsChange).toHaveBeenCalledWith("kitchen", "Wipe counters first.");
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(event).toHaveFocus();
  });

  it("opens a mobile timeline item with the keyboard and closes on Escape", async () => {
    const user = userEvent.setup();
    render(<PlanBoard date="2026-09-19" onDetailsChange={vi.fn()} plan={plan} />);

    const timeline = screen.getByRole("list", { name: "Activities in time order" });
    const event = [...timeline.querySelectorAll("button")].find((button) => button.textContent?.includes("Vacuum")) as HTMLButtonElement;
    event.focus();
    await user.keyboard("{Enter}");

    expect(screen.getByRole("dialog", { name: "Vacuum" })).toHaveTextContent("Use the quiet setting.");
    await user.keyboard("{Escape}");
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(event).toHaveFocus();
  });

  it("shows an existing note without editing in a read-only snapshot", async () => {
    const user = userEvent.setup();
    render(<PlanBoard date="2026-09-19" plan={plan} readOnly />);

    const event = screen.getAllByRole("button", { name: /Open details for Vacuum/ })[0];
    await user.click(event);
    expect(screen.getByRole("dialog", { name: "Vacuum" })).toHaveTextContent("Use the quiet setting.");
    expect(screen.queryByRole("textbox", { name: "Additional details" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Save details" })).not.toBeInTheDocument();
    await user.keyboard("{Tab}");
    expect(screen.getByRole("button", { name: "Close activity details" })).toHaveFocus();
  });

  it("navigates nonconsecutive scheduled dates across months and reviews a date-only change", async () => {
    const datedPlan: HouseholdPlan = {
      ...plan,
      items: [
        { ...plan.items[0], taskId: "kitchen", date: "2026-09-21" },
        { ...plan.items[1], taskId: "vacuum", date: "2026-09-23" },
        { id: "garden", taskId: "garden", task: "Garden", assignee: "Alex", date: "2026-10-12", startTime: "10:00 AM", durationMinutes: 30 },
      ],
      requirements: {
        source: "interpreted",
        timeWindow: { startTime: "9:00 AM", endTime: "12:00 PM" },
        tasks: [
          { id: "kitchen", label: "Clean the kitchen", durationMinutes: 35 },
          { id: "vacuum", label: "Vacuum", durationMinutes: 30 },
          { id: "garden", label: "Garden", durationMinutes: 30 },
        ],
      },
    };
    const onScheduleChange = vi.fn();
    const user = userEvent.setup();
    render(<PlanBoard date="2026-09-19" onDateChange={vi.fn()} onScheduleChange={onScheduleChange} plan={datedPlan} />);

    expect(screen.queryByLabelText("Plan date")).not.toBeInTheDocument();
    const days = within(screen.getByRole("navigation", { name: "Schedule days" }));
    expect(days.getAllByRole("button")).toHaveLength(5);
    expect(screen.getByRole("heading", { name: "Monday, September 21, 2026" })).toBeInTheDocument();
    expect(screen.getAllByRole("button", { name: /Open details for Clean the kitchen/ })).toHaveLength(2);
    expect(screen.queryByRole("button", { name: /Open details for Vacuum/ })).not.toBeInTheDocument();

    await user.click(days.getByRole("button", { name: /Wed, Sep 23/ }));
    expect(screen.getByRole("heading", { name: "Wednesday, September 23, 2026" })).toBeInTheDocument();
    expect(screen.getAllByRole("button", { name: /Open details for Vacuum/ })).toHaveLength(2);

    await user.click(days.getByRole("button", { name: /Mon, Oct 12/ }));
    expect(screen.getByRole("heading", { name: "Monday, October 12, 2026" })).toBeInTheDocument();
    await user.click(screen.getAllByRole("button", { name: /Open details for Garden/ })[0]);
    expect(screen.getByLabelText("Activity date")).toHaveValue("2026-10-12");
    fireEvent.change(screen.getByLabelText("Activity date"), { target: { value: "2026-10-15" } });
    await user.click(screen.getByRole("button", { name: "Review schedule change" }));
    expect(onScheduleChange).toHaveBeenCalledWith({ taskId: "garden", date: "2026-10-15" });
  });

  it("uses the plan date for legacy undated events without mixing them into other days", async () => {
    const user = userEvent.setup();
    render(<PlanBoard date="2026-09-19" plan={{ ...plan, items: [plan.items[0], { ...plan.items[1], date: "2026-10-12" }] }} />);
    expect(screen.getAllByRole("button", { name: /Open details for Clean the kitchen/ })).toHaveLength(2);
    expect(screen.queryByRole("button", { name: /Open details for Vacuum/ })).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: /Mon, Oct 12/ }));
    expect(screen.getAllByRole("button", { name: /Open details for Vacuum/ })).toHaveLength(2);
    expect(screen.queryByRole("button", { name: /Open details for Clean the kitchen/ })).not.toBeInTheDocument();
  });

  it("shows the event date for a single explicitly dated day even when the legacy fallback differs", () => {
    render(<PlanBoard date="2026-09-19" onDateChange={vi.fn()} plan={{ ...plan, items: plan.items.map((item) => ({ ...item, date: "2026-10-12" })) }} />);
    expect(screen.getByText("Monday, October 12, 2026")).toBeInTheDocument();
    expect(screen.getByLabelText("Plan date")).toHaveValue("2026-10-12");
  });
});

it("shows the full captured checklist, assumptions and plan notes in readable terms", async () => {
  const detailed: HouseholdPlan = {
    ...plan, notes: ["Bring reusable bags."],
    requirements: { source: "interpreted", timeWindow: { startTime: "9:00 AM", endTime: "11:00 AM" },
      timeWindows: [{ date: "2026-10-01", startTime: "10:00 AM", endTime: "11:00 AM" }],
      tasks: [{ id: "kitchen", label: "Clean the kitchen", durationMinutes: 35, atLeastOneOf: ["Alex", "Sam"], date: "2026-10-01", fixedDate: true, resources: [{ resourceId: "sink", units: 1 }] }, { id: "vacuum", label: "Vacuum", durationMinutes: 30 }],
      assumptions: ["The sink is available."], resources: [{ id: "sink", label: "Kitchen sink", capacity: 1 }],
      availability: [{ participant: "Alex", date: "2026-10-01", startTime: "10:00 AM", endTime: "11:00 AM" }],
      ordering: [{ beforeTaskId: "kitchen", afterTaskId: "vacuum" }], gaps: [{ afterTaskId: "kitchen", beforeTaskId: "vacuum", minMinutes: 10 }],
      workload: { participants: ["Alex", "Sam"], minMinutes: 20, maxMinutes: 40, excludeTaskIds: ["vacuum"] }, preferences: [{ kind: "balanced_workload", description: "Share the work" }],
    },
  };
  const user = userEvent.setup();
  render(<PlanBoard plan={detailed} date="2026-10-01" />);
  await user.click(screen.getByText("Interpreted checklist — review it"));
  expect(screen.getByText("Bring reusable bags.")).toBeInTheDocument();
  expect(screen.getByText("The sink is available.")).toBeInTheDocument();
  expect(screen.getByText(/fixed date 2026-10-01.*at least one of Alex or Sam.*Kitchen sink/)).toBeInTheDocument();
  expect(screen.getByText("Clean the kitchen before Vacuum")).toBeInTheDocument();
  expect(screen.getByText(/Each of Alex, Sam: 20–40 min, excluding Vacuum/)).toBeInTheDocument();
  expect(screen.getByText("2026-10-01: 10:00 AM–11:00 AM")).toBeInTheDocument();
  expect(screen.getByText("Alex on 2026-10-01: 10:00 AM–11:00 AM")).toBeInTheDocument();
});

it("allows an explicit custom fixed commitment edit through review", async () => {
  const custom: HouseholdPlan = { ...plan, items: [{ ...plan.items[0], taskId: "kitchen", date: "2026-10-01" }], requirements: { source: "interpreted", timeWindow: { startTime: "9:00 AM", endTime: "11:00 AM" }, tasks: [{ id: "kitchen", label: "Clean the kitchen", durationMinutes: 35, fixedDate: true, date: "2026-10-01", fixedStartTime: "9:00 AM" }] } };
  const onScheduleChange = vi.fn();
  const user = userEvent.setup();
  render(<PlanBoard plan={custom} date="2026-10-01" onScheduleChange={onScheduleChange} />);
  await user.click(screen.getAllByRole("button", { name: /Open details for Clean the kitchen/ })[0]);
  fireEvent.change(screen.getByLabelText("Activity start time"), { target: { value: "09:15" } });
  await user.click(screen.getByRole("button", { name: "Review schedule change" }));
  expect(onScheduleChange).toHaveBeenCalledWith({ taskId: "kitchen", startTime: "9:15 AM" });
});
