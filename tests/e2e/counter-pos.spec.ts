import { expect, type Page, test } from "@playwright/test";
import postgres from "postgres";
import { formatRupiah } from "@/lib/money";
import { formatQueueNumber } from "@/lib/order-display";
import { e2eTestDatabaseUrl } from "../integration/databases";

// P1-11 acceptance (S-02 POS, S-03, S-04, S-05, S-06, S-07, S-08; FR-POS-01,
// FR-POS-02, FR-POS-04, FR-POS-05, FR-PM-05): a walk-in order paid via mock;
// a manual confirmation needs the owner's PIN and writes an audit entry;
// marking an item sold out updates the customer menu.

const qrToken = process.env.E2E_QR_TOKEN!;
const deviceToken = process.env.E2E_DEVICE_TOKEN!;
const STAFF_PIN = "1470"; // global-setup.ts
const OWNER_PIN = "2580";
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

// A POS tile: badge, item name and price.
const tile = (page: Page, name: string) =>
  page.getByRole("main").getByRole("button", { name: new RegExp(name) });

const card = (page: Page, number: number) =>
  page.getByRole("article", { name: `Pesanan ${formatQueueNumber(number)}` });

async function paidNumber(page: Page): Promise<number> {
  const shown = page.getByTestId("paid-number");
  await expect(shown).toBeVisible();
  const text = (await shown.textContent())!;
  const [row] = await sql<{ queue_number: number }[]>`
    select queue_number from orders
    where channel = 'counter' and queue_number is not null
    order by paid_at desc limit 1`;
  expect(text).toBe(formatQueueNumber(row!.queue_number));
  return row!.queue_number;
}

test("a walk-in order with options is paid via mock and joins the queue", async ({
  page,
}) => {
  await tile(page, "Croissant").click();
  await tile(page, "Roti Bakar").click();

  // S-03: the required group must be chosen before adding.
  const customize = page.getByRole("dialog", { name: "Roti Bakar" });
  await expect(customize).toBeVisible();
  await customize.getByRole("button", { name: /^Tambah ke pesanan/ }).click();
  await expect(customize).toBeVisible();
  await customize.getByRole("radio", { name: /Cokelat/ }).check();
  await customize.getByRole("button", { name: /^Tambah ke pesanan/ }).click();
  await expect(customize).toHaveCount(0);

  const cart = page.getByRole("region", { name: "Pesanan di kasir" });
  await expect(cart.getByText("Cokelat")).toBeVisible();
  await cart.getByRole("button", { name: /^Bayar/ }).click();

  // S-04 shows the server's total, then the mock gateway pays it.
  const qr = page.getByRole("dialog", { name: "Minta pelanggan scan QR ini" });
  await expect(qr).toBeVisible();
  const [order] = await sql<{ total: number }[]>`
    select total from orders where channel = 'counter'
    order by created_at desc limit 1`;
  await expect(qr.getByTestId("charge-amount")).toHaveText(
    formatRupiah(order!.total),
  );
  await qr.getByRole("button", { name: "Simulasi bayar" }).click();

  const number = await paidNumber(page);
  await page.getByRole("button", { name: "Selesai" }).click();
  await expect(cart.getByText("Ketuk menu untuk mulai pesanan.")).toBeVisible();

  const queued = card(page, number);
  await expect(queued).toBeVisible();
  await expect(queued.getByText("1× Roti Bakar")).toBeVisible();

  // S-06 opens from the card.
  await queued
    .getByRole("button", {
      name: `Detail pesanan ${formatQueueNumber(number)}`,
    })
    .click();
  const detail = page.getByRole("dialog");
  await expect(detail.getByText("Kasir · Rina")).toBeVisible();
  await expect(
    detail.getByText("QRIS dinamis", { exact: false }),
  ).toBeVisible();
  await detail.getByRole("button", { name: "Mulai" }).click();
  await expect
    .poll(async () => {
      const [row] = await sql<{ status: string }[]>`
        select status from orders where queue_number = ${number}
        and channel = 'counter' order by created_at desc limit 1`;
      return row!.status;
    })
    .toBe("preparing");
});

