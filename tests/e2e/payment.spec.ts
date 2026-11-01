import { expect, type Page, test } from "@playwright/test";
import postgres from "postgres";
import { formatRupiah } from "@/lib/money";
import type { PublicMenu } from "@/modules/menu/service";
import { priceOrder } from "@/modules/orders/pricing";
import { e2eTestDatabaseUrl } from "../integration/databases";

// P1-08 acceptance (C-05, C-06, C-07, FR-PM-02, FR-QF-03): pay with the mock
// button and the status screen shows the queue number without a reload; with
// the SSE stream cut, the page still follows the order within 10 s by polling.
// Plus the checkout refusals the cart must handle (FR-CO-06, Flow E6).

const token = process.env.E2E_QR_TOKEN!;
const sql = postgres(e2eTestDatabaseUrl(process.env.TEST_DATABASE_URL!), {
  max: 1,
  onnotice: () => {},
});
test.afterAll(() => sql.end());

let menu: PublicMenu;
test.beforeAll(async ({ request }) => {
  const response = await request.get(`/api/public/menu?qr=${token}`);
  expect(response.ok()).toBe(true);
  menu = (await response.json()).data;
});

const item = (name: string) =>
  menu.categories.flatMap((c) => c.items).find((i) => i.name === name)!;

async function cartWith(page: Page, ...names: string[]) {
  await page.goto(`/o/${token}`);
  for (const name of names) {
    await page.getByRole("button", { name: `Tambah ${name}` }).click();
  }
  await page.getByRole("link", { name: /Lihat keranjang/ }).click();
  await expect(page).toHaveURL(`/o/${token}/cart`);
}

async function payFromCart(page: Page) {
  await page.getByRole("button", { name: "Bayar dengan QRIS" }).click();
  await expect(page).toHaveURL(/\/s\/[A-Za-z0-9_-]{22}$/);
  return page.url().split("/s/")[1]!;
}

const orderByToken = async (publicToken: string) =>
  (
    await sql<
      { id: string; status: string; queue_number: number | null }[]
    >`select id, status, queue_number from orders where public_token = ${publicToken}`
  )[0]!;

// What the Counter (P1-10) will do: change the status and notify.
async function moveOrder(publicToken: string, status: "preparing" | "ready") {
  const column = status === "preparing" ? "preparing_at" : "ready_at";
  const [row] = await sql<{ id: string; queue_number: number }[]>`
    update orders set status = ${status}, ${sql(column)} = now()
    where public_token = ${publicToken}
    returning id, queue_number`;
  await sql`select pg_notify('order_events', ${JSON.stringify({
    orderId: row!.id,
    status,
    queueNumber: row!.queue_number,
  })})`;
}

