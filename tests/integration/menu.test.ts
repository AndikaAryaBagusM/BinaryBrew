import { eq, inArray } from "drizzle-orm";
import { NextRequest } from "next/server";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { GET as menuGet } from "@/app/api/public/menu/route";
import { closeSql, getDb } from "@/db/client";
import * as schema from "@/db/schema";
import { getPublicMenu } from "@/modules/menu/service";
import { createCatalog } from "./menu-fixtures";

afterAll(() => closeSql());

let catalog: Awaited<ReturnType<typeof createCatalog>>;
beforeAll(async () => {
  catalog = await createCatalog();
});
// Ordering is on unless a test switches it off.
beforeEach(async () => {
  await getDb()
    .delete(schema.settings)
    .where(eq(schema.settings.key, "ordering_enabled"));
});

const mine = (menu: Awaited<ReturnType<typeof getPublicMenu>>) =>
  menu.categories.filter((c) =>
    Object.values(catalog.categories).some((own) => own.id === c.id),
  );

describe("getPublicMenu (FR-CO-01, FR-CO-02)", () => {
  it("returns the shop name, the table label and active categories in order", async () => {
    const menu = await getPublicMenu(catalog.qr.token);
    expect(menu.shopName).toBe("Binary Brew");
    expect(menu.table).toBe(catalog.qr.label);
    expect(mine(menu).map((c) => c.id)).toEqual([
      catalog.categories.drinks.id,
      catalog.categories.food.id,
      catalog.categories.empty.id,
    ]);
    expect(
      mine(menu).find((c) => c.id === catalog.categories.empty.id)!.items,
    ).toEqual([]);
  });

  it("lists active items in order, keeps sold-out items visible but unavailable", async () => {
    const menu = await getPublicMenu(catalog.qr.token);
    const drinks = mine(menu)[0]!;
    expect(drinks.items.map((i) => i.id)).toEqual([
      catalog.items.americano.id,
      catalog.items.latte.id,
      catalog.items.soldOut.id,
    ]);
    expect(drinks.items.map((i) => i.isAvailable)).toEqual([true, true, false]);

    const allIds = menu.categories.flatMap((c) => c.items.map((i) => i.id));
    expect(allIds).not.toContain(catalog.items.inactive.id);
    expect(allIds).not.toContain(catalog.items.archived.id);
  });

  it("gives each item exactly the public fields, with integer rupiah prices", async () => {
    const menu = await getPublicMenu(catalog.qr.token);
    const latte = mine(menu)[0]!.items.find(
      (i) => i.id === catalog.items.latte.id,
    )!;
    expect(Object.keys(latte).sort()).toEqual(
      [
        "description",
        "id",
        "imageUrl",
        "isAvailable",
        "modifierGroups",
        "name",
        "price",
      ].sort(),
    );
    expect(latte).toMatchObject({
      name: catalog.items.latte.name,
      description: "Espresso dengan susu",
      price: 25000,
      imageUrl: null,
    });
  });

  it("includes active modifier groups and options in their sort order", async () => {
    const menu = await getPublicMenu(catalog.qr.token);
    const latte = mine(menu)[0]!.items.find(
      (i) => i.id === catalog.items.latte.id,
    )!;
    expect(latte.modifierGroups).toEqual([
      {
        id: catalog.groups.size.id,
        name: catalog.groups.size.name,
        minSelect: 1,
        maxSelect: 1,
        options: [
          {
            id: expect.any(String),
            name: "Regular",
            priceDelta: 0,
            isDefault: true,
          },
          {
            id: expect.any(String),
            name: "Large",
            priceDelta: 5000,
            isDefault: false,
          },
        ],
      },
      {
        id: catalog.groups.extras.id,
        name: catalog.groups.extras.name,
        minSelect: 0,
        maxSelect: 2,
        options: [
          {
            id: expect.any(String),
            name: "Extra shot",
            priceDelta: 5000,
            isDefault: false,
          },
        ],
      },
    ]);
    const americano = mine(menu)[0]!.items.find(
      (i) => i.id === catalog.items.americano.id,
    )!;
    expect(americano.modifierGroups).toEqual([]);
  });

  it("rejects an unknown, malformed or rotated QR token (FR-CO-07)", async () => {
    for (const token of [
      "AAAAAAAAAAAAAAAAAAAAAA",
      "not a token",
      "",
      catalog.rotatedQr.token,
    ]) {
      await expect(getPublicMenu(token)).rejects.toMatchObject({
        code: "QR_INVALID",
      });
    }
  });

  it("includes the current tax and service charge rates for the cart total", async () => {
    expect((await getPublicMenu(catalog.qr.token)).pricing).toEqual({
      taxRateBps: 0,
      taxInclusive: true,
      serviceChargeBps: 0,
    });
    await getDb()
      .insert(schema.settings)
      .values([
        { key: "tax_rate_bps", value: 1100 },
        { key: "service_charge_bps", value: 500 },
      ]);
    try {
      expect((await getPublicMenu(catalog.qr.token)).pricing).toEqual({
        taxRateBps: 1100,
        taxInclusive: true,
        serviceChargeBps: 500,
      });
    } finally {
      await getDb()
        .delete(schema.settings)
        .where(
          inArray(schema.settings.key, ["tax_rate_bps", "service_charge_bps"]),
        );
    }
  });

  it("is closed when the owner switches ordering off", async () => {
    await getDb()
      .insert(schema.settings)
      .values({ key: "ordering_enabled", value: false });
    await expect(getPublicMenu(catalog.qr.token)).rejects.toMatchObject({
      code: "ORDERING_CLOSED",
    });
    // An invalid QR is still reported as invalid, not as closed.
    await expect(getPublicMenu(catalog.rotatedQr.token)).rejects.toMatchObject({
      code: "QR_INVALID",
    });
  });

  it("reflects price and sold-out changes on the next request (no cache)", async () => {
    await getDb()
      .update(schema.menuItems)
      .set({ price: 26000, manualSoldOut: true })
      .where(eq(schema.menuItems.id, catalog.items.americano.id));
    const menu = await getPublicMenu(catalog.qr.token);
    const americano = mine(menu)[0]!.items.find(
      (i) => i.id === catalog.items.americano.id,
    )!;
    expect(americano).toMatchObject({ price: 26000, isAvailable: false });
    await getDb()
      .update(schema.menuItems)
      .set({ price: 18000, manualSoldOut: false })
      .where(eq(schema.menuItems.id, catalog.items.americano.id));
  });
});

describe("GET /api/public/menu", () => {
  const get = (query: string) =>
    menuGet(new NextRequest(`http://localhost:3000/api/public/menu${query}`));

  it("returns the menu for a valid token, never cached", async () => {
    const response = await get(`?qr=${catalog.qr.token}`);
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    const body = await response.json();
    expect(body.data.table).toBe(catalog.qr.label);
  });

  it("answers 400 without a token and 404 with an invalid one", async () => {
    expect((await get("")).status).toBe(400);
    const invalid = await get(`?qr=${catalog.rotatedQr.token}`);
    expect(invalid.status).toBe(404);
    expect((await invalid.json()).error).toMatchObject({
      code: "QR_INVALID",
      message: "Kode QR sudah tidak berlaku. Silakan scan kode di kasir.",
    });
  });

  it("answers 409 when ordering is off", async () => {
    await getDb()
      .insert(schema.settings)
      .values({ key: "ordering_enabled", value: false });
    const response = await get(`?qr=${catalog.qr.token}`);
    expect(response.status).toBe(409);
    expect((await response.json()).error.code).toBe("ORDERING_CLOSED");
  });
});
