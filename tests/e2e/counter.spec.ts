import {
  type APIRequestContext,
  expect,
  type Page,
  test,
} from "@playwright/test";
import postgres from "postgres";
import { formatQueueNumber } from "@/lib/order-display";
import { e2eTestDatabaseUrl } from "../integration/databases";

// P1-10 acceptance (S-01, S-02, FR-POS-03, FR-QF-02, Flow §5, E11): a newly
// paid order appears with a chime; the status buttons move the order and
// update the customer page; the screen locks after 3 minutes idle.

const qrToken = process.env.E2E_QR_TOKEN!;
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
  // Count chimes: lib/chime.ts makes one AudioContext per chime.
  await page.addInitScript(() => {
    const w = window as unknown as { chimes: number };
    w.chimes = 0;
    const Original = window.AudioContext;
    window.AudioContext = class extends Original {
      constructor(...args: ConstructorParameters<typeof AudioContext>) {
        super(...args);
        w.chimes++;
      }
    };
  });
});

// The URL changes before the Counter screen has mounted (and started its
// idle timer), so wait for the queue heading.
async function expectCounter(page: Page) {
  await expect(page).toHaveURL("/counter");
  await expect(page.getByRole("heading", { name: "Antrean" })).toBeVisible();
}

const chimes = (page: Page) =>
  page.evaluate(() => (window as unknown as { chimes: number }).chimes);

async function logIn(page: Page, name = "Rina", pin = STAFF_PIN) {
  await page.goto("/counter/login");
  await page.getByRole("button", { name }).click();
  await page.keyboard.type(pin);
  await page.getByRole("button", { name: "Masuk" }).click();
}

// A customer orders a Croissant and pays with the mock gateway.
async function customerPays(request: APIRequestContext, baseURL: string) {
  const created = await request.post("/api/public/orders", {
    headers: { origin: baseURL, "idempotency-key": crypto.randomUUID() },
    data: {
      qrToken,
      clientSession: crypto.randomUUID().replaceAll("-", ""),
      items: [
        { menuItemId: await croissantId(), quantity: 1, modifierOptionIds: [] },
      ],
    },
  });
  expect(created.ok()).toBe(true);
  const { data } = await created.json();
  const paid = await request.post(`/api/dev/mock-pay/${data.payment.id}`, {
    headers: { origin: baseURL },
  });
  expect(paid.ok()).toBe(true);
  const [row] = await sql<{ queue_number: number }[]>`
    select queue_number from orders where public_token = ${data.publicToken}`;
  return { publicToken: data.publicToken as string, number: row!.queue_number };
}

async function croissantId() {
  const [row] = await sql<{ id: string }[]>`
    select id from menu_items where name = 'Croissant'`;
  return row!.id;
}

const card = (page: Page, number: number) =>
  page.getByRole("article", { name: `Pesanan ${formatQueueNumber(number)}` });

test("an unregistered browser is told to ask the owner", async ({
  context,
  page,
}) => {
  await context.clearCookies();
  await page.goto("/counter");
  await expect(page).toHaveURL("/counter/login");
  await expect(
    page.getByText("Perangkat ini belum terdaftar", { exact: false }),
  ).toBeVisible();
});

test("log in with name and PIN; a wrong PIN shows the attempts left", async ({
  page,
}) => {
  await logIn(page, "Dimas", "9999");
  await expect(page.getByText("PIN salah. Sisa percobaan: 4")).toBeVisible();
  await page.keyboard.type(STAFF_PIN);
  await page.getByRole("button", { name: "Masuk" }).click();
  await expectCounter(page);
  await expect(
    page.getByRole("button", { name: "Menu staf: Dimas" }),
  ).toBeVisible();
});

test("a paid order appears with a chime; Mulai, Siap, Diambil move it and the customer page follows", async ({
  page,
  context,
  request,
  baseURL,
}) => {
  await logIn(page);
  await expectCounter(page);
  await page.getByRole("heading", { name: "Antrean" }).click(); // a user gesture, so sound is allowed
  const before = await chimes(page);

  const { publicToken, number } = await customerPays(request, baseURL!);
  const order = card(page, number);
  await expect(order).toBeVisible();
  await expect(order.getByText("Croissant")).toBeVisible();
  await expect(order.getByText("Baru", { exact: true })).toBeVisible();
  await expect.poll(() => chimes(page)).toBeGreaterThan(before);

  const customer = await context.newPage();
  await customer.goto(`/s/${publicToken}`);

  await order.getByRole("button", { name: "Mulai" }).click();
  await expect(order.getByText("Disiapkan")).toBeVisible();
  await order.getByRole("button", { name: "Siap" }).click();
  await expect(order.getByText("Siap diambil")).toBeVisible();
  await expect(customer.getByText("Pesanan siap diambil!")).toBeVisible();

  await order.getByRole("button", { name: "Diambil" }).click();
  await expect(order).toHaveCount(0);
  // The card leaves at once (optimistic); the server commits just after.
  await expect
    .poll(async () => {
      const [row] = await sql<{ status: string }[]>`
        select status from orders where public_token = ${publicToken}`;
      return row!.status;
    })
    .toBe("completed");
});

test("locks after 3 minutes idle, keeps counting new orders, and unlocks with the PIN", async ({
  page,
  request,
  baseURL,
}) => {
  await page.clock.install();
  await logIn(page);
  await expectCounter(page);

  await page.clock.fastForward("02:59");
  await expect(
    page.getByRole("dialog", { name: "Layar terkunci" }),
  ).toHaveCount(0);
  await page.clock.fastForward("00:02");
  const overlay = page.getByRole("dialog", { name: "Layar terkunci" });
  await expect(overlay).toBeVisible();

  // E11: orders still arrive while locked.
  await customerPays(request, baseURL!);
  const [row] = await sql<{ waiting: number }[]>`
    select count(*)::int as waiting from orders where status = 'paid'`;
  await expect(
    overlay.getByText(`${row!.waiting} pesanan baru menunggu`, {
      exact: false,
    }),
  ).toBeVisible();

  // A reload does not unlock.
  await page.reload();
  await expect(overlay).toBeVisible();

  await page.keyboard.type("9999");
  await overlay.getByRole("button", { name: "Masuk" }).click();
  await expect(overlay.getByText(/PIN salah/)).toBeVisible();
  await page.keyboard.type(STAFF_PIN);
  await overlay.getByRole("button", { name: "Masuk" }).click();
  await expect(overlay).toHaveCount(0);
  await expect(page.getByRole("heading", { name: "Antrean" })).toBeVisible();
});

test("Ganti pengguna on the lock overlay goes back to the name list", async ({
  page,
}) => {
  await page.clock.install();
  await logIn(page, "Dimas");
  await expectCounter(page);
  await page.clock.fastForward("03:01");
  await page.getByRole("button", { name: "Bukan kamu? Ganti staf" }).click();
  await expect(page).toHaveURL("/counter/login");
  await page.goto("/counter");
  await expect(page).toHaveURL("/counter/login");
});
