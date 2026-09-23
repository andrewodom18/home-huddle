import { afterEach, describe, expect, it, vi } from "vitest";
import { sendChat } from "./api";
import { createShare, resolveShare } from "./shareApi";
import type { HouseholdPlan } from "../shared/contracts";

const plan: HouseholdPlan = { title: "Chores", objective: "Clean", participants: ["Alex"], items: [{ id: "one", task: "Tidy", assignee: "Alex", startTime: "9:00 AM", durationMinutes: 10 }], notes: [], version: 1, updatedAt: "2026-09-18T12:00:00Z" };
const response = (data: unknown, status = 200) => new Response(JSON.stringify(data), { status });
afterEach(() => vi.useRealTimers());

describe("validated browser requests", () => {
  it.each([null, { reply: "Fine" }, { reply: "Fine", plan: { items: null }, meta: {} }])("rejects malformed successful chat payloads", async (body) => {
    vi.stubGlobal("fetch", vi.fn(async () => response(body)));
    await expect(sendChat({ message: "Plan tomorrow", history: [] })).rejects.toMatchObject({ code: "INVALID_TOOL_OUTPUT", retryable: true });
  });
  it("recovers a non-JSON server error", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("not JSON", { status: 502 })));
    await expect(sendChat({ message: "Plan tomorrow", history: [] })).rejects.toMatchObject({ code: "BEDROCK_UNAVAILABLE", retryable: true });
  });
  it("bounds stalled requests even if transport ignores abort", async () => {
    vi.useFakeTimers();
    vi.stubGlobal("fetch", vi.fn(() => new Promise(() => undefined)));
    const pending = sendChat({ message: "Plan tomorrow", history: [] }, { timeoutMs: 50 });
    const assertion = expect(pending).rejects.toMatchObject({ code: "BEDROCK_TIMEOUT", retryable: true });
    await vi.advanceTimersByTimeAsync(51);
    await assertion;
  });
  it("aborts the network request when the conversation is abandoned", async () => {
    const fetchMock = vi.fn((_url: unknown, options: RequestInit) => { void options; return new Promise<Response>(() => undefined); });
    vi.stubGlobal("fetch", fetchMock);
    const controller = new AbortController();
    const pending = sendChat({ message: "Plan tomorrow", history: [] }, { signal: controller.signal });
    controller.abort();
    await expect(pending).rejects.toMatchObject({ name: "AbortError" });
    expect(fetchMock.mock.calls[0][1].signal?.aborted).toBe(true);
  });
  it("rejects malformed sharing tokens and snapshots", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => response({ token: "unsafe", expiresAt: "tomorrow" })));
    await expect(createShare(plan, "2026-10-01", "America/Chicago")).rejects.toThrow("incomplete response");
    await expect(resolveShare("a".repeat(32))).rejects.toThrow("incomplete response");
  });
  it("bounds share loading and leaves a retryable explanation", async () => {
    vi.useFakeTimers();
    vi.stubGlobal("fetch", vi.fn(() => new Promise(() => undefined)));
    const pending = resolveShare("a".repeat(32));
    const assertion = expect(pending).rejects.toThrow("Sharing took too long");
    await vi.advanceTimersByTimeAsync(15_001);
    await assertion;
  });
});
