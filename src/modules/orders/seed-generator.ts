import { createRandom, type Random } from "@/lib/random";
import { addDays } from "@/lib/time";

// Demo order history (FR-RC-07, docs/06 §7). Pure and deterministic: the
// same seed and end date always give the same orders, so the course report
// can say exactly how the data was made. Items are named, not ids; the
// orders service maps names to the seeded menu. Every parameter below is
// listed in scripts/README.md.

export const SEED_PARAMETERS = {
  seed: 81, // chosen from 1–300: closest sample to the planted targets
  days: 60,
  ordersPerDay: 33.3, // ≈ 2,000 over 60 days
  weekendFactor: 1.25, // Saturday and Sunday
  weekdayFactor: 0.9,
  dailyJitter: 0.15, // ± share of the day's count
  selfOrderShare: 0.7, // the rest are Counter walk-ins
  secondItemChance: 0.36, // a second, unrelated item
  thirdItemChance: 0.12, // a third one, after a second
} as const;

// How often each item is the first thing ordered.
export const ITEM_POPULARITY: readonly (readonly [string, number])[] = [
  ["Kopi Susu Gula Aren", 22],
  ["Americano", 12],
  ["Latte", 12],
  ["Es Teh Lemon", 12],
  ["Matcha Latte", 8],
  ["Es Cokelat", 7],
  ["Croissant", 6],
  ["Kentang Goreng", 5],
  ["Sandwich Ayam", 5],
  ["Affogato", 4],
  ["Brownie", 4],
  ["Roti Bakar", 3],
];

// Planted pairings (docs/06 §7). `addChance` is the chance the consequent is
// added when the antecedent is in the basket; together with the consequent's
// own popularity it gives the target confidence.
export const PLANTED_RULES = [
  {
    antecedent: "Kopi Susu Gula Aren",
    consequent: "Croissant",
    targetConfidence: 0.35,
    addChance: 0.32,
  },
  {
    antecedent: "Americano",
    consequent: "Brownie",
    targetConfidence: 0.25,
    addChance: 0.23,
  },
  {
    antecedent: "Es Teh Lemon",
    consequent: "Kentang Goreng",
    targetConfidence: 0.3,
    addChance: 0.27,
  },
  {
    antecedent: "Latte",
    consequent: "Roti Bakar",
    targetConfidence: 0.2,
    addChance: 0.185,
  },
] as const;

// Share of orders paid in each hour (Asia/Jakarta, open 07.00–22.00); 18.00–
// 21.00 carries half of them.
export const HOUR_WEIGHTS: readonly (readonly [number, number])[] = [
  [7, 3],
  [8, 5],
  [9, 4],
  [10, 3],
  [11, 3],
  [12, 5],
  [13, 4],
  [14, 3],
  [15, 3],
  [16, 4],
  [17, 5],
  [18, 14],
  [19, 16],
  [20, 14],
  [21, 2],
];

const QUANTITY_WEIGHTS: readonly (readonly [number, number])[] = [
  [1, 85],
  [2, 12],
  [3, 3],
];

export type GeneratedLine = { name: string; quantity: number };

export type GeneratedOrder = {
  businessDate: string; // YYYY-MM-DD; the shop closes before the cutoff
  paidAt: Date;
  preparingAt: Date;
  readyAt: Date;
  completedAt: Date;
  channel: "self_order" | "counter";
  table: number; // 0-based index into the tables (self-order)
  staff: number; // 0-based index into the staff (Counter)
  lines: GeneratedLine[];
};

const JAKARTA_OFFSET_HOURS = 7; // no daylight saving
const MINUTE = 60_000;

function isWeekend(date: string): boolean {
  const day = new Date(`${date}T00:00:00Z`).getUTCDay();
  return day === 0 || day === 6;
}

