import { expect, type Page, test } from "@playwright/test";
import postgres from "postgres";
import { formatRupiah, formatUnitCost, weightedAverageCost } from "@/lib/money";
import { toMilli } from "@/lib/quantity";
import { e2eTestDatabaseUrl } from "../integration/databases";

// P2-05 acceptance (O-07, FR-IV-05, BR-09): the owner enters two purchases;
// each row shows its new average cost before saving (the second row of the
// same ingredient starts from the first), a future date is refused, and the
// save writes the averages the rows showed.

const OWNER_EMAIL = "pemilik@e2e.test"; // global-setup.ts
const sql = postgres(e2eTestDatabaseUrl(process.env.TEST_DATABASE_URL!), {
  max: 1,
  onnotice: () => {},
});
test.afterAll(() => sql.end());

async function openRestock(page: Page) {
  await page.goto("/owner/login");
  await page.getByLabel("Email").fill(OWNER_EMAIL);
  await page.getByLabel("Kata sandi").fill(process.env.E2E_OWNER_PASSWORD!);
  await page.getByRole("button", { name: "Masuk" }).click();
  await expect(
    page.getByRole("heading", { name: "Menu", level: 1 }),
  ).toBeVisible();
  await page.getByRole("link", { name: "Restock" }).first().click();
  await expect(
    page.getByRole("heading", { name: "Restock", level: 1 }),
  ).toBeVisible();
}

async function fillRow(
  page: Page,
  n: number,
  row: { ingredient: string; qty: string; total: string; supplier?: string },
) {
  const field = (name: string) => page.getByLabel(`${name}, baris ${n}`);
  await field("Bahan").selectOption({ label: row.ingredient });
  await field("Jumlah").fill(row.qty);
  await field("Total harga").fill(row.total);
  if (row.supplier)
    await field("Pemasok").selectOption({ label: row.supplier });
}

test("two purchases preview their new average cost, then save it", async ({
  page,
}) => {
  // Matcha bubuk is as seeded (global-setup.ts): 500 g at Rp 900.
  const [matcha] = await sql<{ stock_qty: string; avg_cost: string }[]>`
    select stock_qty, avg_cost from ingredients where name = 'Matcha bubuk'`;
  const first = weightedAverageCost(
    { stockMilli: toMilli(matcha!.stock_qty), avgCost: matcha!.avg_cost },
    { quantityMilli: 500_000, totalCost: 500_000 },
  );
  const second = weightedAverageCost(
    { stockMilli: toMilli(matcha!.stock_qty) + 500_000, avgCost: first },
    { quantityMilli: 250_000, totalCost: 200_000 },
  );

  await openRestock(page);
  await fillRow(page, 1, {
    ingredient: "Matcha bubuk (g)",
    qty: "500",
    total: "500.000",
    supplier: "Roastery Kawan",
  });
  await page.getByRole("button", { name: "Tambah baris" }).click();
  await fillRow(page, 2, {
    ingredient: "Matcha bubuk (g)",
    qty: "250",
    total: "200.000",
  });

  const rows = page.getByRole("table", { name: "Restock" }).getByRole("row");
  // Rp 1.000 / g lifts the Rp 900 average; Rp 800 / g then lowers it.
  await expect(rows.nth(1)).toContainText(`${formatUnitCost(first)} / g`);
  await expect(rows.nth(1)).toContainText(
    `naik dari ${formatUnitCost(matcha!.avg_cost)}`,
  );
  await expect(rows.nth(2)).toContainText(`${formatUnitCost(second)} / g`);
  await expect(rows.nth(2)).toContainText(
    `turun dari ${formatUnitCost(first)}`,
  );
  await expect(page.getByText(formatRupiah(700_000))).toBeVisible();

  // A date after today is refused before anything is sent.
  await page.getByLabel("Tanggal, baris 2").fill("2999-01-01");
  await page.getByRole("button", { name: "Simpan 2 restock" }).click();
  await expect(page.getByRole("main").getByRole("alert")).toContainText(
    "Baris 2: Tanggal tidak boleh setelah hari ini",
  );
  await page.getByRole("button", { name: "Hapus baris 2" }).click();
  await page.getByRole("button", { name: "Tambah baris" }).click();
  await fillRow(page, 2, {
    ingredient: "Matcha bubuk (g)",
    qty: "250",
    total: "200.000",
  });

  await page.getByRole("button", { name: "Simpan 2 restock" }).click();
  await expect(
    page.getByText(
      "2 restock tersimpan. Stok dan biaya rata-rata sudah diperbarui.",
    ),
  ).toBeVisible();
  // The form starts again with one empty row.
  await expect(
    page.getByRole("button", { name: "Simpan 1 restock" }),
  ).toBeVisible();

  const [after] = await sql<{ stock_qty: string; avg_cost: string }[]>`
    select stock_qty, avg_cost from ingredients where name = 'Matcha bubuk'`;
  expect(after).toEqual({ stock_qty: "1250.000", avg_cost: second });
  const saved = await sql<{ quantity: string; supplier: string | null }[]>`
    select r.quantity, s.name as supplier
    from restocks r
    join ingredients i on i.id = r.ingredient_id
    left join suppliers s on s.id = r.supplier_id
    where i.name = 'Matcha bubuk'
    order by r.quantity desc`;
  expect(saved).toEqual([
    { quantity: "500.000", supplier: "Roastery Kawan" },
    { quantity: "250.000", supplier: null },
  ]);
});
