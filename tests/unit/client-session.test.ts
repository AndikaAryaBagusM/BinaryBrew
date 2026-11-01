import { describe, expect, it } from "vitest";
import {
  CLIENT_SESSION_KEY,
  getClientSession,
  newClientToken,
} from "@/lib/client-session";
import { clientToken } from "@/modules/orders/schemas";

// The browser's random id for the open-order cap (BR-11) and the per-request
// Idempotency-Key (Tech §5). Not personal data (D19).

function memoryStorage(initial: Record<string, string> = {}) {
  const values = new Map(Object.entries(initial));
  return {
    values,
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => void values.set(key, value),
  };
}

describe("newClientToken", () => {
  it("is URL-safe, accepted by the order API, and new each time", () => {
    const a = newClientToken();
    const b = newClientToken();
    expect(a).toMatch(/^[A-Za-z0-9_-]{22}$/);
    expect(clientToken.safeParse(a).success).toBe(true);
    expect(a).not.toBe(b);
  });
});

describe("getClientSession", () => {
  it("creates one id and keeps it", () => {
    const storage = memoryStorage();
    const first = getClientSession(storage);
    expect(clientToken.safeParse(first).success).toBe(true);
    expect(storage.values.get(CLIENT_SESSION_KEY)).toBe(first);
    expect(getClientSession(storage)).toBe(first);
  });

  it("replaces a stored value the order API would refuse", () => {
    const storage = memoryStorage({ [CLIENT_SESSION_KEY]: "short" });
    const id = getClientSession(storage);
    expect(id).not.toBe("short");
    expect(clientToken.safeParse(id).success).toBe(true);
  });

  it("still returns a usable id when storage is blocked", () => {
    const blocked = {
      getItem: () => {
        throw new Error("SecurityError");
      },
      setItem: () => {
        throw new Error("SecurityError");
      },
    };
    expect(clientToken.safeParse(getClientSession(blocked)).success).toBe(true);
  });
});
