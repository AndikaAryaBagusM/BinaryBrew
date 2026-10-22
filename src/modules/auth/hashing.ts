import { createHmac } from "node:crypto";
import { argon2id, hash, verify } from "argon2";

// PINs and the owner password are stored as argon2id hashes (Tech §9).
export function hashSecret(plain: string): Promise<string> {
  return hash(plain, { type: argon2id });
}

export function verifySecret(stored: string, plain: string): Promise<boolean> {
  return verify(stored, plain);
}

// Session and device cookies: only an HMAC keyed with TOKEN_HASH_PEPPER (hex)
// is stored, so a leaked table cannot be replayed as cookies (Tech §9).
export function hashToken(token: string, pepperHex: string): string {
  return createHmac("sha256", Buffer.from(pepperHex, "hex"))
    .update(token)
    .digest("hex");
}