function basket(random: Random): GeneratedLine[] {
  const names: string[] = [random.weighted(ITEM_POPULARITY)];
  const addOther = () => {
    const others = ITEM_POPULARITY.filter(([name]) => !names.includes(name));
    names.push(random.weighted(others));
  };
  if (random.chance(SEED_PARAMETERS.secondItemChance)) {
    addOther();
    if (random.chance(SEED_PARAMETERS.thirdItemChance)) addOther();
  }
  for (const rule of PLANTED_RULES) {
    if (
      names.includes(rule.antecedent) &&
      !names.includes(rule.consequent) &&
      random.chance(rule.addChance)
    ) {
      names.push(rule.consequent);
    }
  }
  return names.map((name) => ({
    name,
    quantity: random.weighted(QUANTITY_WEIGHTS),
  }));
}

// Orders for the `days` business days ending on `endDate`, oldest first.
export function generateSeedOrders({
  endDate,
  seed = SEED_PARAMETERS.seed,
  days = SEED_PARAMETERS.days,
}: {
  endDate: string;
  seed?: number;
  days?: number;
}): GeneratedOrder[] {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(endDate)) {
    throw new RangeError(`endDate must be YYYY-MM-DD, got ${endDate}`);
  }
  // Two streams: the baskets depend only on the seed, not on which weekdays
  // the dates fall on, so the planted confidences do not move with the end
  // date.
  const random = createRandom(seed);
  const baskets = createRandom(seed ^ 0x9e3779b9);
  const orders: GeneratedOrder[] = [];
  for (let offset = days - 1; offset >= 0; offset--) {
    const date = addDays(endDate, -offset);
    const factor = isWeekend(date)
      ? SEED_PARAMETERS.weekendFactor
      : SEED_PARAMETERS.weekdayFactor;
    const jitter = 1 + (random.next() * 2 - 1) * SEED_PARAMETERS.dailyJitter;
    const count = Math.round(SEED_PARAMETERS.ordersPerDay * factor * jitter);
    const [y, m, d] = date.split("-").map(Number) as [number, number, number];

    const day: GeneratedOrder[] = [];
    for (let i = 0; i < count; i++) {
      const hour = random.weighted(HOUR_WEIGHTS);
      const paidAt = new Date(
        Date.UTC(
          y,
          m - 1,
          d,
          hour - JAKARTA_OFFSET_HOURS,
          random.int(0, 59),
          random.int(0, 59),
        ),
      );
      // The evening rush makes drinks a little slower.
      const rush = hour >= 18 && hour < 21;
      const preparingAt = new Date(
        paidAt.getTime() + random.int(20, 120) * 1000,
      );
      const readyAt = new Date(
        preparingAt.getTime() + random.int(3, rush ? 10 : 7) * MINUTE,
      );
      const completedAt = new Date(
        readyAt.getTime() + random.int(30, 300) * 1000,
      );
      const selfOrder = random.chance(SEED_PARAMETERS.selfOrderShare);
      day.push({
        businessDate: date,
        paidAt,
        preparingAt,
        readyAt,
        completedAt,
        channel: selfOrder ? "self_order" : "counter",
        table: random.int(0, 5),
        staff: random.int(0, 1),
        lines: basket(baskets),
      });
    }
    day.sort((a, b) => a.paidAt.getTime() - b.paidAt.getTime());
    orders.push(...day);
  }
  return orders;
}

// Support, confidence and lift of A → B over the baskets (distinct items),
// as the Apriori job computes them; for tests and the README.
export function ruleStats(
  orders: readonly { lines: readonly { name: string }[] }[],
  antecedent: string,
  consequent: string,
) {
  const baskets = orders.map(
    (order) => new Set(order.lines.map((l) => l.name)),
  );
  const withA = baskets.filter((b) => b.has(antecedent));
  const withB = baskets.filter((b) => b.has(consequent));
  const both = withA.filter((b) => b.has(consequent));
  const confidence = both.length / withA.length;
  return {
    support: both.length / baskets.length,
    confidence,
    lift: confidence / (withB.length / baskets.length),
  };
}
