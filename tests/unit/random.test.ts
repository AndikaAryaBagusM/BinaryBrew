import { describe, expect, it } from "vitest";
import { createRandom } from "@/lib/random";

describe("createRandom", () => {
  it("gives the same sequence for the same seed", () => {
    const a = createRandom(81);
    const b = createRandom(81);
    const first = Array.from({ length: 5 }, () => a.next());
    expect(Array.from({ length: 5 }, () => b.next())).toEqual(first);
    expect(createRandom(82).next()).not.toBe(first[0]);
  });

  it("stays in range", () => {
    const random = createRandom(1);
    for (let i = 0; i < 1000; i++) {
      const value = random.next();
      expect(value).toBeGreaterThanOrEqual(0);
      expect(value).toBeLessThan(1);
      const int = random.int(3, 5);
      expect([3, 4, 5]).toContain(int);
    }
  });

  it("picks weighted values in proportion", () => {
    const random = createRandom(7);
    const counts = { a: 0, b: 0, never: 0 };
    for (let i = 0; i < 10_000; i++) {
      counts[
        random.weighted([
          ["a", 3],
          ["b", 1],
          ["never", 0],
        ] as const)
      ]++;
    }
    expect(counts.never).toBe(0);
    expect(counts.a / 10_000).toBeCloseTo(0.75, 1);
  });

  it("refuses weights that add up to nothing", () => {
    expect(() => createRandom(1).weighted([["a", 0]])).toThrow(RangeError);
  });
});
