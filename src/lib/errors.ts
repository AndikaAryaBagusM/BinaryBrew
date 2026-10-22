// Typed application errors with stable codes (Tech §5). Route handlers map the
// code to an HTTP status here and to an Indonesian message from i18n/id.json,
// and respond with { error: { code, message } }. Add codes as tasks need them.

const statusByCode = {
  VALIDATION_FAILED: 400,
  UNAUTHENTICATED: 401,
  INVALID_CREDENTIALS: 401,
  FORBIDDEN: 403,
  DEVICE_NOT_REGISTERED: 403,
  ELEVATION_REQUIRED: 403,
  NOT_FOUND: 404,
  ITEM_SOLD_OUT: 409,
  ORDER_EXPIRED: 409,
  ACCOUNT_LOCKED: 423,
  RATE_LIMITED: 429,
  INTERNAL: 500,
  DB_UNAVAILABLE: 503,
} as const satisfies Record<string, number>;

export type ErrorCode = keyof typeof statusByCode;

export class AppError extends Error {
  readonly code: ErrorCode;
  readonly details?: Record<string, unknown>;

  constructor(
    code: ErrorCode,
    options: { details?: Record<string, unknown>; cause?: unknown } = {},
  ) {
    // The message is the code: user-facing text lives in i18n, not here.
    super(code, { cause: options.cause });
    this.name = "AppError";
    this.code = code;
    this.details = options.details;
  }
}

export function isAppError(error: unknown): error is AppError {
  return error instanceof AppError;
}

export function httpStatusFor(code: ErrorCode): number {
  return statusByCode[code];
}
