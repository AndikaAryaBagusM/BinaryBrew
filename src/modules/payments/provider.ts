// The one interface a payment gateway adapter implements (Tech §8). Only the
// mock exists until a real gateway is chosen (Phase 4).

export type PaymentEventType = "paid" | "expired" | "failed";

export type VerifiedPaymentEvent = {
  eventId: string;
  providerRef: string;
  type: PaymentEventType;
  raw: unknown;
};

export interface PaymentProvider {
  readonly name: string;
  createQrisCharge(input: {
    orderId: string;
    amount: number; // whole rupiah
    expiresAt: Date;
    idempotencyKey: string;
  }): Promise<{ providerRef: string; qrString: string; expiresAt: Date }>;

  cancelCharge(providerRef: string): Promise<void>; // best effort

  // Throws UNAUTHENTICATED for a bad signature, VALIDATION_FAILED for a
  // signed body that is not an event.
  verifyWebhook(rawBody: string, headers: Headers): VerifiedPaymentEvent;
}
