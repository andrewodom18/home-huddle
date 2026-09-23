import { act, renderHook } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { useSpeechRecognition } from "./useSpeechRecognition";

function installRecognition() {
  class Recognition implements SpeechRecognitionLike {
    static latest: SpeechRecognitionLike;
    continuous = false;
    interimResults = false;
    lang = "";
    onend: SpeechRecognitionLike["onend"] = null;
    onerror: SpeechRecognitionLike["onerror"] = null;
    onresult: SpeechRecognitionLike["onresult"] = null;
    start = vi.fn();
    stop = vi.fn();
    abort = vi.fn();
    constructor() { Recognition.latest = this; }
  }
  window.SpeechRecognition = Recognition;
  return () => Recognition.latest;
}
const speechResult = (transcript: string) => ({ results: [{ 0: { transcript }, isFinal: true, length: 1 }] }) as unknown as SpeechRecognitionEventLike;

describe("speech input recovery", () => {
  it("accepts a final transcript within the same composer limit", () => {
    const recognition = installRecognition();
    const onTranscript = vi.fn();
    const { result } = renderHook(() => useSpeechRecognition(onTranscript));
    act(() => result.current.start());
    act(() => recognition().onresult?.(speechResult("a".repeat(1100))));
    expect(onTranscript).toHaveBeenCalledWith("a".repeat(1000));
  });
  it("ignores late results and cancellation errors after reset", () => {
    const recognition = installRecognition();
    const onTranscript = vi.fn();
    const { result } = renderHook(() => useSpeechRecognition(onTranscript));
    act(() => result.current.start());
    act(() => result.current.stop());
    act(() => {
      recognition().onresult?.(speechResult("Old conversation"));
      recognition().onerror?.({ error: "aborted" } as SpeechRecognitionErrorEventLike);
    });
    expect(onTranscript).not.toHaveBeenCalled();
    expect(result.current.error).toBeNull();
    expect(result.current.listening).toBe(false);
  });
  it("explains denied permission and detaches handlers on unmount", () => {
    const recognition = installRecognition();
    const { result, unmount } = renderHook(() => useSpeechRecognition(vi.fn()));
    act(() => result.current.start());
    act(() => recognition().onerror?.({ error: "not-allowed" } as SpeechRecognitionErrorEventLike));
    expect(result.current.error).toContain("keep typing");
    unmount();
    expect(recognition().onresult).toBeNull();
    expect(recognition().onerror).toBeNull();
  });
});