test("a manual confirmation asks for the owner PIN and is audited", async ({
  page,
}) => {
  await tile(page, "Croissant").click();
  await page
    .getByRole("region", { name: "Pesanan di kasir" })
    .getByRole("button", { name: /^Bayar/ })
    .click();
  await page
    .getByRole("button", { name: "Pelanggan bayar lewat QR kios" })
    .click();

  // S-05: the reference is required.
  const manual = page.getByRole("dialog", {
    name: "Konfirmasi pembayaran manual",
  });
  await manual.getByRole("button", { name: "Konfirmasi dibayar" }).click();
  await expect(manual.getByText("Isi referensi pembayaran dulu")).toBeVisible();
  await manual.getByLabel("Referensi pembayaran (wajib)").fill("4821");
  await manual.getByRole("button", { name: "Konfirmasi dibayar" }).click();

  // S-07: a wrong PIN is refused; the owner's PIN confirms.
  const owner = page.getByRole("dialog", {
    name: "Masukkan PIN pemilik untuk melanjutkan",
  });
  await expect(owner).toBeVisible();
  await page.keyboard.type(STAFF_PIN);
  await owner.getByRole("button", { name: "Masuk" }).click();
  await expect(owner.getByText(/PIN salah/)).toBeVisible();
  await page.keyboard.type(OWNER_PIN);
  await owner.getByRole("button", { name: "Masuk" }).click();

  const number = await paidNumber(page);
  const [ownerRow] = await sql<{ ownerName: string }[]>`
    select name as "ownerName" from users where role = 'owner'`;
  const [audit] = await sql<
    { actor: string; reference: string; owner: string; method: string }[]
  >`
    select u.name as actor, a.metadata->>'reference' as reference,
      o2.name as owner, p.method
    from audit_logs a
    join users u on u.id = a.actor_user_id
    join orders o on o.id = (a.metadata->>'orderId')::uuid
    join payments p on p.order_id = o.id and p.status = 'paid'
    join users o2 on o2.id = (a.metadata->>'ownerUserId')::uuid
    where a.action = 'payment.manual_confirm' and o.queue_number = ${number}
    order by a.created_at desc limit 1`;
  expect(audit).toEqual({
    actor: "Rina",
    reference: "4821",
    owner: ownerRow!.ownerName,
    method: "qris_static_manual",
  });
});

test("marking an item sold out updates the customer menu", async ({
  page,
  context,
}) => {
  const item = "Kentang Goreng";
  // Other specs expect the item on sale, even if this one fails midway.
  try {
    await page.getByRole("button", { name: "Habis", exact: true }).click();
    const panel = page.getByRole("dialog", { name: "Ketersediaan menu" });
    await panel.getByLabel("Cari menu").fill("kentang");
    const toggle = panel.getByRole("switch", { name: item });
    await expect(toggle).toBeChecked();

    await toggle.click();
    await expect(toggle).not.toBeChecked();
    await expect(panel.getByText("Ditandai habis oleh Rina")).toBeVisible();

    const customer = await context.newPage();
    await customer.goto(`/o/${qrToken}`);
    await expect(
      customer.getByRole("button", { name: `Tambah ${item}` }),
    ).toBeDisabled();

    await page.keyboard.press("Escape");
    await expect(panel).toHaveCount(0);
    await expect(tile(page, item)).toBeDisabled();

    await page.getByRole("button", { name: "Habis", exact: true }).click();
    await panel.getByLabel("Cari menu").fill("kentang");
    await toggle.click();
    await expect(toggle).toBeChecked();
    await customer.reload();
    await expect(
      customer.getByRole("button", { name: `Tambah ${item}` }),
    ).toBeEnabled();
  } finally {
    await sql`update menu_items set manual_sold_out = false
      where name = ${item}`;
  }
});
