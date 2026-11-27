import { expect, test } from "@playwright/test";
import postgres from "postgres";
import { formatUnitCost, weightedAverageCost } from "@/lib/money";
import { toMilli } from "@/lib/quantity";
import { e2eTestDatabaseUrl } from "../integration/databases";

// P2-05 (S-09, FR-IV-05, BR-09): staff record a delivery on the Counter.
// The drawer previews the new weighted-average cost before saving, the save
// confirms the stored one, and a restock that covers a serving makes a
// stock-out item available again. global-setup.ts leaves 50 g of Es krim
// vanila; Affogato needs 80 g (counter-pos.spec.ts runs first and checks the
// lock).

const deviceToken = process.env.E2E_DEVICE_TOKEN!;
const STAFF_PIN = "1470"; // global-setup.ts
const sql = postgres(e2eTestDatabaseUrl(process.env.TEST_DATABASE_URL!), {
  max: 1,
  onnotice: () => {},
});
test.afterAll(() => sql.end());

test.beforeEach(async ({ context, baseURL, page }) => {
  await context.addCookies([
    { name: "bb_device", value: deviceToken, url: baseURL! },
  ]);
  await page.goto("/counter/login");
  await page.getByRole("button", { name: "Rina" }).click();
  await page.keyboard.type(STAFF_PIN);
  await page.getByRole("button", { name: "Masuk" }).click();
  await expect(page).toHaveURL("/counter");
  await expect(page.getByRole("heading", { name: "Antrean" })).toBeVisible();
});

test("a delivery previews and saves the new average cost and unlocks Affogato", async ({
  page,
}) => {
  const [before] = await sql<{ stock_qty: string; avg_cost: string }[]>`
    select stock_qty, avg_cost from ingredients where name = 'Es krim vanila'`;
  const expected = weightedAverageCost(
    { stockMilli: toMilli(before!.stock_qty), avgCost: before!.avg_cost },
    { quantityMilli: 100_000, totalCost: 50_000 },
  );
  const affogato = page
    .getByRole("main")
    .getByRole("button", { name: /Affogato/ });
  await expect(affogato).toBeDisabled();

  await page.getByRole("button", { name: "Restock" }).click();
  const panel = page.getByRole("dialog", { name: "Catat restock" });
  await panel.getByLabel("Bahan").selectOption({ label: "Es krim vanila (g)" });
  await panel.getByLabel("Jumlah diterima").fill("100");
  await panel.getByLabel("Total harga dibayar").fill("50.000");
  await panel
    .getByLabel("Pemasok (opsional)")
    .selectOption({ label: "Toko Susu Sejahtera" });

  // Before saving: the new average and the stock it leaves.
  const preview = panel.getByRole("status").filter({
    hasText: "Biaya rata-rata baru",
  });
  await expect(preview).toContainText(`${formatUnitCost(expected)} / g`);
  await expect(preview).toContainText("stok jadi 150 g");

  await panel.getByRole("button", { name: "Simpan restock" }).click();
  await expect(
    panel.getByText(
      `Restock Es krim vanila tersimpan. Biaya rata-rata sekarang ${formatUnitCost(expected)} / g.`,
    ),
  ).toBeVisible();

  const [after] = await sql<
    { stock_qty: string; avg_cost: string; supplier: string; by: string }[]
  >`
    select i.stock_qty, i.avg_cost, s.name as supplier, u.name as by
    from restocks r
    join ingredients i on i.id = r.ingredient_id
    join suppliers s on s.id = r.supplier_id
    join users u on u.id = r.created_by
    where i.name = 'Es krim vanila'
    order by r.created_at desc limit 1`;
  expect(after).toEqual({
    stock_qty: "150.000",
    avg_cost: expected,
    supplier: "Toko Susu Sejahtera",
    by: "Rina",
  });

  // 150 g now covers an Affogato (80 g).
  await panel.getByRole("button", { name: "Tutup" }).click();
  await expect(affogato).toBeEnabled();
});
