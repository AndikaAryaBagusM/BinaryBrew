import { describe, expect, it } from "vitest";
import {
  newPublicToken,
  newQrToken,
  newSecretToken,
  randomToken,
} from "@/lib/ids";

const base64url = /^[A-Za-z0-9_-]+$/;

describe("random tokens", () => {
  it.each([
    ["newSecretToken (sessions, devices: 256-bit)", newSecretToken, 43],
    ["newPublicToken (receipt links: 128-bit)", newPublicToken, 22],
    ["newQrToken (QR codes: 128-bit)", newQrToken, 22],
  ])("%s is URL-safe with %i characters", (_label, make, length) => {
    const token = make();
    expect(token).toMatch(base64url);
    expect(token).toHaveLength(length);
  });

  it("does not repeat", () => {
    const tokens = new Set(Array.from({ length: 1_000 }, newPublicToken));
    expect(tokens.size).toBe(1_000);
  });

  it("encodes the requested number of bytes", () => {
    expect(Buffer.from(randomToken(32), "base64url")).toHaveLength(32);
  });

  it("refuses fewer than 16 bytes", () => {
    expect(() => randomToken(8)).toThrow(RangeError);
  });
});
