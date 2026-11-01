import { describe, expect, it } from "vitest";
import { AppError } from "@/lib/errors";
import {
  createMockProvider,
  MOCK_SIGNATURE_HEADER,
  signMockBody,
  signMockEvent,
} from "@/modules/payments/providers/mock";

// The mock provider (Tech §8) stands in for a QRIS gateway: fake charges, and
// webhooks signed with PAYMENT_WEBHOOK_SECRET so the real verification path runs.

const secret = "ab".repeat(32);
const provider = createMockProvider(secret);

describe("mock provider", () => {
  it("creates a charge with its own reference and a QR payload", async () => {
    const expiresAt = new Date("2026-11-01T12:10:00Z");
    const charge = await provider.createQrisCharge({
      orderId: "8d5b7c1e-0000-4000-8000-000000000001",
      amount: 88_000,
      expiresAt,
      idempotencyKey: "order-1",
    });
    expect(provider.name).toBe("mock");
    expect(charge.providerRef).toMatch(/^mock_[A-Za-z0-9_-]{16,}$/);
    expect(charge.qrString).toContain("88000");
    expect(charge.expiresAt).toEqual(expiresAt);

    const other = await provider.createQrisCharge({
      orderId: "8d5b7c1e-0000-4000-8000-000000000002",
      amount: 88_000,
      expiresAt,
      idempotencyKey: "order-2",
    });
    expect(other.providerRef).not.toBe(charge.providerRef);
  });

  it("returns the same charge for a retried idempotency key, like a gateway", async () => {
    const request = {
      orderId: "8d5b7c1e-0000-4000-8000-000000000003",
      amount: 25_000,
      expiresAt: new Date("2026-11-01T12:10:00Z"),
      idempotencyKey: "order-3",
    };
    const first = await provider.createQrisCharge(request);
    expect(await provider.createQrisCharge(request)).toEqual(first);
  });

  it("verifies a webhook it signed", () => {
    const { body, headers } = signMockEvent(secret, {
      eventId: "evt-1",
      providerRef: "mock_abc",
      type: "paid",
    });
    expect(provider.verifyWebhook(body, headers)).toMatchObject({
      eventId: "evt-1",
      providerRef: "mock_abc",
      type: "paid",
    });
  });

  it.each([
    [
      "a changed body",
      (body: string, headers: Headers) =>
        [body.replace("paid", "expired"), headers] as const,
    ],
    ["a missing signature", (body: string) => [body, new Headers()] as const],
    [
      "a signature made with another secret",
      () => {
        const forged = signMockEvent("cd".repeat(32), {
          eventId: "evt-1",
          providerRef: "mock_abc",
          type: "paid",
        });
        return [forged.body, forged.headers] as const;
      },
    ],
    [
      "a malformed signature",
      (body: string) =>
        [body, new Headers({ [MOCK_SIGNATURE_HEADER]: "not-hex" })] as const,
    ],
  ])("refuses %s", (_case, tamper) => {
    const signed = signMockEvent(secret, {
      eventId: "evt-1",
      providerRef: "mock_abc",
      type: "paid",
    });
    const [body, headers] = tamper(signed.body, signed.headers);
    expect(() => provider.verifyWebhook(body, headers)).toThrow(AppError);
    try {
      provider.verifyWebhook(body, headers);
    } catch (error) {
      expect((error as AppError).code).toBe("UNAUTHENTICATED");
    }
  });

  it.each([
    ["not JSON", "paid"],
    ["an unknown shape", JSON.stringify({ hello: "world" })],
    [
      "an unknown event type",
      JSON.stringify({ eventId: "e", providerRef: "r", type: "refunded" }),
    ],
  ])("refuses a correctly signed body that is %s", (_case, body) => {
    const headers = signMockBody(secret, body);
    expect(() => provider.verifyWebhook(body, headers)).toThrow(AppError);
  });
});
