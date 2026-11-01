import { beforeEach, describe, expect, it } from "vitest";
import {
  readRecentOrders,
  RECENT_ORDERS_KEY,
  rememberOrder,
} from "@/lib/recent-orders";

// "Pesanan saya" (Flow §3): the browser remembers the last few order links.
class MemoryStorage {
  private values = new Map<string, string>();
  getItem(key: string) {
    return this.values.get(key) ?? null;
  }
  setItem(key: string, value: string) {
    this.values.set(key, value);
  }
}

const hour = 60 * 60_000;
const t0 = new Date("2026-11-01T11:00:00Z");
const at = (ms: number) => new Date(t0.getTime() + ms);

let storage: MemoryStorage;
beforeEach(() => {
  storage = new MemoryStorage();
});

describe("recent orders", () => {
  it("starts empty", () => {
    expect(readRecentOrders(storage, t0)).toEqual([]);
  });

  it("remembers orders newest first, without duplicates", () => {
    rememberOrder(storage, "token-a", t0);
    rememberOrder(storage, "token-b", at(1000));
    rememberOrder(storage, "token-a", at(2000));
    expect(readRecentOrders(storage, at(3000))).toEqual([
      { publicToken: "token-a", createdAt: at(2000).toISOString() },
      { publicToken: "token-b", createdAt: at(1000).toISOString() },
    ]);
  });

  it("keeps at most 5", () => {
    for (let i = 0; i < 7; i++) rememberOrder(storage, `token-${i}`, at(i));
    const tokens = readRecentOrders(storage, at(10)).map((o) => o.publicToken);
    expect(tokens).toEqual([
      "token-6",
      "token-5",
      "token-4",
      "token-3",
      "token-2",
    ]);
  });

  it("forgets orders older than 24 hours", () => {
    rememberOrder(storage, "old", t0);
    rememberOrder(storage, "new", at(23 * hour));
    expect(
      readRecentOrders(storage, at(24 * hour)).map((o) => o.publicToken),
    ).toEqual(["new"]);
  });

  it("ignores broken or foreign data in storage", () => {
    for (const raw of [
      "not json",
      "{}",
      '[{"publicToken": 5}]',
      '[{"x": 1}]',
    ]) {
      storage.setItem(RECENT_ORDERS_KEY, raw);
      expect(readRecentOrders(storage, t0)).toEqual([]);
    }
  });

  it("survives storage that throws (private mode)", () => {
    const broken = {
      getItem: () => {
        throw new Error("blocked");
      },
      setItem: () => {
        throw new Error("blocked");
      },
    };
    expect(readRecentOrders(broken, t0)).toEqual([]);
    expect(() => rememberOrder(broken, "token-a", t0)).not.toThrow();
  });
});
