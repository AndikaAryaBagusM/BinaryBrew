import { expect, type Page, test } from "@playwright/test";
import postgres from "postgres";
import { e2eTestDatabaseUrl } from "../integration/databases";

// P2-01 acceptance (O-05, FR-IV-01): the owner sees the seeded ingredients
// with their status, adds one with opening stock (the ledger gets its
// opening row), raises its minimum so the chip turns "Menipis", and adds a
// supplier.

const OWNER_EMAIL = "pemilik@e2e.test"; // global-setup.ts
const sql = postgres(e2eTestDatabaseUrl(process.env.TEST_DATABASE_URL!), {
  max: 1,
  onnotice: () => {},
});
test.afterAll(() => sql.end());

async function openIngredients(page: Page) {
  await page.goto("/owner/login");
  await page.getByLabel("Email").fill(OWNER_EMAIL);
  await page.getByLabel("Kata sandi").fill(process.env.E2E_OWNER_PASSWORD!);
  await page.getByRole("button", { name: "Masuk" }).click();
  await expect(
    page.getByRole("heading", { name: "Menu", level: 1 }),
  ).toBeVisible();
  await page.getByRole("link", { name: "Bahan & stok" }).first().click();
  await expect(
    page.getByRole("heading", { name: "Bahan & stok", level: 1 }),
  ).toBeVisible();
}

const row = (page: Page, name: string) =>
  page.getByRole("row").filter({
    has: page.getByRole("rowheader", { name, exact: true }),
  });

test("lists the seeded ingredients with stock, cost and status", async ({
  page,
}) => {
  await openIngredients(page);
  // Paid orders of earlier specs deduct stock (P2-04), so this looks at
  // ingredients no spec sells (global-setup.ts): Matcha bubuk as seeded
  // (500 g for Rp 450.000), Es krim vanila left at 50 of 500 g.
  const matcha = row(page, "Matcha bubuk");
  await expect(matcha).toContainText("500");
  await expect(matcha).toContainText("Rp 900,00");
  await expect(matcha.getByText("Aman")).toBeVisible();
  await expect(row(page, "Es krim vanila").getByText("Menipis")).toBeVisible();
  await expect(
    page.getByRole("list", { name: "Ringkasan stok" }).getByText(/menipis/),
  ).toBeVisible();
});

test("adds an ingredient with opening stock, then raises its minimum", async ({
  page,
}) => {
  const name = `Susu almond ${Date.now()}`;
  await openIngredients(page);

  await page.getByRole("button", { name: "Tambah bahan" }).click();
  const panel = page.getByRole("dialog", { name: "Tambah bahan" });
  await panel.getByLabel("Nama bahan").fill(name);
  await panel.getByLabel("Satuan").selectOption("ml");
  await panel.getByLabel("Stok minimum").fill("500");
  // Half an opening stock is refused before anything is sent.
  await panel.getByLabel("Jumlah stok awal").fill("1.200");
  await panel.getByRole("button", { name: "Simpan" }).click();
  await expect(
    panel.getByText("Isi jumlah dan total harga, atau kosongkan keduanya"),
  ).toBeVisible();
  await panel.getByLabel("Total harga stok awal").fill("54.000");
  await expect(panel.getByText("Biaya rata-rata Rp 45,00 / ml")).toBeVisible();
  await panel.getByRole("button", { name: "Simpan" }).click();
  await expect(panel).toBeHidden();

  const added = row(page, name);
  await expect(added).toContainText("1.200");
  await expect(added).toContainText("Rp 45,00");
  await expect(added.getByText("Aman")).toBeVisible();

  const [ledger] = await sql<
    { stock: string; movements: string; type: string }[]
  >`
    select i.stock_qty as stock, sum(m.qty_delta)::text as movements,
      min(m.type::text) as type
    from ingredients i join stock_movements m on m.ingredient_id = i.id
    where i.name = ${name}
    group by i.stock_qty`;
  expect(ledger).toEqual({
    stock: "1200.000",
    movements: "1200.000",
    type: "opening",
  });

  await page.getByRole("button", { name: `Ubah ${name}` }).click();
  const edit = page.getByRole("dialog", { name: "Ubah bahan" });
  // The opening movement locks the unit.
  await expect(edit.getByLabel("Satuan")).toBeDisabled();
  await expect(edit.getByText(/Stok sekarang 1\.200 ml/)).toBeVisible();
  await edit.getByLabel("Stok minimum").fill("2.000");
  await edit.getByRole("button", { name: "Simpan" }).click();
  await expect(edit).toBeHidden();
  await expect(added.getByText("Menipis")).toBeVisible();
  await expect(added).toContainText("2.000");
});

test("adds a supplier and switches it off", async ({ page }) => {
  const name = `Toko Bahan ${Date.now()}`;
  await openIngredients(page);
  await page.getByRole("button", { name: "Pemasok" }).click();
  const panel = page.getByRole("dialog", { name: "Pemasok" });
  await panel.getByLabel("Pemasok baru").fill(name);
  await panel.getByRole("button", { name: "Tambah pemasok" }).click();

  const active = panel.getByRole("switch", { name: `Pemasok ${name} aktif` });
  await expect(active).toBeChecked();
  await active.click();
  await expect(active).not.toBeChecked();
  const [supplier] = await sql<{ is_active: boolean }[]>`
    select is_active from suppliers where name = ${name}`;
  expect(supplier).toEqual({ is_active: false });
});
