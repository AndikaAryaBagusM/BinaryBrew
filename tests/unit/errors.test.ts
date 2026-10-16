import { describe, expect, it } from "vitest";
import { AppError, httpStatusFor, isAppError } from "@/lib/errors";

describe("AppError", () => {
  it("carries a stable code and optional details", () => {
    const error = new AppError("ITEM_SOLD_OUT", {
      details: { items: ["Croissant"] },
    });
    expect(error).toBeInstanceOf(Error);
    expect(error.code).toBe("ITEM_SOLD_OUT");
    expect(error.details).toEqual({ items: ["Croissant"] });
    expect(error.name).toBe("AppError");
    expect(isAppError(error)).toBe(true);
    expect(isAppError(new Error("x"))).toBe(false);
  });

  it("keeps the cause for logs", () => {
    const cause = new Error("connection refused");
    expect(new AppError("DB_UNAVAILABLE", { cause }).cause).toBe(cause);
  });
});

describe("httpStatusFor", () => {
  it.each([
    ["VALIDATION_FAILED", 400],
    ["UNAUTHENTICATED", 401],
    ["FORBIDDEN", 403],
    ["NOT_FOUND", 404],
    ["ITEM_SOLD_OUT", 409],
    ["ORDER_EXPIRED", 409],
    ["RATE_LIMITED", 429],
    ["INTERNAL", 500],
    ["DB_UNAVAILABLE", 503],
  ] as const)("%s → %i", (code, status) => {
    expect(httpStatusFor(code)).toBe(status);
  });
});
