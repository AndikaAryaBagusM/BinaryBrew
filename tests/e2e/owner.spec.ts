import { expect, type Page, test } from "@playwright/test";
import postgres from "postgres";
import { formatRupiah } from "@/lib/money";
import { e2eTestDatabaseUrl } from "../integration/databases";

// P1-13 acceptance (O-01, O-03, O-13, O-14; FR-OW-01, 02, 04, 05): the owner
// changes a price and the customer menu shows it; a new staff user signs in
// by PIN on a device the owner registered; settings survive a reload.

const qrToken = process.env.E2E_QR_TOKEN!;
const OWNER_EMAIL = "pemilik@e2e.test"; // global-setup.ts
const sql = postgres(e2eTestDatabaseUrl(process.env.TEST_DATABASE_URL!), {
  max: 1,
  onnotice: () => {},
});
test.afterAll(() => sql.end());

async function signIn(page: Page) {
  await page.goto("/owner/login");
  await expect(
    page.getByRole("heading", { name: "Masuk sebagai pemilik" }),
  ).toBeVisible();
  await page.getByLabel("Email").fill(OWNER_EMAIL);
  await page.getByLabel("Kata sandi").fill(process.env.E2E_OWNER_PASSWORD!);
  await page.getByRole("button", { name: "Masuk" }).click();
  await expect(
    page.getByRole("heading", { name: "Menu", level: 1 }),
  ).toBeVisible();
}

async function setPrice(page: Page, name: string, price: string) {
  await page.getByRole("button", { name: `Ubah ${name}` }).click();
  const panel = page.getByRole("dialog", { name: "Ubah menu" });
  await panel.getByLabel("Harga").fill(price);
  await panel.getByRole("button", { name: "Simpan" }).click();
  await expect(panel).toBeHidden();
}

test("the owner area asks for the owner login first", async ({ page }) => {
  await page.goto("/owner/settings");
  await expect(
    page.getByRole("heading", { name: "Masuk sebagai pemilik" }),
  ).toBeVisible();
  await expect(page).toHaveURL("/owner/login");

  await page.getByLabel("Email").fill(OWNER_EMAIL);
  await page.getByLabel("Kata sandi").fill("not-the-password");
  await page.getByRole("button", { name: "Masuk" }).click();
  await expect(page.getByText("Email atau kata sandi salah")).toBeVisible();
});

test("a new price shows on the customer menu", async ({ page, browser }) => {
  const [before] = await sql<{ price: number }[]>`
    select price from menu_items where name = 'Sandwich Ayam'`;
  const newPrice = before!.price + 1_500;

  await signIn(page);
  const row = page.getByRole("row", { name: /Sandwich Ayam/ });
  await expect(row).toContainText(formatRupiah(before!.price));
  await setPrice(page, "Sandwich Ayam", String(newPrice));
  await expect(row).toContainText(formatRupiah(newPrice));

  // A customer's phone, no session: the menu reads the price per request.
  const customer = await browser.newPage();
  await customer.goto(`/o/${qrToken}`);
  const card = customer
    .getByRole("article")
    .filter({ has: customer.getByRole("heading", { name: "Sandwich Ayam" }) });
  await expect(card).toContainText(formatRupiah(newPrice));
  await customer.close();

  const [audit] = await sql<{ metadata: { changes: object } }[]>`
    select a.metadata from audit_logs a
    join menu_items m on m.id = a.entity_id::uuid
    where a.action = 'menu_item.update' and m.name = 'Sandwich Ayam'
    order by a.created_at desc limit 1`;
  expect(audit!.metadata.changes).toEqual({
    price: { from: before!.price, to: newPrice },
  });

  // Put it back for the other specs.
  await setPrice(page, "Sandwich Ayam", String(before!.price));
  await expect(row).toContainText(formatRupiah(before!.price));
});

