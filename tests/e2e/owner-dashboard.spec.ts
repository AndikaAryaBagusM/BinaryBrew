import { randomBytes } from "node:crypto";
import { expect, test } from "@playwright/test";
import postgres from "postgres";
import { e2eTestDatabaseUrl } from "../integration/databases";

// P2-07 acceptance (FR-IV-06, O-02): with Dasbor open, a paid sale that
// takes an ingredient to its minimum shows up in "Stok menipis" and in the
// nav badge without a reload (stock.low over the owner stream).

const OWNER_EMAIL = "pemilik@e2e.test"; // global-setup.ts
const INGREDIENT = "Kentang beku"; // 150 g per Kentang Goreng, minimum 1.000 g
const ITEM = "Kentang Goreng"; // no options
const sql = postgres(e2eTestDatabaseUrl(process.env.TEST_DATABASE_URL!), {
  max: 1,
  onnotice: () => {},
});
test.afterAll(() => sql.end());

const lowCount = async () => {
  const [row] = await sql<{ n: number }[]>`
    select count(*)::int as n from ingredients
    where is_active and stock_qty <= min_stock_qty`;
  return row!.n;
};

test("a sale that reaches the minimum appears on Dasbor at once", async ({
  page,
  baseURL,
}) => {
  // One serving above the minimum, written to the ledger (Schema §4 I7).
  await sql.begin(async (tx) => {
    const [row] = await tx<{ id: string; delta: string }[]>`
      select id, (min_stock_qty + 150 - stock_qty)::text as delta
      from ingredients where name = ${INGREDIENT} for update`;
    await tx`insert into stock_movements (ingredient_id, type, qty_delta, note)
      values (${row!.id}, 'count_adjustment', ${row!.delta}, 'e2e: one serving above the minimum')`;
    await tx`update ingredients set stock_qty = min_stock_qty + 150
      where id = ${row!.id}`;
  });
  const before = await lowCount();

  await page.goto("/owner/login");
  await page.getByLabel("Email").fill(OWNER_EMAIL);
  await page.getByLabel("Kata sandi").fill(process.env.E2E_OWNER_PASSWORD!);
  await page.getByRole("button", { name: "Masuk" }).click();
  // The first owner spec meets a cold dev server: login and the first
  // pages compile on demand, which can take longer than the 5 s default.
  const cold = { timeout: 15_000 };
  await expect(
    page.getByRole("heading", { name: "Menu", level: 1 }),
  ).toBeVisible(cold);
  const nav = page.getByRole("navigation", { name: "Menu pemilik" }).first();
  await nav.getByRole("link", { name: /^Dasbor/ }).click();
  await expect(
    page.getByRole("heading", { name: "Dasbor", level: 1 }),
  ).toBeVisible(cold);

  const card = page.getByRole("region", { name: "Stok menipis" });
  await expect(card.getByText(INGREDIENT)).toHaveCount(0);
  const dashboardLink = nav.getByRole("link", { name: /^Dasbor/ });
  if (before > 0) {
    await expect(dashboardLink).toHaveAccessibleName(
      `Dasbor ${before} bahan menipis`,
    );
  }

  // A walk-in sale, paid, from another device (the owner is a Counter role).
  const [item] = await sql<{ id: string }[]>`
    select id from menu_items where name = ${ITEM}`;
  const headers = { origin: baseURL! };
  const created = await page.request.post("/api/counter/orders", {
    headers: {
      ...headers,
      "idempotency-key": randomBytes(16).toString("base64url"),
    },
    data: {
      clientSession: randomBytes(16).toString("base64url"),
      items: [{ menuItemId: item!.id, quantity: 1, modifierOptionIds: [] }],
    },
  });
  expect(created.status()).toBe(201);
  const { data: order } = await created.json();
  const paid = await page.request.post(
    `/api/dev/mock-pay/${order.payment.id}`,
    { headers },
  );
  expect(paid.ok()).toBe(true);

  // No reload: the stream brings it.
  const row = card.getByRole("listitem").filter({ hasText: INGREDIENT });
  await expect(row).toContainText("1.000 g · min 1.000 g");
  await expect(row).toContainText("Menipis");
  await expect(dashboardLink).toHaveAccessibleName(
    `Dasbor ${before + 1} bahan menipis`,
  );
  await expect(
    card.getByRole("link", { name: "Catat restock" }),
  ).toHaveAttribute("href", "/owner/restock");
});
