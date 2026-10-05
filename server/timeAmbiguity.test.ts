// @vitest-environment node
import { describe, expect, it, vi } from "vitest";
import { createChatService } from "./chatService";
import { ambiguousClockTimes } from "./timeAmbiguity";

describe("fixed-time ambiguity", () => {
  it("finds bare event times without treating explicit meridiems or 24-hour times as ambiguous", () => {
    expect(ambiguousClockTimes("Lesson starting at 12:00, dinner at 7:30, doctor at 4, pickup at 9. Groceries at 9 AM, walk at 17:00, lunch at noon.")).toEqual(["12:00", "7:30", "4", "9"]);
  });

  it("asks one clarification before Bedrock can invent fixed commitments", async () => {
    const converse = vi.fn();
    const chat = createChatService({ gateway: { modelId: "test", converse }, now: () => new Date("2026-10-05T17:00:00Z"), logger: vi.fn() });
    const result = await chat({ message: "Plan next week: piano on Monday at 12:00, a date Tuesday at 7:30, doctor Thursday at 4, and dog pickup Tuesday at 9.", history: [], planDate: "2026-10-05", timeZone: "America/Chicago" });
    expect(result).toMatchObject({ outcome: "clarification", meta: { callCount: 0, toolUsed: false } });
    expect(result.reply).toContain("AM/PM for each fixed time (12:00, 7:30, 4, 9)");
    expect(converse).not.toHaveBeenCalled();
  });
});
