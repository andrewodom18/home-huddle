// @vitest-environment node
import { describe, expect, it, vi } from "vitest";
import { createBedrockGateway } from "./bedrock";

describe("createBedrockGateway", () => {
  it("advertises the interpretation provenance and clock contract that the server accepts", async () => {
    const sdkSend = vi.fn(async (command) => {
      expect(command.input.toolConfig?.tools?.[0]).toMatchObject({
        toolSpec: { name: "interpret_household_request", inputSchema: { json: { properties: {
          requirements: { properties: {
            source: { const: "interpreted" },
            timeWindow: { description: expect.stringContaining("same-day clock window") },
            timeWindows: { description: expect.stringContaining("each date at most once") },
          } },
        } } } },
      });
      return { $metadata: { requestId: "contract-test" }, output: { message: { role: "assistant" as const, content: [{ text: "Ready" }] } }, stopReason: "end_turn" as const, usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 }, metrics: { latencyMs: 1 } };
    });
    await createBedrockGateway({ authMode: "iam", sdkSend }).converse([{ role: "user", content: [{ text: "Plan two dates" }] }], { stage: "interpret" });
    expect(sdkSend).toHaveBeenCalledOnce();
  });

  it("requires a configured API key", async () => {
    const gateway = createBedrockGateway({ token: "" });

    await expect(
      gateway.converse([{ role: "user", content: [{ text: "Hello" }] }]),
    ).rejects.toMatchObject({ code: "BEDROCK_AUTH", retryable: false });
  });

  it("maps denied requests to a safe authentication error", async () => {
    const fetchImpl = vi.fn(async () =>
      new Response(JSON.stringify({ message: "sensitive upstream detail" }), {
        status: 403,
        headers: { "Content-Type": "application/json" },
      }),
    );
    const gateway = createBedrockGateway({ token: "test-token", fetchImpl });

    await expect(
      gateway.converse([{ role: "user", content: [{ text: "Hello" }] }]),
    ).rejects.toMatchObject({
      code: "BEDROCK_AUTH",
      message: expect.not.stringContaining("sensitive upstream detail"),
    });
  });

  it("maps an aborted request to a retryable timeout", async () => {
    const fetchImpl = vi.fn(
      (_input: string | URL | Request, init?: RequestInit) =>
        new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener("abort", () => {
            reject(new DOMException("Aborted", "AbortError"));
          });
        }),
    );
    const gateway = createBedrockGateway({
      token: "test-token",
      fetchImpl,
      timeoutMs: 1,
    });

    await expect(
      gateway.converse([{ role: "user", content: [{ text: "Hello" }] }]),
    ).rejects.toMatchObject({ code: "BEDROCK_TIMEOUT", retryable: true });
  });

  it("allows a slow call up to 60 seconds while respecting the request deadline", async () => {
    vi.useFakeTimers();
    try {
      vi.setSystemTime(new Date("2026-09-23T12:00:00.000Z"));
      let signal: AbortSignal | undefined;
      const fetchImpl = vi.fn(
        (_input: string | URL | Request, init?: RequestInit) =>
          new Promise<Response>((_resolve, reject) => {
            signal = init?.signal ?? undefined;
            signal?.addEventListener("abort", () => reject(new DOMException("Aborted", "AbortError")));
          }),
      );
      const gateway = createBedrockGateway({ token: "test-token", fetchImpl });
      const pending = gateway.converse(
        [{ role: "user", content: [{ text: "Plan 20 tasks" }] }],
        { requestDeadlineMs: Date.now() + 95_000 },
      );
      const assertion = expect(pending).rejects.toMatchObject({ code: "BEDROCK_TIMEOUT", retryable: true });

      await vi.advanceTimersByTimeAsync(30_000);
      expect(signal?.aborted).toBe(false);
      await vi.advanceTimersByTimeAsync(30_000);
      await assertion;
      expect(signal?.aborted).toBe(true);
    } finally {
      vi.useRealTimers();
    }
  });

  it("clamps a later call to the time left in the request", async () => {
    vi.useFakeTimers();
    try {
      vi.setSystemTime(new Date("2026-09-23T12:00:00.000Z"));
      const fetchImpl = vi.fn(
        (_input: string | URL | Request, init?: RequestInit) =>
          new Promise<Response>((_resolve, reject) => {
            init?.signal?.addEventListener("abort", () => reject(new DOMException("Aborted", "AbortError")));
          }),
      );
      const gateway = createBedrockGateway({ token: "test-token", fetchImpl });
      const pending = gateway.converse(
        [{ role: "user", content: [{ text: "Finish planning" }] }],
        { requestDeadlineMs: Date.now() + 5_000 },
      );
      const assertion = expect(pending).rejects.toMatchObject({ code: "BEDROCK_TIMEOUT", retryable: true });

      await vi.advanceTimersByTimeAsync(4_999);
      expect(fetchImpl.mock.calls[0][1]?.signal?.aborted).toBe(false);
      await vi.advanceTimersByTimeAsync(1);
      await assertion;
      expect(fetchImpl.mock.calls[0][1]?.signal?.aborted).toBe(true);
    } finally {
      vi.useRealTimers();
    }
  });

  it("skips reservation and provider invocation after the request deadline", async () => {
    const beforeConverse = vi.fn(async () => {});
    const fetchImpl = vi.fn(async () => new Response("{}"));
    const gateway = createBedrockGateway({ token: "test-token", fetchImpl, beforeConverse });

    await expect(gateway.converse(
      [{ role: "user", content: [{ text: "Plan" }] }],
      { requestDeadlineMs: Date.now() - 1 },
    )).rejects.toMatchObject({ code: "BEDROCK_TIMEOUT", retryable: true });
    expect(beforeConverse).not.toHaveBeenCalled();
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("returns a valid Converse response and request ID", async () => {
    const beforeConverse = vi.fn(async () => {});
    const fetchImpl = vi.fn(async () =>
      new Response(
        JSON.stringify({
          output: {
            message: { role: "assistant", content: [{ text: "Hello" }] },
          },
          stopReason: "end_turn",
        }),
        {
          status: 200,
          headers: {
            "Content-Type": "application/json",
            "x-amzn-requestid": "bedrock-request-id",
          },
        },
      ),
    );
    const gateway = createBedrockGateway({ token: "test-token", fetchImpl, beforeConverse });

    const result = await gateway.converse([
      { role: "user", content: [{ text: "Hello" }] },
    ]);

    expect(result.requestId).toBe("bedrock-request-id");
    expect(result.output.message.content).toEqual([{ text: "Hello" }]);
    await gateway.converse([{ role: "user", content: [{ text: "Again" }] }]);
    expect(beforeConverse).toHaveBeenCalledTimes(2);
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it("sends valid tool messages through the IAM SDK path", async () => {
    const sdkSend = vi.fn(async (command) => {
      expect(command.input.modelId).toBe("us.amazon.nova-2-lite-v1:0");
      expect(command.input.toolConfig?.tools?.[0]).toMatchObject({
        toolSpec: {
          name: "publish_household_plan",
          inputSchema: { json: { required: expect.arrayContaining(["requirements", "items"]) } },
        },
      });
      expect(command.input.messages?.[2]?.content?.[0]).toEqual({
        toolResult: {
          toolUseId: "tool-1",
          status: "success",
          content: [{ json: { accepted: true } }],
        },
      });
      return {
        $metadata: { requestId: "iam-request-id" },
        output: {
          message: { role: "assistant" as const, content: [{ text: "Ready" }] },
        },
        stopReason: "end_turn" as const,
        usage: { inputTokens: 10, outputTokens: 2, totalTokens: 12 },
        metrics: { latencyMs: 30 },
      };
    });
    const gateway = createBedrockGateway({ authMode: "iam", sdkSend });

    const result = await gateway.converse([
      { role: "user", content: [{ text: "Plan tonight" }] },
      {
        role: "assistant",
        content: [{ toolUse: { toolUseId: "tool-1", name: "publish_household_plan", input: { title: "Evening" } } }],
      },
      {
        role: "user",
        content: [{ toolResult: { toolUseId: "tool-1", status: "success", content: [{ json: { accepted: true } }] } }],
      },
    ]);

    expect(result.requestId).toBe("iam-request-id");
    expect(result.output.message.content).toEqual([{ text: "Ready" }]);
    expect(sdkSend).toHaveBeenCalledOnce();
  });

  it("tells Bedrock that explicit non-fixed preset details may be customized safely", async () => {
    const sdkSend = vi.fn(async (command) => {
      const instructions = command.input.system?.map((block: { text?: string }) => block.text ?? "").join(" ") ?? "";
      expect(instructions).toContain("explicit edits may change a non-fixed task's date, duration, or assignees");
      expect(instructions).toContain("Never change a fixedDate or fixedStartTime commitment");
      expect(instructions).toContain("must still obey its canonical allowed and forbidden participants");
      return {
        $metadata: { requestId: "prompt-test" },
        output: { message: { role: "assistant" as const, content: [{ text: "What date?" }] } },
        stopReason: "end_turn" as const,
        usage: { inputTokens: 10, outputTokens: 2, totalTokens: 12 },
        metrics: { latencyMs: 30 },
      };
    });
    const gateway = createBedrockGateway({ authMode: "iam", sdkSend });
    await gateway.converse([{ role: "user", content: [{ text: "Move a flexible event" }] }]);
    expect(sdkSend).toHaveBeenCalledOnce();
  });
});
