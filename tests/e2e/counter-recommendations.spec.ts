import { expect, test } from "@playwright/test";
import postgres from "postgres";
import { e2eTestDatabaseUrl } from "../integration/databases";

// P1-16 acceptance (S-02 suggestion row, Flow §5.3, FR-RC-04): Americano in
// the walk-in cart offers Brownie from the rule (global-setup.ts); "Tambah"
// adds it, and the order links the shown and accepted events.

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
});

test("the cart offers Brownie for Americano; Tambah adds it", async ({
  page,
}) => {
  const main = page.getByRole("main");
  await main.getByRole("button", { name: /Americano/ }).click();
  const customize = page.getByRole("dialog", { name: "Americano" });
  await customize.getByRole("button", { name: /^Tambah ke pesanan/ }).click();
  await expect(customize).toHaveCount(0);

  const cart = page.getByRole("region", { name: "Pesanan di kasir" });
  await expect(cart.getByText("Tawarkan Brownie · Rp 16.000")).toBeVisible();
  await expect(cart.getByText("Sering dibeli bersama Americano")).toBeVisible();
  await cart.getByRole("button", { name: "Tambah Brownie" }).click();

  await expect(cart.getByText("Brownie", { exact: true })).toBeVisible();
  await expect(cart.getByText(/^Tawarkan/)).toHaveCount(0);

  await cart.getByRole("button", { name: /^Bayar/ }).click();
  const qr = page.getByRole("dialog", { name: "Minta pelanggan scan QR ini" });
  await expect(qr).toBeVisible();

  const rows = await sql<{ action: string; name: string }[]>`
    select e.action, m.name
    from recommendation_events e
    join menu_items m on m.id = e.item_id
    where e.order_id = (
      select id from orders where channel = 'counter'
      order by created_at desc limit 1)
    order by e.id`;
  expect(rows.map((r) => [r.action, r.name])).toEqual([
    ["shown", "Brownie"],
    ["accepted", "Brownie"],
  ]);
});
