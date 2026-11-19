import { expect, type Page, test } from "@playwright/test";
import postgres from "postgres";
import { formatRupiah } from "@/lib/money";
import type { PublicMenu } from "@/modules/menu/service";
import { type CartLine, priceOrder } from "@/modules/orders/pricing";
import { e2eTestDatabaseUrl } from "../integration/databases";

// P1-16 acceptance (C-04, FR-CO-05, FR-RC-02..04): a cart with Kopi Susu
// shows Croissant from the rule (global-setup.ts copies it from the seeded
// Apriori run); accept and dismiss are stored and linked to the order; no
// suggestion for an item already in the cart or unavailable.

const token = process.env.E2E_QR_TOKEN!;
const sql = postgres(e2eTestDatabaseUrl(process.env.TEST_DATABASE_URL!), {
  max: 1,
  onnotice: () => {},
});
test.afterAll(() => sql.end());

// Self-orders are rate limited per IP and earlier specs use that up: this
// file orders from its own address (the limiter keys on x-forwarded-for).
test.use({ extraHTTPHeaders: { "x-forwarded-for": "198.51.100.16" } });

let menu: PublicMenu;
test.beforeAll(async ({ request }) => {
  const response = await request.get(`/api/public/menu?qr=${token}`);
  expect(response.ok()).toBe(true);
  menu = (await response.json()).data;
});

const items = () => menu.categories.flatMap((c) => c.items);
const item = (name: string) => items().find((i) => i.name === name)!;
// One of the item with its default options.
const line = (name: string): CartLine => ({
  menuItemId: item(name).id,
  quantity: 1,
  modifierOptionIds: item(name).modifierGroups.flatMap((g) =>
    g.options.filter((o) => o.isDefault).map((o) => o.id),
  ),
});
const totalOf = (...names: string[]) =>
  formatRupiah(priceOrder(names.map(line), items(), menu.pricing).total);

// Kopi Susu has options: C-02 opens with the defaults selected.
async function cartWith(page: Page, ...names: string[]) {
  await page.goto(`/o/${token}`);
  for (const name of names) {
    await page.getByRole("button", { name: `Tambah ${name}` }).click();
    const sheet = page.getByRole("dialog", { name });
    if (item(name).modifierGroups.length > 0) {
      await sheet.getByRole("button", { name: /^Tambah • / }).click();
      await expect(sheet).toBeHidden();
    }
  }
  await page.getByRole("link", { name: /Lihat keranjang/ }).click();
  await expect(page).toHaveURL(`/o/${token}/cart`);
}

// The order's events as [action, item name], oldest first.
async function eventsOf(page: Page) {
  const publicToken = page.url().split("/s/")[1]!;
  const rows = await sql<{ action: string; name: string }[]>`
    select e.action, m.name
    from recommendation_events e
    join orders o on o.id = e.order_id
    join menu_items m on m.id = e.item_id
    where o.public_token = ${publicToken}
    order by e.id`;
  return rows.map((row) => [row.action, row.name]);
}

const toPayment = (page: Page) =>
  expect(page).toHaveURL(/\/s\/[A-Za-z0-9_-]{22}$/);

test("Kopi Susu suggests Croissant; Tambah adds it and is stored", async ({
  page,
}) => {
  await cartWith(page, "Kopi Susu Gula Aren");
  await page.getByRole("button", { name: "Bayar dengan QRIS" }).click();

  const sheet = page.getByRole("dialog", { name: "Sering dipesan bersama" });
  await expect(sheet).toBeVisible();
  await expect(sheet).toContainText(
    "Pelanggan lain sering menambahkan ini dengan pesanan seperti punyamu.",
  );
  await expect(sheet.getByRole("listitem")).toHaveCount(1);
  await expect(sheet.getByRole("listitem")).toContainText("Croissant");
  // No confidence percentages for customers (Design §7 C-04).
  await expect(sheet).not.toContainText("%");
  await expect(sheet.getByTestId("reco-total")).toHaveText(
    totalOf("Kopi Susu Gula Aren"),
  );

  await sheet.getByRole("button", { name: "Tambah Croissant" }).click();
  await expect(sheet.getByText("Ditambahkan")).toBeVisible();
  const total = totalOf("Kopi Susu Gula Aren", "Croissant");
  await expect(sheet.getByTestId("reco-total")).toHaveText(total);
  await sheet.getByRole("button", { name: `Lanjut bayar • ${total}` }).click();

  await toPayment(page);
  await expect(page.getByText(total).first()).toBeVisible();
  expect(await eventsOf(page)).toEqual([
    ["shown", "Croissant"],
    ["accepted", "Croissant"],
  ]);
});

test("closing the sheet goes on to payment and stores the dismissal", async ({
  page,
}) => {
  await cartWith(page, "Kopi Susu Gula Aren");
  await page.getByRole("button", { name: "Bayar dengan QRIS" }).click();
  const sheet = page.getByRole("dialog", { name: "Sering dipesan bersama" });
  await sheet.getByRole("button", { name: "Tutup" }).click();

  await toPayment(page);
  expect(await eventsOf(page)).toEqual([
    ["shown", "Croissant"],
    ["rejected", "Croissant"],
  ]);
});

test("no sheet when the suggestion is already in the cart", async ({
  page,
}) => {
  await cartWith(page, "Kopi Susu Gula Aren", "Croissant");
  await page.getByRole("button", { name: "Bayar dengan QRIS" }).click();
  await toPayment(page);
  expect(await eventsOf(page)).toEqual([]);
});

test("no sheet when the suggestion is sold out", async ({ page }) => {
  await cartWith(page, "Kopi Susu Gula Aren");
  await sql`update menu_items set manual_sold_out = true where name = 'Croissant'`;
  try {
    await page.getByRole("button", { name: "Bayar dengan QRIS" }).click();
    await toPayment(page);
    expect(await eventsOf(page)).toEqual([]);
  } finally {
    await sql`update menu_items set manual_sold_out = false where name = 'Croissant'`;
  }
});
