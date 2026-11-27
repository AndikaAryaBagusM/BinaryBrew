import { readFile } from "node:fs/promises";
import { expect, type Page, test } from "@playwright/test";
import postgres from "postgres";
import { formatPermille, formatRupiah, formatSignedRupiah } from "@/lib/money";
import { itemCost, type ItemCost } from "@/modules/menu/cost";
import { hppRows } from "@/modules/reports/hpp";
import { e2eTestDatabaseUrl } from "../integration/databases";

// P2-06 (O-09, O-03; FR-HP-01, 02, 04): the owner sees each item's HPP and
// margin from the current recipes and average costs, the month's sales at
// the HPP stored when they were paid, downloads the same as CSV, and finds
// the HPP on O-03 too. The hand-calculated example is the integration test;
// here the figures come from the e2e database through the same pure code.

const OWNER_EMAIL = "pemilik@e2e.test"; // global-setup.ts
const sql = postgres(e2eTestDatabaseUrl(process.env.TEST_DATABASE_URL!), {
  max: 1,
  onnotice: () => {},
});
test.afterAll(() => sql.end());

async function login(page: Page) {
  await page.goto("/owner/login");
  await page.getByLabel("Email").fill(OWNER_EMAIL);
  await page.getByLabel("Kata sandi").fill(process.env.E2E_OWNER_PASSWORD!);
  await page.getByRole("button", { name: "Masuk" }).click();
  await expect(
    page.getByRole("heading", { name: "Menu", level: 1 }),
  ).toBeVisible();
}

// The current figures, as the server computes them.
async function expectedRows() {
  const items = await sql<{ id: string; name: string; price: number }[]>`
    select id, name, price from menu_items where is_active order by name`;
  const recipes = await sql<
    { menu_item_id: string; ingredient_id: string; qty: string }[]
  >`select menu_item_id, ingredient_id, qty::text as qty from recipe_items`;
  const ingredients = await sql<{ id: string; avg_cost: string }[]>`
    select id, avg_cost::text as avg_cost from ingredients`;
  const avgCosts = new Map(ingredients.map((row) => [row.id, row.avg_cost]));
  const costs = new Map<string, ItemCost>(
    items.map((item) => [
      item.id,
      itemCost(
        recipes
          .filter((line) => line.menu_item_id === item.id)
          .map((line) => ({ ingredientId: line.ingredient_id, qty: line.qty })),
        avgCosts,
      ),
    ]),
  );
  const [setting] = await sql<{ value: number }[]>`
    select value from settings where key = 'low_margin_threshold_pct'`;
  return hppRows(items, costs, setting?.value ?? 30);
}

const cellText = (value: number | null, format: (n: number) => string) =>
  value === null ? "—" : format(value);

test("the report shows each item's HPP and margin, and downloads as CSV", async ({
  page,
}) => {
  await login(page);
  await page.getByRole("link", { name: "HPP & margin" }).first().click();
  await expect(
    page.getByRole("heading", { name: "HPP & margin", level: 1 }),
  ).toBeVisible();

  const rows = await expectedRows();
  const table = page.getByRole("table", { name: "HPP dan margin saat ini" });
  // Lowest margin first, as the server sorts.
  await expect(table.getByRole("rowheader")).toHaveText(
    rows.map((row) => row.name),
  );
  for (const row of rows) {
    const cells = table
      .getByRole("row")
      .filter({
        has: page.getByRole("rowheader", { name: row.name, exact: true }),
      })
      .getByRole("cell");
    await expect(cells.nth(0)).toHaveText(formatRupiah(row.price));
    await expect(cells.nth(1)).toHaveText(cellText(row.hpp, formatRupiah));
    await expect(cells.nth(2)).toHaveText(
      cellText(row.margin, formatSignedRupiah),
    );
    await expect(cells.nth(3)).toHaveText(
      cellText(row.marginPermille, formatPermille),
    );
    if (row.lowMargin)
      await expect(cells.nth(4)).toContainText("Margin rendah");
    if (row.status === "incomplete")
      await expect(cells.nth(4)).toContainText("Resep belum lengkap");
  }

  // Sales of the month: the spec run's paid orders, at their stored HPP.
  const month = await page.getByLabel("Periode", { exact: true }).inputValue();
  const [sold] = await sql<{ quantity: number; revenue: number }[]>`
    select coalesce(sum(oi.quantity), 0)::int as quantity,
           coalesce(sum(oi.line_total), 0)::int as revenue
    from order_items oi join orders o on o.id = oi.order_id
    where o.paid_at is not null and o.status <> 'voided'
      and to_char(o.business_date, 'YYYY-MM') = ${month}`;
  const sales = page.getByRole("table", { name: /^Penjualan per periode/ });
  if (sold!.quantity > 0) {
    const total = sales
      .getByRole("row")
      .filter({ has: page.getByRole("rowheader", { name: /^Total/ }) })
      .getByRole("cell");
    await expect(total.nth(0)).toHaveText(String(sold!.quantity));
    await expect(total.nth(1)).toHaveText(formatRupiah(sold!.revenue));
  } else {
    await expect(sales).toHaveCount(0);
  }

  // The CSV holds the same table.
  const downloadPromise = page.waitForEvent("download");
  await page.getByRole("link", { name: "Unduh CSV" }).click();
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toBe(`hpp-margin-${month}.csv`);
  const csv = (await readFile((await download.path())!, "utf8")).replace(
    /^﻿/,
    "",
  );
  const lines = csv.split("\r\n");
  expect(lines[0]).toBe("Menu,Harga,HPP,Margin,Margin %,Catatan");
  expect(
    lines.slice(1, rows.length + 1).map((line) => line.split(",")[0]),
  ).toEqual(rows.map((row) => row.name));
});

test("O-03 lists each item's HPP", async ({ page }) => {
  await login(page);
  const rows = await expectedRows();
  const table = page.getByRole("table", { name: "Menu", exact: true });
  for (const row of rows) {
    // Columns: Kategori, Harga, HPP, …
    await expect(
      table
        .getByRole("row")
        .filter({
          has: page.getByRole("rowheader", { name: row.name, exact: true }),
        })
        .getByRole("cell")
        .nth(2),
    ).toContainText(row.hpp === null ? "—" : formatRupiah(row.hpp));
  }
});

test("on a phone, the tabs are the nav sections", async ({ page }) => {
  await page.setViewportSize({ width: 360, height: 780 });
  await login(page);
  const tabs = page.getByRole("navigation", { name: "Menu pemilik" });
  await expect(tabs.getByRole("link")).toHaveText([/Dasbor/, "Laporan"]);
  await expect(tabs.getByRole("button")).toHaveText([
    "Menu",
    "Stok",
    "Lainnya",
  ]);

  await tabs.getByRole("button", { name: "Stok" }).click();
  const sheet = page.getByRole("dialog", { name: "Stok" });
  await sheet.getByRole("link", { name: "Restock" }).click();
  await expect(
    page.getByRole("heading", { name: "Restock", level: 1 }),
  ).toBeVisible();
  await expect(sheet).toBeHidden();
  await expect(tabs.getByRole("button", { name: "Stok" })).toHaveAttribute(
    "aria-current",
    "page",
  );

  await tabs.getByRole("link", { name: "Laporan" }).click();
  await expect(
    page.getByRole("heading", { name: "HPP & margin", level: 1 }),
  ).toBeVisible();
});
