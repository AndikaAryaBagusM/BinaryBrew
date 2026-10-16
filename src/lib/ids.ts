import { randomBytes } from "node:crypto";

// URL-safe random token (base64url) from a cryptographic source.
export function randomToken(bytes: number): string {
  if (!Number.isInteger(bytes) || bytes < 16) {
    throw new RangeError(`tokens need at least 16 random bytes, got ${bytes}`);
  }
  return randomBytes(bytes).toString("base64url");
}

// 256-bit session and device cookies; only a keyed hash is stored (Tech §9).
export const newSecretToken = (): string => randomToken(32);

// 128-bit order public_token for status and receipt links (Tech §9, BR-13).
export const newPublicToken = (): string => randomToken(16);

// 128-bit token printed in table and entrance QR codes.
export const newQrToken = (): string => randomToken(16);
