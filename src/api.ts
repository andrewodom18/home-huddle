import { z } from "zod";
import { chatRequestSchema, chatResponseSchema, type ChatErrorResponse, type ChatRequest, type ChatResponse } from "../shared/contracts";
import { requestJson } from "./request";

export class ChatApiError extends Error {
  readonly code: ChatErrorResponse["error"]["code"];
  readonly retryable: boolean;

  constructor(error: ChatErrorResponse["error"]) {
    super(error.message);
    this.name = "ChatApiError";
    this.code = error.code;
    this.retryable = error.retryable;
  }
}

const errorSchema = z.object({ error: z.object({
  code: z.enum(["VALIDATION", "RATE_LIMIT", "BEDROCK_AUTH", "BEDROCK_TIMEOUT", "BEDROCK_UNAVAILABLE", "INVALID_TOOL_OUTPUT", "TOOL_LOOP"]),
  message: z.string().min(1).max(2000), retryable: z.boolean(),
}) });

export async function sendChat(request: ChatRequest, options: { signal?: AbortSignal; timeoutMs?: number } = {}): Promise<ChatResponse> {
  if (!chatRequestSchema.safeParse(request).success) {
    throw new ChatApiError({ code: "VALIDATION", message: "Check your message, plan date, and time zone before trying again.", retryable: false });
  }
  try {
    const { response, data } = await requestJson(request, options);
    if (!response.ok) {
      const error = errorSchema.safeParse(data);
      if (error.success) throw new ChatApiError(error.data.error);
      throw new ChatApiError({ code: "BEDROCK_UNAVAILABLE", message: "Home Huddle could not reach its planning service.", retryable: true });
    }
    const parsed = chatResponseSchema.safeParse(data);
    if (!parsed.success) throw new ChatApiError({ code: "INVALID_TOOL_OUTPUT", message: "The planning service returned an incomplete response. Your current plan is unchanged. Please retry.", retryable: true });
    return parsed.data;
  } catch (error) {
    if (error && typeof error === "object" && "name" in error && error.name === "TimeoutError") {
      throw new ChatApiError({ code: "BEDROCK_TIMEOUT", message: "The planning service took too long to respond. Please retry.", retryable: true });
    }
    throw error;
  }
}
