import type { NextRequest } from "next/server";
import { AppError } from "@/lib/errors";
import { clientToken } from "./schemas";

// The Idempotency-Key header of an order-creating request (Schema §5.1 step 2).
export function idempotencyKeyFrom(request: NextRequest): string {
  const key = request.headers.get("idempotency-key");
  if (!key || !clientToken.safeParse(key).success) {
    throw new AppError("VALIDATION_FAILED", {
      details: { fields: ["idempotency-key"] },
    });
  }
  return key;
}
