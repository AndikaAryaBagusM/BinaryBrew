// A small seeded random generator (mulberry32) for reproducible demo data
// (docs/06 §7): the same seed always gives the same sequence. Not for
// secrets; tokens use node:crypto (lib/ids.ts).

export type Random = {
  next: () => number; // [0, 1)
  chance: (probability: number) => boolean;
  int: (min: number, max: number) => number; // both inclusive
  weighted: <T>(entries: readonly (readonly [T, number])[]) => T;
};

export function createRandom(seed: number): Random {
  let state = seed >>> 0;
  const next = () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4_294_967_296;
  };
  return {
    next,
    chance: (probability) => next() < probability,
    int: (min, max) => min + Math.floor(next() * (max - min + 1)),
    weighted: (entries) => {
      const total = entries.reduce((sum, [, weight]) => sum + weight, 0);
      if (!(total > 0)) throw new RangeError("weights must add up to > 0");
      let roll = next() * total;
      for (const [value, weight] of entries) {
        roll -= weight;
        if (roll < 0) return value;
      }
      return entries[entries.length - 1]![0];
    },
  };
}
