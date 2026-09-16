import { chatRequestSchema, type ChatErrorResponse } from "../shared/contracts";
import { createChatService, type ChatService } from "./chatService";
import { createBedrockGateway } from "./bedrock";
import { AppError } from "./errors";
import { createQuotaReserver } from "./quota";

type FunctionUrlEvent = {
  requestContext?: { http?: { method?: string } };
  headers?: Record<string, string | undefined>;
  body?: string | null;
  isBase64Encoded?: boolean;
};

type LambdaOptions = {
  chatService?: ChatService;
  reserve?: () => Promise<void>;
  publicOrigin?: string;
};

function response(statusCode: number, body: unknown) {
  return {
    statusCode,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
    },
    body: JSON.stringify(body),
  };
}

export function createLambdaHandler(options: LambdaOptions = {}) {
  const reserve = options.reserve ?? createQuotaReserver();
  const chatService = options.chatService ?? createChatService({
    gateway: createBedrockGateway({ beforeConverse: reserve }),
  });
  const publicOrigin = options.publicOrigin ?? process.env.PUBLIC_ORIGIN;

  return async (event: FunctionUrlEvent) => {
    const method = event.requestContext?.http?.method;
    const headers = Object.fromEntries(
      Object.entries(event.headers ?? {}).map(([key, value]) => [key.toLowerCase(), value]),
    );
    const origin = headers.origin;

    if (method === "OPTIONS") {
      return {
        statusCode: origin === publicOrigin ? 204 : 403,
        headers: {},
        body: "",
      };
    }

    if (method !== "POST" || !publicOrigin || origin !== publicOrigin) {
      return response(403, { error: { code: "VALIDATION", message: "Use the Home Huddle page.", retryable: false } });
    }
    if (!headers["content-type"]?.toLowerCase().startsWith("application/json")) {
      return response(415, { error: { code: "VALIDATION", message: "Send JSON.", retryable: false } });
    }

    try {
      const rawBody = event.isBase64Encoded
        ? Buffer.from(event.body ?? "", "base64").toString("utf8")
        : event.body ?? "";
      if (Buffer.byteLength(rawBody) > 16_000) {
        throw new AppError("VALIDATION", "The request is too large.", { status: 413 });
      }
      const parsed = chatRequestSchema.safeParse(JSON.parse(rawBody));
      if (!parsed.success) {
        throw new AppError("VALIDATION", "Use a short message and at most 12 history items.", {
          status: 400,
        });
      }
      return response(200, await chatService(parsed.data));
    } catch (error) {
      const appError = error instanceof AppError
        ? error
        : error instanceof SyntaxError
          ? new AppError("VALIDATION", "Send valid JSON.", { status: 400 })
          : new AppError("BEDROCK_UNAVAILABLE", "Home Huddle could not complete the request.", {
              retryable: true,
              status: 503,
            });
      const body: ChatErrorResponse = {
        error: {
          code: appError.code,
          message: appError.message,
          retryable: appError.retryable,
        },
      };
      return response(appError.status, body);
    }
  };
}

export const handler = createLambdaHandler();