test("a new staff user signs in by PIN on a device the owner registered", async ({
  page,
}) => {
  // This browser has no device cookie yet.
  await signIn(page);
  await page
    .getByRole("link", { name: "Pengguna & perangkat" })
    .first()
    .click();
  await expect(
    page.getByRole("heading", { name: "Pengguna & perangkat", level: 1 }),
  ).toBeVisible();

  await page.getByRole("button", { name: "Tambah pengguna" }).click();
  const add = page.getByRole("dialog", { name: "Tambah pengguna" });
  await add.getByLabel("Nama").fill("Wulan");
  await add.getByRole("radio", { name: "Barista" }).check();
  await add.getByLabel("PIN baru").fill("3691");
  await add.getByLabel("Ulangi PIN").fill("3619");
  await add.getByRole("button", { name: "Tambah pengguna" }).click();
  await expect(add.getByText("PIN tidak sama")).toBeVisible();
  await add.getByLabel("Ulangi PIN").fill("3691");
  await add.getByRole("button", { name: "Tambah pengguna" }).click();
  await expect(add).toBeHidden();
  await expect(page.getByRole("status")).toContainText("Wulan");
  await expect(page.getByRole("row", { name: /Wulan/ })).toContainText(
    "Barista",
  );

  await page.getByRole("button", { name: "Daftarkan perangkat ini" }).click();
  const register = page.getByRole("dialog", {
    name: "Daftarkan perangkat ini",
  });
  await register.getByLabel("Nama perangkat").fill("Tablet bar");
  await register.getByRole("button", { name: "Daftarkan" }).click();
  await expect(register).toBeHidden();
  await expect(page.getByRole("row", { name: /Tablet bar/ })).toBeVisible();

  const actions = await sql<{ action: string }[]>`
    select action from audit_logs
    where action in ('user.create', 'device.register')
    order by created_at`;
  expect(actions.map((row) => row.action)).toEqual(
    expect.arrayContaining(["user.create", "device.register"]),
  );

  // The owner signs out; Wulan signs in on this registered browser.
  await page.getByRole("button", { name: "Keluar" }).first().click();
  await expect(
    page.getByRole("heading", { name: "Masuk sebagai pemilik" }),
  ).toBeVisible();
  await page.goto("/counter/login");
  await page.getByRole("button", { name: /Wulan/ }).click();
  await page.keyboard.type("3691");
  await page.getByRole("button", { name: "Masuk" }).click();
  await expect(page).toHaveURL("/counter");
  await expect(page.getByRole("heading", { name: "Antrean" })).toBeVisible();
});

test("settings are saved and survive a reload", async ({ page }) => {
  await signIn(page);
  await page.getByRole("link", { name: "Pengaturan" }).first().click();
  await expect(
    page.getByRole("heading", { name: "Pengaturan", level: 1 }),
  ).toBeVisible();
  const save = page.getByRole("button", { name: "Simpan perubahan" });
  await expect(save).toBeDisabled();

  const service = page.getByLabel("Biaya layanan");
  await expect(service).toHaveValue("5");
  await service.fill("abc");
  await save.click();
  await expect(page.getByText("Isi angka 0–100")).toBeVisible();

  await service.fill("7,5");
  await page.getByLabel("Batas waktu pembayaran").selectOption("15");
  await save.click();
  await expect(page.getByRole("status")).toHaveText("Pengaturan tersimpan.");
  await expect(save).toBeDisabled();

  const rows = await sql<{ key: string; value: unknown }[]>`
    select key, value from settings
    where key in ('service_charge_bps', 'order_expiry_minutes')
    order by key`;
  expect(rows).toEqual([
    { key: "order_expiry_minutes", value: 15 },
    { key: "service_charge_bps", value: 750 },
  ]);

  await page.reload();
  await expect(page.getByLabel("Biaya layanan")).toHaveValue("7,5");
  await expect(page.getByLabel("Batas waktu pembayaran")).toHaveValue("15");

  // Put them back for the other specs.
  await page.getByLabel("Biaya layanan").fill("5");
  await page.getByLabel("Batas waktu pembayaran").selectOption("10");
  await page.getByRole("button", { name: "Simpan perubahan" }).click();
  await expect(page.getByRole("status")).toHaveText("Pengaturan tersimpan.");
});
