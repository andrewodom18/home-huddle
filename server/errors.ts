import type { ChatErrorCode } from "../shared/contracts";

export class AppError extends Error {
  readonly code: ChatErrorCode;
  readonly retryable: boolean;
  readonly status: number;

  constructor(
    code: ChatErrorCode,
    message: string,
    options: { retryable?: boolean; status?: number; cause?: unknown } = {},
  ) {
    super(message, { cause: options.cause });
    this.name = "AppError";
    this.code = code;
    this.retryable = options.retryable ?? false;
    this.status = options.status ?? 500;
  }
}

