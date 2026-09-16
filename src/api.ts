import type {
  ChatErrorResponse,
  ChatRequest,
  ChatResponse,
} from "../shared/contracts";

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

export async function sendChat(request: ChatRequest): Promise<ChatResponse> {
  const response = await fetch(import.meta.env.VITE_API_URL || "/api/chat", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(request),
  });

  const body = (await response.json()) as ChatResponse | ChatErrorResponse;
  if (!response.ok) {
    if ("error" in body) throw new ChatApiError(body.error);
    throw new ChatApiError({
      code: "BEDROCK_UNAVAILABLE",
      message: "Home Huddle could not reach its planning service.",
      retryable: true,
    });
  }

  return body as ChatResponse;
}
