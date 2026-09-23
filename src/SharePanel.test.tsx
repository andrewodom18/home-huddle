import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { SharePanel } from "./SharePanel";
import { SharedApp } from "./SharedApp";
import type { HouseholdPlan } from "../shared/contracts";

const plan: HouseholdPlan = { title: "Chores", objective: "Clean", participants: ["Alex"], items: [{ id: "one", task: "Tidy", assignee: "Alex", startTime: "9:00 AM", durationMinutes: 10, date: "2026-10-01" }], notes: [], version: 1, updatedAt: "2026-09-18T12:00:00Z" };

describe("share recovery", () => {
  it("keeps an invalid time zone draft out of planning state", async () => {
    const onTimeZoneChange = vi.fn();
    const user = userEvent.setup();
    render(<SharePanel plan={plan} date="2026-10-01" timeZone="America/Chicago" onDateChange={vi.fn()} onTimeZoneChange={onTimeZoneChange} />);
    await user.click(screen.getByText("Share or export this plan"));
    const zone = screen.getByLabelText("Time zone");
    fireEvent.change(zone, { target: { value: "wrong/zone" } });
    fireEvent.blur(zone);
    expect(onTimeZoneChange).not.toHaveBeenCalled();
    expect(screen.getByRole("alert")).toHaveTextContent("last valid time zone");
    expect(screen.getByRole("button", { name: "Copy view link" })).toBeDisabled();
    fireEvent.change(zone, { target: { value: "America/New_York" } });
    fireEvent.blur(zone);
    expect(onTimeZoneChange).toHaveBeenCalledWith("America/New_York");
  });
  it("recovers a malformed shared snapshot on an explicit retry", async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(new Response(JSON.stringify({ plan: null }))).mockResolvedValueOnce(new Response(JSON.stringify({ plan, date: "2026-10-01", timeZone: "America/Chicago", expiresAt: "2026-10-05T12:00:00Z" })));
    vi.stubGlobal("fetch", fetchMock);
    const user = userEvent.setup();
    render(<SharedApp token={"a".repeat(32)} />);
    expect(await screen.findByRole("alert")).toHaveTextContent("incomplete response");
    await user.click(screen.getByRole("button", { name: "Retry loading" }));
    expect(await screen.findByRole("heading", { name: "Chores" })).toBeInTheDocument();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });
  it("provides a copyable link when clipboard permission is denied", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ token: "a".repeat(32), expiresAt: "2026-10-05T12:00:00Z" }))));
    const user = userEvent.setup();
    vi.spyOn(navigator.clipboard, "writeText").mockRejectedValue(new Error("denied"));
    render(<SharePanel plan={plan} date="2026-10-01" timeZone="America/Chicago" onDateChange={vi.fn()} onTimeZoneChange={vi.fn()} />);
    await user.click(screen.getByText("Share or export this plan"));
    await user.click(screen.getByRole("checkbox"));
    await user.click(screen.getByRole("button", { name: "Copy view link" }));
    await waitFor(() => expect(screen.getByRole("status")).toHaveTextContent("Copy it from the field below"));
    expect((screen.getByRole("textbox", { name: "View link" }) as HTMLInputElement).value).toContain("#share=");
  });
});
