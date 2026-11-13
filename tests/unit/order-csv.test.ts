import { describe, expect, it } from "vitest";
import { readOrderCsv } from "@/modules/orders/order-csv";

const catalog = [
  { id: "id-kopi", name: "Kopi Susu Gula Aren", price: 18000 },
  { id: "id-croissant", name: "Croissant", price: 18000 },
  { id: "id-latte", name: "Latte", price: 22000 },
  { id: "id-teh-1", name: "Es Teh", price: 8000 },
  { id: "id-teh-2", name: "es teh", price: 9000 },
];
const now = new Date("2026-11-01T00:00:00Z");
const read = (text: string) => readOrderCsv(text, catalog, now);
const HEADER = "order_ref,paid_at,item_name,quantity,unit_price";

describe("readOrderCsv (FR-RC-07)", () => {
  it("groups rows into orders, oldest payment first", () => {
    const result = read(
      [
        HEADER,
        "B-2,2026-10-02T10:00:00+07:00,Latte,1,Rp 20.000",
        "A-1,2026-10-01 09:15,  kopi  susu gula aren ,2,18.500",
        "A-1,2026-10-01 09:15,Croissant,1,",
      ].join("\n"),
    );
    expect(result.problems).toEqual([]);
    expect(result.orders).toEqual([
      {
        ref: "A-1",
        paidAt: new Date("2026-10-01T02:15:00Z"),
        lines: [
          {
            menuItemId: "id-kopi",
            name: "Kopi Susu Gula Aren",
            unitPrice: 18500,
            quantity: 2,
          },
          // No unit_price: the current menu price.
          {
            menuItemId: "id-croissant",
            name: "Croissant",
            unitPrice: 18000,
            quantity: 1,
          },
        ],
      },
      {
        ref: "B-2",
        paidAt: new Date("2026-10-02T03:00:00Z"),
        lines: [
          {
            menuItemId: "id-latte",
            name: "Latte",
            unitPrice: 20000,
            quantity: 1,
          },
        ],
      },
    ]);
  });

  it("accepts columns in any order and without unit_price", () => {
    const result = read(
      "Quantity,Item_Name,Paid_At,Order_Ref\n3,Latte,2026-10-01 08:00,X",
    );
    expect(result.orders[0]?.lines[0]).toMatchObject({
      unitPrice: 22000,
      quantity: 3,
    });
  });

  it("reports every bad row by line number and returns no orders", () => {
    const result = read(
      [
        HEADER,
        ",2026-10-01 09:00,Latte,1,", // 2
        "A,2026-02-30 09:00,Latte,1,", // 3
        "B,2026-10-01 09:00,Cappuccino,1,", // 4
        "C,2026-10-01 09:00,Es Teh,1,", // 5
        "D,2026-10-01 09:00,Latte,0,", // 6
        "E,2026-10-01 09:00,Latte,21,", // 7
        "F,2026-10-01 09:00,Latte,1.5,", // 8
        "G,2026-10-01 09:00,Latte,1,18,5", // 9
        "H,2026-10-01 09:00,Latte,1,gratis", // 10
        "I,2026-12-01 09:00,Latte,1,", // 11
        "J,2026-10-01 09:00,Latte,1,", // 12
        "J,2026-10-01 09:01,Latte,1,", // 13
        "K,2026-10-01T09:00:00,Latte,1,", // 14: no offset, read as shop time
      ].join("\n"),
    );
    expect(result.orders).toEqual([]);
    expect(result.problems).toEqual([
      { line: 2, message: "order_ref is empty" },
      {
        line: 3,
        message:
          'paid_at "2026-02-30 09:00" is not "YYYY-MM-DD HH:MM" or an ISO time with an offset',
      },
      { line: 4, message: 'unknown menu item "Cappuccino"' },
      { line: 5, message: '"Es Teh" matches 2 menu items' },
      { line: 6, message: "quantity must be a whole number from 1 to 20" },
      { line: 7, message: "quantity must be a whole number from 1 to 20" },
      { line: 8, message: "quantity must be a whole number from 1 to 20" },
      { line: 9, message: "expected 5 fields, found 6" },
      { line: 10, message: 'unit_price "gratis" is not a whole rupiah amount' },
      { line: 11, message: 'paid_at "2026-12-01 09:00" is in the future' },
      { line: 13, message: 'paid_at differs from line 12 of order "J"' },
    ]);
  });

  it("refuses a header without the required columns", () => {
    expect(
      read("order_ref,item_name,item_name\nA,Latte,Latte").problems,
    ).toEqual([
      { line: 1, message: 'column "item_name" appears twice' },
      { line: 1, message: 'missing column "paid_at"' },
      { line: 1, message: 'missing column "quantity"' },
    ]);
  });

  it("refuses an order with more than 30 lines", () => {
    const rows = Array.from(
      { length: 31 },
      () => "A,2026-10-01 09:00,Latte,1,",
    );
    expect(read([HEADER, ...rows].join("\n")).problems).toEqual([
      { line: 2, message: 'order "A" has more than 30 lines' },
    ]);
  });

  it("refuses an empty file and broken quoting", () => {
    expect(read(HEADER).problems).toEqual([
      { line: 1, message: "the file has no order rows" },
    ]);
    expect(read(`${HEADER}\n"A,2026-10-01 09:00,Latte,1,`).problems).toEqual([
      { line: 2, message: "line 2: quoted field is not closed" },
    ]);
  });
});
