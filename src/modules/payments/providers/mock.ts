import { createHmac, timingSafeEqual } from "node:crypto";
import { z } from "zod";
import { AppError } from "@/lib/errors";
import type { PaymentProvider, VerifiedPaymentEvent } from "../provider";

// Mock QRIS gateway (Tech §8): fake charges, and webhooks signed with
// PAYMENT_WEBHOOK_SECRET so mock payments take the real verification path.

export const MOCK_SIGNATURE_HEADER = "x-mock-signature";

const mockEvent = z.strictObject({
  eventId: z.string().min(1).max(200),
  providerRef: z.string().min(1).max(200),
  type: z.enum(["paid", "expired", "failed"]),
});
export type MockEvent = z.infer<typeof mockEvent>;

const hmac = (secret: string, data: string) =>
  createHmac("sha256", secret).update(data);

export function signMockBody(secret: string, rawBody: string): Headers {
  return new Headers({
    "content-type": "application/json",
    [MOCK_SIGNATURE_HEADER]: hmac(secret, rawBody).digest("hex"),
  });
}

export function signMockEvent(secret: string, event: MockEvent) {
  const body = JSON.stringify(event);
  return { body, headers: signMockBody(secret, body) };
}

export function createMockProvider(secret: string): PaymentProvider {
  return {
    name: "mock",

    async createQrisCharge({ amount, expiresAt, idempotencyKey }) {
      // Same key, same charge, as a real gateway's idempotency would give.
      const providerRef =
        "mock_" +
        hmac(secret, `charge:${idempotencyKey}`)
          .digest("base64url")
          .slice(0, 22);
      return {
        providerRef,
        qrString: `MOCKQRIS|${providerRef}|${amount}|${expiresAt.toISOString()}`,
        expiresAt,
      };
    },

    async cancelCharge() {},

    verifyWebhook(rawBody, headers): VerifiedPaymentEvent {
      const signature = headers.get(MOCK_SIGNATURE_HEADER) ?? "";
      if (!/^[0-9a-f]{64}$/.test(signature)) {
        throw new AppError("UNAUTHENTICATED");
      }
      const expected = hmac(secret, rawBody).digest();
      if (!timingSafeEqual(Buffer.from(signature, "hex"), expected)) {
        throw new AppError("UNAUTHENTICATED");
      }

      let raw: unknown;
      try {
        raw = JSON.parse(rawBody);
      } catch {
        throw new AppError("VALIDATION_FAILED");
      }
      const event = mockEvent.safeParse(raw);
      if (!event.success) throw new AppError("VALIDATION_FAILED");
      return { ...event.data, raw };
    },
  };
}
