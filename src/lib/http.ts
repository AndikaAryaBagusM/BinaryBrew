import { type NextRequest, NextResponse } from "next/server";
import type { z } from "zod";
import { t } from "@/i18n";
import { AppError, type ErrorCode, httpStatusFor, isAppError } from "./errors";
import { logger } from "./logger";

// Route handler plumbing (Tech §5): responses are { data } or
// { error: { code, message, details? } } with an Indonesian message.

export function jsonData(data: unknown, init?: ResponseInit) {
  return NextResponse.json({ data }, init);
}

function messageFor(error: AppError): string {
  const details = error.details ?? {};
  switch (error.code) {
    case "INVALID_CREDENTIALS":
      return typeof details.remainingAttempts === "number"
        ? t("counter.pinWrong", { n: details.remainingAttempts })
        : t("auth.loginFailed");
    case "ACCOUNT_LOCKED": {
      const until = Date.parse(String(details.lockedUntil));
      const minutes = Math.max(1, Math.ceil((until - Date.now()) / 60_000));
      return t("counter.locked", { minutes });
    }
    case "VALIDATION_FAILED":
      return t("error.validation");
    case "UNAUTHENTICATED":
      return t("auth.signInRequired");
    case "FORBIDDEN":
      return t("auth.forbidden");
    case "DEVICE_NOT_REGISTERED":
      return t("auth.deviceNotRegistered");
    case "ELEVATION_REQUIRED":
      return t("auth.elevationRequired");
    case "RATE_LIMITED":
      return t("auth.rateLimited");
    case "QR_INVALID":
      return t("error.qrInvalid");
    case "ORDERING_CLOSED":
      return t("error.orderingClosed");
    case "OPEN_ORDER_LIMIT":
      return t("error.openOrderLimit", { n: Number(details.limit) });
    case "ITEM_SOLD_OUT":
      return t("error.itemSoldOut");
    case "ORDER_STATUS_CHANGED":
      return t("error.orderStatusChanged");
    case "NAME_TAKEN":
      return t("error.nameTaken");
    default:
      return t("error.generic");
  }
}

export function errorResponse(error: unknown) {
  const appError = isAppError(error)
    ? error
    : new AppError("INTERNAL", { cause: error });
  if (!isAppError(error)) logger.error({ err: error }, "unhandled route error");

  const code: ErrorCode = appError.code;
  return NextResponse.json(
    {
      error: {
        code,
        message: messageFor(appError),
        ...(appError.details ? { details: appError.details } : {}),
      },
    },
    { status: httpStatusFor(code) },
  );
}

// Parses a JSON body with a strict schema; malformed JSON and schema failures
// both become VALIDATION_FAILED with the failing field paths.
export async function readJson<T>(
  request: NextRequest,
  schema: z.ZodType<T>,
): Promise<T> {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    throw new AppError("VALIDATION_FAILED");
  }
  const result = schema.safeParse(body);
  if (!result.success) {
    throw new AppError("VALIDATION_FAILED", {
      details: {
        fields: result.error.issues.map((issue) => issue.path.join(".")),
      },
    });
  }
  return result.data;
}

// Wraps a handler so thrown errors become the standard error response. A
// plain Response is allowed for streams (lib/sse.ts).
export function route<R extends Response = NextResponse>(
  handler: (request: NextRequest) => Promise<R>,
) {
  return async (request: NextRequest): Promise<R | NextResponse> => {
    try {
      return await handler(request);
    } catch (error) {
      return errorResponse(error);
    }
  };
}

// The second route handler argument; params holds the dynamic segments.
export type RouteContext<P> = { params: Promise<P> };

// route() for a path with dynamic segments. A plain Response is allowed for
// streams (lib/sse.ts).
export function routeWithParams<P>(
  handler: (
    request: NextRequest,
    context: RouteContext<P>,
  ) => Promise<Response>,
) {
  return async (request: NextRequest, context: RouteContext<P>) => {
    try {
      return await handler(request, context);
    } catch (error) {
      return errorResponse(error);
    }
  };
}
