import { expect, type Page, test } from "@playwright/test";
import postgres from "postgres";
import { formatRupiah } from "@/lib/money";
import { e2eTestDatabaseUrl } from "../integration/databases";

// P2-02 acceptance (O-04, O-06; FR-IV-02, FR-OW-03): the owner edits a recipe
// and sees HPP and margin follow, adds an option with an ingredient delta,
// and attaches a group to an item.

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

// The recipe cost as the database sees it, rounded half-up to whole rupiah.
async function hppOf(item: string) {
  const [row] = await sql<{ hpp: number; price: number }[]>`
    select round(sum(r.qty * i.avg_cost))::int as hpp, m.price
    from menu_items m
    join recipe_items r on r.menu_item_id = m.id
    join ingredients i on i.id = r.ingredient_id
    where m.name = ${item}
    group by m.price`;
  return row!;
}

test("the recipe tab shows HPP and margin and saves a change", async ({
  page,
}) => {
  const item = "Kopi Susu Gula Aren";
  const before = await hppOf(item);
  await signIn(page);
  await page.getByRole("button", { name: `Ubah ${item}` }).click();
  const panel = page.getByRole("dialog", { name: item });
  await panel.getByRole("tab", { name: "Resep" }).click();

  await expect(panel.getByText(formatRupiah(before.hpp))).toBeVisible();
  const beans = panel.getByRole("row", { name: /Biji kopi arabika/ });
  await expect(beans).toContainText("Rp 285,00");
  await expect(beans).toContainText(formatRupiah(18 * 285));

  // 18 g → 20 g of beans: HPP goes up by 2 × Rp 285.
  await panel.getByLabel("Jumlah Biji kopi arabika").fill("20");
  await expect(panel.getByText(formatRupiah(before.hpp + 570))).toBeVisible();
  await panel.getByRole("button", { name: "Simpan resep" }).click();
  await expect(panel.getByText("Resep tersimpan.")).toBeVisible();

  const [line] = await sql<{ qty: string }[]>`
    select r.qty from recipe_items r
    join menu_items m on m.id = r.menu_item_id
    join ingredients i on i.id = r.ingredient_id
    where m.name = ${item} and i.name = 'Biji kopi arabika'`;
  expect(line).toEqual({ qty: "20.000" });
  expect((await hppOf(item)).hpp).toBe(before.hpp + 570);

  // A new line: Es krim vanila, 30 g.
  await panel.getByLabel("Tambah bahan").selectOption({
    label: "Es krim vanila (g)",
  });
  await panel.getByLabel("Jumlah", { exact: true }).fill("30");
  await panel.getByRole("button", { name: "Tambah", exact: true }).click();
  await expect(
    panel.getByRole("row", { name: /Es krim vanila/ }),
  ).toBeVisible();
  await panel
    .getByRole("button", { name: "Hapus Es krim vanila dari resep" })
    .click();
  await expect(panel.getByRole("row", { name: /Es krim vanila/ })).toHaveCount(
    0,
  );
});

test("an option's ingredient delta is shown and saved on O-04", async ({
  page,
}) => {
  await signIn(page);
  await page.getByRole("link", { name: "Pilihan menu" }).first().click();
  await expect(
    page.getByRole("heading", { name: "Pilihan menu", level: 1 }),
  ).toBeVisible();
  await page.getByRole("button", { name: /^Tambahan/ }).click();
  const detail = page.getByRole("region", { name: "Tambahan" });
  await expect(detail.getByRole("row", { name: /Extra shot/ })).toContainText(
    "+9 g Biji kopi arabika",
  );
  await expect(detail.getByText("Latte", { exact: true })).toBeVisible();

  await detail.getByRole("button", { name: "Tambah opsi" }).click();
  const panel = page.getByRole("dialog", { name: "Tambah opsi" });
  await panel.getByLabel("Nama opsi").fill("Sirup aren");
  await panel.getByLabel("Tambahan harga").fill("4.000");
  await panel.getByRole("button", { name: "Tambah bahan" }).click();
  await panel.getByLabel("Bahan", { exact: true }).selectOption({
    label: "Gula aren cair (ml)",
  });
  await panel.getByLabel("Jumlah").fill("15");
  await panel.getByRole("button", { name: "Simpan" }).click();
  await expect(panel).toBeHidden();

  const row = detail.getByRole("row", { name: /Sirup aren/ });
  await expect(row).toContainText("+Rp 4.000");
  await expect(row).toContainText("+15 ml Gula aren cair");
  const [delta] = await sql<{ qty_delta: string }[]>`
    select d.qty_delta from modifier_option_ingredients d
    join modifier_options o on o.id = d.option_id
    where o.name = 'Sirup aren'`;
  expect(delta).toEqual({ qty_delta: "15.000" });
});

test("a discount larger than an item's price is refused", async ({ page }) => {
  await signIn(page);
  await page.goto("/owner/modifiers");
  await page.getByRole("button", { name: /^Tambahan/ }).click();
  const detail = page.getByRole("region", { name: "Tambahan" });
  await detail.getByRole("button", { name: "Ubah Extra shot" }).click();
  const panel = page.getByRole("dialog", { name: "Ubah opsi" });
  await panel.getByLabel("Tambahan harga").fill("-40.000");
  await panel.getByRole("button", { name: "Simpan" }).click();
  await expect(panel.getByRole("alert")).toContainText("Harga jadi minus");
});

test("the Pilihan tab attaches a group to an item", async ({ page }) => {
  const item = "Es Teh Lemon";
  await signIn(page);
  await page.getByRole("button", { name: `Ubah ${item}` }).click();
  const panel = page.getByRole("dialog", { name: item });
  await panel.getByRole("tab", { name: "Pilihan" }).click();
  await panel.getByRole("checkbox", { name: /Tambahan/ }).check();
  await panel.getByRole("button", { name: "Naikkan Tambahan" }).click();
  await panel.getByRole("button", { name: "Simpan pilihan" }).click();
  await expect(panel.getByText("Pilihan tersimpan.")).toBeVisible();

  const groups = await sql<{ name: string }[]>`
    select g.name from menu_item_modifier_groups l
    join modifier_groups g on g.id = l.group_id
    join menu_items m on m.id = l.menu_item_id
    where m.name = ${item}
    order by l.sort_order`;
  expect(groups.map((g) => g.name)).toEqual([
    "Ukuran",
    "Gula",
    "Tambahan",
    "Es",
  ]);
});
