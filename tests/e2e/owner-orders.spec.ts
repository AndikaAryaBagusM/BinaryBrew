import { randomBytes } from "node:crypto";
import { expect, test } from "@playwright/test";
import postgres from "postgres";
import { formatRupiah } from "@/lib/money";
import { formatQueueNumber } from "@/lib/order-display";
import { e2eTestDatabaseUrl } from "../integration/databases";

// P3-01 (FR-PM-08, FR-IV-09, FR-OW-08; Flow §9): the owner voids a paid
// order from S-06 with a reason and their PIN; the stock comes back, a
// refund is requested, and O-12 marks it processed with the gateway's
// refund id and the PIN again.

const OWNER_EMAIL = "pemilik@e2e.test"; // global-setup.ts
const OWNER_PIN = "2580";
const ITEM = "Croissant"; // no options
const sql = postgres(e2eTestDatabaseUrl(process.env.TEST_DATABASE_URL!), {
  max: 1,
  onnotice: () => {},
});
test.afterAll(() => sql.end());

const cold = { timeout: 15_000 };

test("a void returns the stock and its refund is marked processed in O-12", async ({
  page,
  baseURL,
}) => {
  await page.goto("/owner/login");
  await page.getByLabel("Email").fill(OWNER_EMAIL);
  await page.getByLabel("Kata sandi").fill(process.env.E2E_OWNER_PASSWORD!);
  await page.getByRole("button", { name: "Masuk" }).click();
  await expect(
    page.getByRole("heading", { name: "Menu", level: 1 }),
  ).toBeVisible(cold);

  // A paid walk-in order (the owner is a Counter role).
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
  const [row] = await sql<{ queueNumber: number; total: number }[]>`
    select queue_number as "queueNumber", total from orders
    where id = ${order.id}`;
  const number = formatQueueNumber(row!.queueNumber);
  const amount = formatRupiah(row!.total);
  // What moved for this order, per type (Croissant: 1 Croissant Butter).
  const moved = () => sql<{ type: string; qty: string }[]>`
    select type::text, sum(qty_delta)::text as qty from stock_movements
    where ref_type = 'order' and ref_id = ${order.id}
    group by type order by type`;
  expect(await moved()).toEqual([{ type: "sale_deduction", qty: "-1.000" }]);

  // S-06 → reason → S-07.
  await page.goto("/counter");
  await page
    .getByRole("article", { name: `Pesanan ${number}` })
    .getByRole("button", { name: `Detail pesanan ${number}` })
    .click(cold);
  await page.getByRole("button", { name: "Batalkan pesanan" }).click();
  const reason = page.getByRole("dialog", {
    name: `Batalkan pesanan ${number}`,
  });
  await expect(reason.getByText("Bahan dikembalikan ke stok")).toBeVisible();
  await expect(reason.getByText(`Refund ${amount} dicatat`)).toBeVisible();
  await reason.getByLabel("Alasan (wajib)").selectOption("double_payment");
  await reason.getByRole("button", { name: "Lanjut ke PIN pemilik" }).click();
  const pin = page.getByRole("dialog", {
    name: "Masukkan PIN pemilik untuk melanjutkan",
  });
  await expect(
    pin.getByText(`Batalkan pesanan ${number} · refund ${amount}`),
  ).toBeVisible();
  await page.keyboard.type(OWNER_PIN);
  await pin.getByRole("button", { name: "Masuk" }).click();
  await expect(pin).toBeHidden();
  await expect(
    page.getByRole("article", { name: `Pesanan ${number}` }),
  ).toHaveCount(0);

  // Not started yet, so the ingredients came back (BR-08).
  expect(await moved()).toEqual([
    { type: "sale_deduction", qty: "-1.000" },
    { type: "void_return", qty: "1.000" },
  ]);
  const [refund] = await sql<{ id: string; status: string }[]>`
    select id, status from refunds where order_id = ${order.id}`;
  expect(refund!.status).toBe("requested");

  // O-12: the refund is open until it is marked processed.
  await page.goto("/owner/orders");
  await expect(
    page.getByRole("heading", { name: "Pesanan & refund", level: 1 }),
  ).toBeVisible(cold);
  await page.getByLabel("Cari", { exact: true }).fill(number);
  const orders = page.getByRole("tabpanel");
  await expect(orders.getByRole("row")).toHaveCount(2); // header + order
  await expect(orders.getByText("Dibatalkan")).toBeVisible();
  await expect(orders.getByText("Diminta")).toBeVisible();

  await page.getByRole("tab", { name: /^Refund/ }).click();
  await page
    .getByRole("tabpanel")
    .getByRole("button", { name: `${number} lihat refund` })
    .click();
  const card = page.getByRole("region", { name: `Refund ${number}` });
  await expect(card.getByText("Pembayaran ganda")).toBeVisible();
  await expect(
    card.getByText("Bahan dikembalikan (belum disiapkan)"),
  ).toBeVisible();
  await card.getByRole("button", { name: "Tandai sudah dikembalikan" }).click();
  await expect(
    card.getByText("Isi ref refund dari gateway dulu."),
  ).toBeVisible();
  await card.getByLabel("Ref refund gateway (wajib)").fill("RFD-7Q2K91");
  await card.getByRole("button", { name: "Tandai sudah dikembalikan" }).click();
  const ownerPin = page.getByRole("dialog", {
    name: "Masukkan PIN Anda untuk melanjutkan",
  });
  await page.keyboard.type(OWNER_PIN);
  await ownerPin.getByRole("button", { name: "Masuk" }).click();
  await expect(
    card.getByText(`Refund ${number} ditandai sudah dikembalikan.`),
  ).toBeVisible();
  await expect(card.getByText("RFD-7Q2K91")).toBeVisible();

  const [done] = await sql<{ status: string; payment: string }[]>`
    select r.status, p.status as payment from refunds r
    join payments p on p.id = r.payment_id where r.id = ${refund!.id}`;
  expect(done).toEqual({ status: "processed", payment: "refunded" });
  const actions = await sql<{ action: string }[]>`
    select action from audit_logs
    where entity_id in (${order.id}, ${refund!.id})
      and action in ('order.void', 'refund.request', 'refund.process')
    order by id`;
  expect(actions.map((a) => a.action)).toEqual([
    "order.void",
    "refund.request",
    "refund.process",
  ]);
});