test("pay with the mock button: the status screen shows the number without reload", async ({
  page,
}) => {
  await cartWith(page, "Croissant");
  const expected = priceOrder(
    [{ menuItemId: item("Croissant").id, quantity: 1, modifierOptionIds: [] }],
    menu.categories.flatMap((c) => c.items),
    menu.pricing,
  ).total;
  const publicToken = await payFromCart(page);

  // C-05: QR, exact amount, countdown, instruction.
  await expect(page.getByRole("img", { name: "Kode QRIS" })).toBeVisible();
  await expect(page.getByTestId("pay-amount")).toHaveText(
    formatRupiah(expected),
  );
  await expect(page.getByText(/^Bayar dalam (09|10):\d\d$/)).toBeVisible();
  await expect(
    page.getByText("Buka aplikasi bank atau e-wallet, scan, lalu bayar"),
  ).toBeVisible();

  // A marker that a reload would wipe.
  await page.evaluate(() => {
    (window as unknown as { marker: number }).marker = 1;
  });
  await page.getByRole("button", { name: "Simulasi bayar" }).click();

  // C-06, live.
  const number = page.getByTestId("queue-number");
  await expect(number).toHaveText(/^#\d{3}$/);
  const { queue_number } = await orderByToken(publicToken);
  await expect(number).toHaveText(`#${String(queue_number).padStart(3, "0")}`);
  await expect(
    page.getByRole("listitem").filter({ hasText: "Diterima" }),
  ).toHaveAttribute("aria-current", "step");
  await expect(page.getByText("Layar ini otomatis diperbarui")).toBeVisible();
  expect(
    await page.evaluate(
      () => (window as unknown as { marker?: number }).marker,
    ),
  ).toBe(1);

  // Paid: the cart is emptied, and "Pesanan saya" links back here.
  await page.goto(`/o/${token}`);
  await expect(
    page.getByRole("link", { name: /Lihat keranjang/ }),
  ).toBeHidden();
  await page.getByRole("button", { name: "Pesanan saya" }).click();
  await page.getByRole("link", { name: "Lihat status" }).first().click();
  await expect(page).toHaveURL(`/s/${publicToken}`);
  await expect(page.getByTestId("queue-number")).toBeVisible();
});

test("without the SSE stream the status page still updates within 10 s", async ({
  page,
}) => {
  // Two changes, each found by a poll up to 10 s apart.
  test.setTimeout(60_000);
  // Keep every stream the page opens, so the test can kill them. (page.route
  // would also turn off the browser cache, which changes how Next.js dev
  // renders.)
  await page.addInitScript(() => {
    const streams: EventSource[] = [];
    const Original = window.EventSource;
    window.EventSource = class extends Original {
      constructor(url: string | URL, init?: EventSourceInit) {
        super(url, init);
        streams.push(this);
      }
    };
    (window as unknown as { killStreams: () => void }).killStreams = () =>
      streams.forEach((stream) => stream.close());
  });
  await cartWith(page, "Croissant");
  const publicToken = await payFromCart(page);
  await page.getByRole("button", { name: "Simulasi bayar" }).click();
  await expect(page.getByTestId("queue-number")).toBeVisible();

  // A closed EventSource never reconnects: only polling is left.
  await page.evaluate(() =>
    (window as unknown as { killStreams: () => void }).killStreams(),
  );
  // 10 s poll interval plus the request itself.
  const withinPoll = { timeout: 11_000 };

  await moveOrder(publicToken, "preparing");
  await expect(
    page.getByRole("listitem").filter({ hasText: "Disiapkan" }),
  ).toHaveAttribute("aria-current", "step", withinPoll);
  await expect(page.getByText("Pesananmu sedang disiapkan")).toBeVisible();

  await moveOrder(publicToken, "ready");
  await expect(
    page.getByRole("heading", { name: "Pesanan siap diambil!" }),
  ).toBeVisible(withinPoll);
});

test("ready arrives live over SSE", async ({ page }) => {
  await cartWith(page, "Croissant");
  const publicToken = await payFromCart(page);
  await page.getByRole("button", { name: "Simulasi bayar" }).click();
  await expect(page.getByTestId("queue-number")).toBeVisible();

  await moveOrder(publicToken, "ready");
  // Well under the 10 s polling interval.
  await expect(
    page.getByRole("heading", { name: "Pesanan siap diambil!" }),
  ).toBeVisible({ timeout: 3_000 });
});

test("the receipt lists the paid order", async ({ page }) => {
  await cartWith(page, "Croissant");
  const publicToken = await payFromCart(page);
  await page.getByRole("button", { name: "Simulasi bayar" }).click();
  await expect(page.getByTestId("queue-number")).toBeVisible();

  await page.getByRole("link", { name: "Lihat struk" }).click();
  await expect(page).toHaveURL(`/s/${publicToken}/receipt`);
  const receipt = page.getByRole("main");
  await expect(receipt).toContainText(menu.shopName);
  await expect(receipt).toContainText("Croissant");
  await expect(receipt).toContainText("QRIS");
  await expect(receipt).toContainText("Terima kasih");
});

test("Kembali ke keranjang cancels the unpaid order and keeps the cart", async ({
  page,
}) => {
  await cartWith(page, "Croissant");
  const publicToken = await payFromCart(page);
  await page.getByRole("button", { name: "Kembali ke keranjang" }).click();
  await expect(page).toHaveURL(`/o/${token}/cart`);
  await expect(
    page.getByRole("listitem").filter({ hasText: "Croissant" }),
  ).toBeVisible();
  expect((await orderByToken(publicToken)).status).toBe("expired");
});

test("an expired payment offers to order again", async ({ page }) => {
  await cartWith(page, "Croissant");
  const publicToken = await payFromCart(page);
  await sql`update orders set expires_at = now() - interval '1 second'
            where public_token = ${publicToken}`;
  await page.reload();
  await expect(
    page.getByRole("heading", { name: "Waktu pembayaran habis" }),
  ).toBeVisible();
  await page.getByRole("link", { name: "Pesan lagi" }).click();
  await expect(page).toHaveURL(`/o/${token}`);
});

test("an item sold out at checkout is named and removed from the cart", async ({
  page,
}) => {
  await cartWith(page, "Croissant", "Brownie");
  await sql`update menu_items set manual_sold_out = true where name = 'Brownie'`;
  try {
    await page.getByRole("button", { name: "Bayar dengan QRIS" }).click();
    const dialog = page.getByRole("dialog", {
      name: "Maaf, ada menu yang habis",
    });
    await expect(dialog).toContainText("Brownie");
    await dialog.getByRole("button", { name: "Perbarui keranjang" }).click();
    await expect(dialog).toBeHidden();
    await expect(
      page.getByRole("listitem").filter({ hasText: "Brownie" }),
    ).toBeHidden();
    await expect(
      page.getByRole("listitem").filter({ hasText: "Croissant" }),
    ).toBeVisible();
    await expect(page).toHaveURL(`/o/${token}/cart`);
  } finally {
    await sql`update menu_items set manual_sold_out = false where name = 'Brownie'`;
  }
});

test("a price change is shown before the QR (Flow E6)", async ({ page }) => {
  await cartWith(page, "Croissant");
  const [row] = await sql<
    { price: number }[]
  >`select price from menu_items where name = 'Croissant'`;
  const price = row!.price;
  await sql`update menu_items set price = ${price + 1_000} where name = 'Croissant'`;
  try {
    await page.getByRole("button", { name: "Bayar dengan QRIS" }).click();
    const dialog = page.getByRole("dialog", { name: "Harga diperbarui" });
    const newTotal = priceOrder(
      [
        {
          menuItemId: item("Croissant").id,
          quantity: 1,
          modifierOptionIds: [],
        },
      ],
      menu.categories
        .flatMap((c) => c.items)
        .map((i) =>
          i.name === "Croissant" ? { ...i, price: price + 1_000 } : i,
        ),
      menu.pricing,
    ).total;
    await expect(dialog).toContainText(formatRupiah(newTotal));
    await dialog.getByRole("button", { name: "Lanjut" }).click();
    await expect(page).toHaveURL(/\/s\/[A-Za-z0-9_-]{22}$/);
    await expect(page.getByTestId("pay-amount")).toHaveText(
      formatRupiah(newTotal),
    );
  } finally {
    await sql`update menu_items set price = ${price} where name = 'Croissant'`;
  }
});
