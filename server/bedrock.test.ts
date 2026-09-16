// @vitest-environment node
import { describe, expect, it, vi } from "vitest";
import { createBedrockGateway } from "./bedrock";

describe("createBedrockGateway", () => {
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
        toolSpec: { name: "publish_household_plan" },
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
});
