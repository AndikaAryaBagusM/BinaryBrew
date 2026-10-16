import { describe, expect, it } from "vitest";
import { parseEnv } from "@/lib/env";

const valid = {
  DATABASE_URL:
    "postgres://binarybrew:binarybrew_dev@localhost:5432/binarybrew",
  APP_BASE_URL: "http://192.168.1.20:3000",
  TOKEN_HASH_PEPPER: "a".repeat(64),
  PAYMENT_PROVIDER: "mock",
  PAYMENT_WEBHOOK_SECRET: "b".repeat(64),
  TZ: "Asia/Jakarta",
};

describe("parseEnv", () => {
  it("accepts a complete environment", () => {
    expect(parseEnv(valid)).toEqual(valid);
  });

  it("ignores unrelated variables", () => {
    expect(parseEnv({ ...valid, PATH: "/usr/bin" })).toEqual(valid);
  });

  it.each(Object.keys(valid))("rejects a missing %s", (key) => {
    const env: Record<string, string | undefined> = {
      ...valid,
      [key]: undefined,
    };
    expect(() => parseEnv(env)).toThrow(key);
  });

  it.each([
    ["DATABASE_URL", "mysql://localhost/binarybrew"],
    ["APP_BASE_URL", "ftp://192.168.1.20"],
    ["TOKEN_HASH_PEPPER", "a".repeat(63)],
    ["TOKEN_HASH_PEPPER", "z".repeat(64)],
    ["PAYMENT_PROVIDER", "midtrans"],
    ["PAYMENT_WEBHOOK_SECRET", "short"],
    ["TZ", "UTC"],
  ])("rejects an invalid %s (%s)", (key, value) => {
    expect(() => parseEnv({ ...valid, [key]: value })).toThrow(key);
  });

  it("never echoes secret values in the error", () => {
    const leaked = "c".repeat(63);
    let message = "";
    try {
      parseEnv({ ...valid, TOKEN_HASH_PEPPER: leaked });
    } catch (error) {
      message = (error as Error).message;
    }
    expect(message).toContain("TOKEN_HASH_PEPPER");
    expect(message).not.toContain(leaked);
  });
});
