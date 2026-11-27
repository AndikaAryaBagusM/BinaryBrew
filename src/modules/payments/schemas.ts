import { z } from "zod";

// S-05 (FR-PM-05): the bank or e-wallet reference is required; the note is
// optional. elevationId comes from POST /api/auth/elevate when the owner's
// PIN is required.
// O-12 "Tandai sudah dikembalikan" (P3-01): the gateway's refund id is
// required; elevationId comes from the owner's own PIN (refund_processed).
export const refundProcessedBody = z.strictObject({
  gatewayRef: z.string().trim().min(1).max(64),
  elevationId: z.uuid(),
});

export const manualPaymentBody = z.strictObject({
  reference: z.string().trim().min(1).max(64),
  note: z.string().trim().max(200).optional(),
  elevationId: z.uuid().optional(),
});
