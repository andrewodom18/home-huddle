import { describe, expect, it, vi } from "vitest";
import { loadState, STORAGE_KEY } from "./storedState";

const validMessage = { id: "one", role: "user", text: "My plan" };
describe("saved conversation recovery", () => {
  it("recovers malformed nested state without rendering unchecked objects", () => {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify({ messages: [validMessage, { role: "assistant", text: {} }], plan: { items: null }, timeZone: "wrong/zone", failure: { message: "retry", request: {} }, meta: { latencyMs: "invalid" } }));
    const result = loadState();
    expect(result.messages).toEqual([validMessage]);
    expect(result.plan).toBeUndefined();
    expect(result.timeZone).toBeUndefined();
    expect(result.failure).toBeNull();
    expect(result.warning).toContain("invalid");
  });
  it("explains unavailable storage and keeps a usable new conversation", () => {
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => { throw new Error("denied"); });
    const result = loadState();
    expect(result.messages[0].id).toBe("welcome");
    expect(result.warning).toContain("memory");
  });
  it("explains corrupt saved JSON", () => {
    window.localStorage.setItem(STORAGE_KEY, "{broken");
    expect(loadState().warning).toContain("could not be read");
  });
});
