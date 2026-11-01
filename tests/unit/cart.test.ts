import { beforeEach, describe, expect, it } from "vitest";
import {
  addToCart,
  CART_KEY,
  type CartEntry,
  cartQuantity,
  readCart,
  reconcileCart,
  removeLine,
  setLineQuantity,
  toCartLines,
  writeCart,
} from "@/lib/cart";
import { MAX_LINES, MAX_QUANTITY } from "@/modules/orders/pricing";

// The cart lives in sessionStorage (Flow §3): ids, options and quantities
// only. Prices always come from the menu and the pricing service.

class MemoryStorage {
  values = new Map<string, string>();
  getItem(key: string) {
    return this.values.get(key) ?? null;
  }
  setItem(key: string, value: string) {
    this.values.set(key, value);
  }
}

let counter = 0;
const newId = () => `line-${++counter}`;
beforeEach(() => {
  counter = 0;
});

const kopi = (options: string[] = ["o-regular"], quantity = 1) => ({
  menuItemId: "i-kopi",
  quantity,
  modifierOptionIds: options,
});

describe("addToCart", () => {
  it("adds a new line with its own id", () => {
    const { entries, result } = addToCart([], kopi(), newId);
    expect(result).toBe("added");
    expect(entries).toEqual([
      {
        lineId: "line-1",
        menuItemId: "i-kopi",
        quantity: 1,
        modifierOptionIds: ["o-regular"],
      },
    ]);
  });

  it("merges the same item with the same options, in any order", () => {
    const first = addToCart([], kopi(["o-large", "o-shot"], 2), newId).entries;
    const { entries, result } = addToCart(
      first,
      kopi(["o-shot", "o-large"], 3),
      newId,
    );
    expect(result).toBe("merged");
    expect(entries).toHaveLength(1);
    expect(entries[0]!.quantity).toBe(5);
  });

  it("keeps different options on separate lines", () => {
    let entries = addToCart([], kopi(["o-regular"]), newId).entries;
    entries = addToCart(entries, kopi(["o-large"]), newId).entries;
    expect(entries.map((e) => e.lineId)).toEqual(["line-1", "line-2"]);
  });

  it("caps a merged line at the per-line maximum", () => {
    const first = addToCart([], kopi(["o-regular"], 18), newId).entries;
    const { entries } = addToCart(first, kopi(["o-regular"], 5), newId);
    expect(entries[0]!.quantity).toBe(MAX_QUANTITY);
  });

  it("refuses a new line when the order already has the maximum", () => {
    let entries: CartEntry[] = [];
    for (let i = 0; i < MAX_LINES; i++) {
      entries = addToCart(entries, kopi([`o-${i}`]), newId).entries;
    }
    const { entries: after, result } = addToCart(
      entries,
      kopi(["o-new"]),
      newId,
    );
    expect(result).toBe("full");
    expect(after).toBe(entries);
  });
});

describe("setLineQuantity and removeLine", () => {
  const start = () =>
    addToCart(addToCart([], kopi(), newId).entries, kopi(["o-large"]), newId)
      .entries;

  it("changes the quantity within 1..20", () => {
    const entries = start();
    expect(setLineQuantity(entries, "line-1", 3)[0]!.quantity).toBe(3);
    expect(setLineQuantity(entries, "line-1", 0)[0]!.quantity).toBe(1);
    expect(setLineQuantity(entries, "line-1", 99)[0]!.quantity).toBe(
      MAX_QUANTITY,
    );
  });

  it("removes one line", () => {
    expect(removeLine(start(), "line-1").map((e) => e.lineId)).toEqual([
      "line-2",
    ]);
  });

  it("counts the items across lines", () => {
    const entries = setLineQuantity(start(), "line-2", 4);
    expect(cartQuantity(entries)).toBe(5);
  });
});

describe("storage", () => {
  it("round-trips the cart", () => {
    const storage = new MemoryStorage();
    const entries = addToCart([], kopi(), newId).entries;
    writeCart(storage, entries);
    expect(readCart(storage)).toEqual(entries);
  });

  it("reads broken or foreign data as an empty cart", () => {
    const storage = new MemoryStorage();
    for (const raw of [
      "not json",
      "{}",
      '[{"lineId": "a", "menuItemId": "b", "quantity": "2", "modifierOptionIds": []}]',
      '[{"lineId": "a", "menuItemId": "b", "quantity": 2}]',
      '[{"lineId": "a", "menuItemId": "b", "quantity": 2, "modifierOptionIds": [1]}]',
    ]) {
      storage.setItem(CART_KEY, raw);
      expect(readCart(storage), raw).toEqual([]);
    }
  });

  it("never stores prices", () => {
    const storage = new MemoryStorage();
    writeCart(storage, addToCart([], kopi(), newId).entries);
    expect(storage.getItem(CART_KEY)).not.toMatch(/price|total/i);
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
    expect(readCart(broken)).toEqual([]);
    expect(() => writeCart(broken, [])).not.toThrow();
  });
});

describe("reconcileCart (the menu may have changed since the line was added)", () => {
  const size = {
    id: "g-size",
    name: "Ukuran",
    minSelect: 1,
    maxSelect: 1,
    options: [
      { id: "o-regular", name: "Regular", priceDelta: 0 },
      { id: "o-large", name: "Large", priceDelta: 5_000 },
    ],
  };
  const items = [
    {
      id: "i-kopi",
      name: "Kopi",
      price: 22_000,
      isAvailable: true,
      modifierGroups: [size],
    },
    {
      id: "i-roti",
      name: "Roti",
      price: 20_000,
      isAvailable: false,
      modifierGroups: [],
    },
  ];

  it("keeps valid lines, marks sold-out ones and drops the rest", () => {
    const entries: CartEntry[] = [
      {
        lineId: "a",
        menuItemId: "i-kopi",
        quantity: 1,
        modifierOptionIds: ["o-large"],
      },
      { lineId: "b", menuItemId: "i-roti", quantity: 2, modifierOptionIds: [] },
      // Removed from the menu
      { lineId: "c", menuItemId: "i-gone", quantity: 1, modifierOptionIds: [] },
      // Option retired since it was added
      {
        lineId: "d",
        menuItemId: "i-kopi",
        quantity: 1,
        modifierOptionIds: ["o-old"],
      },
    ];
    const { entries: kept, soldOut } = reconcileCart(entries, items);
    expect(kept.map((e) => e.lineId)).toEqual(["a", "b"]);
    expect([...soldOut]).toEqual(["b"]);
  });

  it("turns entries into pricing lines", () => {
    expect(
      toCartLines([
        {
          lineId: "a",
          menuItemId: "i-kopi",
          quantity: 2,
          modifierOptionIds: ["o-large"],
        },
      ]),
    ).toEqual([
      { menuItemId: "i-kopi", quantity: 2, modifierOptionIds: ["o-large"] },
    ]);
  });
});
