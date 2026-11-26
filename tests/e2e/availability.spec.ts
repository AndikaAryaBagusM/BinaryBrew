import { expect, test } from "@playwright/test";

// P2-03 acceptance (FR-IV-04, FR-CO-06): an item whose stock cannot cover one
// serving is sold out on the menu; checkout refuses a quantity the stock
// cannot cover, keeps the line and lets the customer lower it. global-setup.ts
// leaves 50 g of Es krim vanila (Affogato needs 80 g) and 60 g of Cokelat
// bubuk (Es Cokelat needs 25 g, so two fit).

const token = process.env.E2E_QR_TOKEN!;

// Self-orders are rate limited per IP: this file orders from its own address.
test.use({ extraHTTPHeaders: { "x-forwarded-for": "198.51.100.23" } });

test("an item without stock for one serving is sold out", async ({ page }) => {
  await page.goto(`/o/${token}`);
  await expect(
    page.getByRole("button", { name: "Tambah Affogato" }),
  ).toBeDisabled();
  await expect(
    page.getByRole("button", { name: "Tambah Es Cokelat" }),
  ).toBeEnabled();
});

test("checkout refuses more than the stock covers and keeps the cart", async ({
  page,
}) => {
  await page.goto(`/o/${token}`);
  await page.getByRole("button", { name: "Tambah Es Cokelat" }).click();
  const sheet = page.getByRole("dialog", { name: "Es Cokelat" });
  await sheet.getByRole("button", { name: "Tambah jumlah" }).click();
  await sheet.getByRole("button", { name: "Tambah jumlah" }).click();
  await sheet.getByRole("button", { name: /^Tambah • / }).click();
  await expect(sheet).toBeHidden();
  await page.getByRole("link", { name: /Lihat keranjang/ }).click();
  await expect(page).toHaveURL(`/o/${token}/cart`);

  await page.getByRole("button", { name: "Bayar dengan QRIS" }).click();
  const refusal = page.getByRole("dialog", { name: "Stok tidak cukup" });
  await expect(refusal).toContainText("Es Cokelat");
  await refusal.getByRole("button", { name: "Ubah jumlah" }).click();
  await expect(refusal).toBeHidden();

  // The line is still there: lower it to 2 and pay.
  await page.getByRole("button", { name: "Kurangi jumlah" }).click();
  await page.getByRole("button", { name: "Bayar dengan QRIS" }).click();
  await expect(page).toHaveURL(/\/s\/[A-Za-z0-9_-]{22}$/);
});
