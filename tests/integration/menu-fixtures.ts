import { getDb } from "@/db/client";
import * as schema from "@/db/schema";
import { newQrToken } from "@/lib/ids";
import { unique } from "./auth-fixtures";

// A small catalog with unique names, because integration files share one
// database: tests assert on their own categories only.
export async function createCatalog() {
  const db = getDb();
  const [drinks, food, hidden, empty] = await db
    .insert(schema.categories)
    .values([
      { name: unique("Minuman"), sortOrder: 1 },
      { name: unique("Makanan"), sortOrder: 2 },
      { name: unique("Arsip"), sortOrder: 3, isActive: false },
      { name: unique("Kosong"), sortOrder: 4 },
    ])
    .returning();

  const [size, extras] = await db
    .insert(schema.modifierGroups)
    .values([
      { name: unique("Ukuran"), minSelect: 1, maxSelect: 1, sortOrder: 1 },
      { name: unique("Tambahan"), minSelect: 0, maxSelect: 2, sortOrder: 2 },
    ])
    .returning();
  const [inactiveGroup] = await db
    .insert(schema.modifierGroups)
    .values({ name: unique("Lama"), isActive: false })
    .returning();

  const options = await db
    .insert(schema.modifierOptions)
    .values([
      { groupId: size!.id, name: "Large", priceDelta: 5000, sortOrder: 2 },
      { groupId: size!.id, name: "Regular", isDefault: true, sortOrder: 1 },
      { groupId: extras!.id, name: "Extra shot", priceDelta: 5000 },
      { groupId: extras!.id, name: "Retired", isActive: false },
      { groupId: inactiveGroup!.id, name: "Old option" },
    ])
    .returning();

  const [latte, americano, soldOut, inactive, croissant, archived] = await db
    .insert(schema.menuItems)
    .values([
      {
        categoryId: drinks!.id,
        name: unique("Latte"),
        description: "Espresso dengan susu",
        price: 25000,
        sortOrder: 2,
      },
      {
        categoryId: drinks!.id,
        name: unique("Americano"),
        price: 18000,
        sortOrder: 1,
      },
      {
        categoryId: drinks!.id,
        name: unique("Es Cokelat"),
        price: 22000,
        sortOrder: 3,
        manualSoldOut: true,
      },
      {
        categoryId: drinks!.id,
        name: unique("Teh Lama"),
        price: 10000,
        isActive: false,
      },
      { categoryId: food!.id, name: unique("Croissant"), price: 18000 },
      { categoryId: hidden!.id, name: unique("Kue Arsip"), price: 9000 },
    ])
    .returning();

  await db.insert(schema.menuItemModifierGroups).values([
    { menuItemId: latte!.id, groupId: extras!.id, sortOrder: 2 },
    { menuItemId: latte!.id, groupId: size!.id, sortOrder: 1 },
    { menuItemId: latte!.id, groupId: inactiveGroup!.id, sortOrder: 3 },
  ]);

  const [qr, rotated] = await db
    .insert(schema.qrTokens)
    .values([
      { label: unique("Meja"), token: newQrToken() },
      { label: unique("Meja lama"), token: newQrToken(), isActive: false },
    ])
    .returning();

  return {
    categories: {
      drinks: drinks!,
      food: food!,
      hidden: hidden!,
      empty: empty!,
    },
    groups: { size: size!, extras: extras! },
    options,
    items: {
      latte: latte!,
      americano: americano!,
      soldOut: soldOut!,
      inactive: inactive!,
      croissant: croissant!,
      archived: archived!,
    },
    qr: qr!,
    rotatedQr: rotated!,
  };
}
