import { expect, type Page, test } from "@playwright/test";
import { formatRupiah } from "@/lib/money";
import type { PublicMenu } from "@/modules/menu/service";
import { type CartLine, priceOrder } from "@/modules/orders/pricing";

// P1-05 acceptance (C-02, C-03): add an item with modifiers, change the
// quantity, remove a line; the cart total equals the pricing service's total.
// The e2e database is seeded with 11 % inclusive tax and a 5 % service charge,
// plus a required group without a default on Roti Bakar (global-setup.ts).

const token = process.env.E2E_QR_TOKEN!;
let menu: PublicMenu;

test.beforeAll(async ({ request }) => {
  const response = await request.get(`/api/public/menu?qr=${token}`);
  expect(response.ok()).toBe(true);
  menu = (await response.json()).data;
});

const items = () => menu.categories.flatMap((category) => category.items);
const item = (name: string) => items().find((i) => i.name === name)!;
const option = (itemName: string, groupName: string, optionName: string) =>
  item(itemName)
    .modifierGroups.find((g) => g.name === groupName)!
    .options.find((o) => o.name === optionName)!.id;
const totalOf = (lines: CartLine[]) =>
  formatRupiah(priceOrder(lines, items(), menu.pricing).total);

async function openSheet(page: Page, name: string) {
  await page.getByRole("button", { name: `Tambah ${name}` }).click();
  const sheet = page.getByRole("dialog", { name });
  await expect(sheet).toBeVisible();
  return sheet;
}

test("add with modifiers, change quantity, remove; total matches pricing", async ({
  page,
}) => {
  await page.goto(`/o/${token}`);

  const sheet = await openSheet(page, "Kopi Susu Gula Aren");
  // Defaults are pre-selected (Design §7 C-02).
  await expect(sheet.getByRole("radio", { name: /^Regular/ })).toBeChecked();
  await expect(
    sheet.getByRole("radio", { name: /^Tanpa gula/ }),
  ).not.toBeChecked();
  await sheet.getByRole("radio", { name: /^Large/ }).check();
  await sheet.getByRole("checkbox", { name: /^Extra shot/ }).check();
  await sheet.getByRole("button", { name: "Tambah jumlah" }).click();
  // Live price: (22.000 + 5.000 + 5.000) × 2
  const add = sheet.getByRole("button", { name: /^Tambah • / });
  await expect(add).toHaveText(`Tambah • ${formatRupiah(64_000)}`);
  await add.click();
  await expect(sheet).toBeHidden();

  // No modifier groups: straight into the cart (Flow §3).
  await page.getByRole("button", { name: "Tambah Croissant" }).click();

  const kopiLine: CartLine = {
    menuItemId: item("Kopi Susu Gula Aren").id,
    quantity: 2,
    modifierOptionIds: [
      option("Kopi Susu Gula Aren", "Ukuran", "Large"),
      option("Kopi Susu Gula Aren", "Gula", "Normal"),
      option("Kopi Susu Gula Aren", "Es", "Normal"),
      option("Kopi Susu Gula Aren", "Tambahan", "Extra shot"),
    ],
  };
  const croissant = (quantity: number): CartLine => ({
    menuItemId: item("Croissant").id,
    quantity,
    modifierOptionIds: [],
  });

  const bar = page.getByRole("link", { name: /Lihat keranjang/ });
  await expect(bar).toContainText("3 item");
  await expect(bar).toContainText(totalOf([kopiLine, croissant(1)]));
  await bar.click();
  await expect(page).toHaveURL(`/o/${token}/cart`);

  const total = page.getByTestId("cart-total");
  await expect(total).toHaveText(totalOf([kopiLine, croissant(1)]));
  await expect(page.getByText("Harga sudah termasuk pajak")).toBeVisible();
  await expect(
    page.getByRole("listitem").filter({ hasText: "Kopi Susu Gula Aren" }),
  ).toContainText("Large");

  const croissantLine = page
    .getByRole("listitem")
    .filter({ hasText: "Croissant" });
  await croissantLine.getByRole("button", { name: "Tambah jumlah" }).click();
  await croissantLine.getByRole("button", { name: "Tambah jumlah" }).click();
  await expect(total).toHaveText(totalOf([kopiLine, croissant(3)]));

  await page.getByRole("button", { name: "Hapus Kopi Susu Gula Aren" }).click();
  await expect(total).toHaveText(totalOf([croissant(3)]));

  // The cart is kept for the session (sessionStorage).
  await page.reload();
  await expect(total).toHaveText(totalOf([croissant(3)]));
});

test("a required group without a default blocks Add until chosen", async ({
  page,
}) => {
  await page.goto(`/o/${token}`);
  const sheet = await openSheet(page, "Roti Bakar");
  const add = sheet.getByRole("button", { name: /^Tambah • / });

  await add.click();
  await expect(sheet).toBeVisible();
  const choices = sheet.getByRole("group", { name: /Pilihan selai/ });
  await expect(choices.getByRole("radio").first()).toHaveAttribute(
    "aria-invalid",
    "true",
  );

  await choices.getByRole("radio", { name: /^Cokelat/ }).check();
  await add.click();
  await expect(sheet).toBeHidden();
  await expect(
    page.getByRole("link", { name: /Lihat keranjang/ }),
  ).toContainText("1 item");
});

test("an empty cart offers the way back to the menu", async ({ page }) => {
  await page.goto(`/o/${token}/cart`);
  await expect(page.getByText("Keranjang masih kosong")).toBeVisible();
  await page.getByRole("link", { name: "Kembali ke menu" }).click();
  await expect(page).toHaveURL(`/o/${token}`);
});
