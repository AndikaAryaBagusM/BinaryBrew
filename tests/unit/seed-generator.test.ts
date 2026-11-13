import { describe, expect, it } from "vitest";
import {
  generateSeedOrders,
  ITEM_POPULARITY,
  PLANTED_RULES,
  ruleStats,
} from "@/modules/orders/seed-generator";

const END = "2026-10-31";
const orders = generateSeedOrders({ endDate: END });

const jakartaHour = (at: Date) => (at.getUTCHours() + 7) % 24;

describe("seed order generator (FR-RC-07, docs/06 §7)", () => {
  it("is deterministic", () => {
    expect(generateSeedOrders({ endDate: END })).toEqual(orders);
    expect(generateSeedOrders({ endDate: END, seed: 82 })).not.toEqual(orders);
  });

  it("makes about 2,000 orders over 60 days ending on the end date", () => {
    expect(orders.length).toBeGreaterThanOrEqual(1900);
    expect(orders.length).toBeLessThanOrEqual(2100);
    const days = [...new Set(orders.map((o) => o.businessDate))];
    expect(days).toHaveLength(60);
    expect(days[0]).toBe("2026-09-02");
    expect(days.at(-1)).toBe(END);
  });

  it("keeps orders in payment order with consistent timestamps", () => {
    for (const [i, order] of orders.entries()) {
      if (i > 0) {
        expect(order.paidAt.getTime()).toBeGreaterThanOrEqual(
          orders[i - 1]!.paidAt.getTime(),
        );
      }
      expect(order.preparingAt > order.paidAt).toBe(true);
      expect(order.readyAt > order.preparingAt).toBe(true);
      expect(order.completedAt > order.readyAt).toBe(true);
      const hour = jakartaHour(order.paidAt);
      expect(hour).toBeGreaterThanOrEqual(7);
      expect(hour).toBeLessThan(22);
    }
  });

  it("puts about half of the orders in the 18.00–21.00 rush", () => {
    const evening = orders.filter((o) => {
      const hour = jakartaHour(o.paidAt);
      return hour >= 18 && hour < 21;
    });
    expect(evening.length / orders.length).toBeCloseTo(0.5, 1);
  });

  it("has about 1.6 distinct menu items per order, all from the menu", () => {
    const names = new Set(ITEM_POPULARITY.map(([name]) => name));
    let lines = 0;
    for (const order of orders) {
      const distinct = new Set(order.lines.map((l) => l.name));
      expect(distinct.size).toBe(order.lines.length);
      for (const line of order.lines) {
        expect(names.has(line.name)).toBe(true);
        expect(line.quantity).toBeGreaterThanOrEqual(1);
        expect(line.quantity).toBeLessThanOrEqual(3);
      }
      lines += order.lines.length;
    }
    expect(lines / orders.length).toBeCloseTo(1.6, 1);
  });

  it("splits orders between self-order and the Counter about 70/30", () => {
    const self = orders.filter((o) => o.channel === "self_order").length;
    expect(self / orders.length).toBeCloseTo(0.7, 1);
  });

  // P1-15 accepts ±0.07; the fixed seed keeps the sample much closer.
  it.each(PLANTED_RULES.map((rule) => [rule]))(
    "plants $antecedent → $consequent near its target",
    (rule) => {
      const stats = ruleStats(orders, rule.antecedent, rule.consequent);
      expect(Math.abs(stats.confidence - rule.targetConfidence)).toBeLessThan(
        0.03,
      );
      expect(stats.lift).toBeGreaterThan(1.05);
    },
  );

  it("keeps the planted confidences for another end date", () => {
    const other = generateSeedOrders({ endDate: "2026-12-15" });
    for (const rule of PLANTED_RULES) {
      const stats = ruleStats(other, rule.antecedent, rule.consequent);
      expect(Math.abs(stats.confidence - rule.targetConfidence)).toBeLessThan(
        0.03,
      );
    }
  });

  it("refuses a malformed end date", () => {
    expect(() => generateSeedOrders({ endDate: "31-10-2026" })).toThrow(
      RangeError,
    );
  });
});
