import AxeBuilder from "@axe-core/playwright";
import { expect, type Page, test } from "@playwright/test";
import postgres from "postgres";
import { e2eTestDatabaseUrl } from "../integration/databases";

// P1-17 (Tech §11 accessibility, Design §10): every customer screen passes
// axe (WCAG 2.1 A and AA rules) without serious or critical issues, and the
// order flow works with the keyboard alone.

const token = process.env.E2E_QR_TOKEN!;
const sql = postgres(e2eTestDatabaseUrl(process.env.TEST_DATABASE_URL!), {
  max: 1,
  onnotice: () => {},
});
test.afterAll(() => sql.end());

// Self-orders are rate limited per IP and earlier specs use that up: this
// file orders from its own address (the limiter keys on x-forwarded-for).
test.use({ extraHTTPHeaders: { "x-forwarded-for": "198.51.100.17" } });

async function expectNoSeriousIssues(page: Page, screen: string) {
  const { violations } = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"])
    .analyze();
  const serious = violations
    .filter((v) => v.impact === "serious" || v.impact === "critical")
    .map((v) => ({
      rule: v.id,
      impact: v.impact,
      help: v.help,
      targets: v.nodes.map((n) => n.target.join(" ")),
    }));
  expect(serious, `${screen}: ${JSON.stringify(serious, null, 2)}`).toEqual([]);
}

const menuReady = (page: Page) =>
  expect(page.getByRole("button", { name: "Tambah Croissant" })).toBeVisible();

test("C-01 to C-07 pass axe", async ({ page }) => {
  await page.goto(`/o/${token}`);
  await menuReady(page);
  await expectNoSeriousIssues(page, "C-01 menu");

  // C-02 with options, and the menu with a cart bar.
  await page
    .getByRole("button", { name: "Tambah Kopi Susu Gula Aren" })
    .click();
  const sheet = page.getByRole("dialog", { name: "Kopi Susu Gula Aren" });
  await expect(sheet).toBeVisible();
  await expectNoSeriousIssues(page, "C-02 options");
  await sheet.getByRole("button", { name: /^Tambah • / }).click();
  await expect(sheet).toBeHidden();
  await expectNoSeriousIssues(page, "C-01 menu with cart bar");

  await page.getByRole("link", { name: /Lihat keranjang/ }).click();
  await expect(page.getByRole("heading", { name: "Keranjang" })).toBeVisible();
  await expectNoSeriousIssues(page, "C-03 cart");

  // C-04: the e2e rule suggests Croissant for Kopi Susu.
  await page.getByRole("button", { name: "Bayar dengan QRIS" }).click();
  const reco = page.getByRole("dialog", { name: "Sering dipesan bersama" });
  await expect(reco).toBeVisible();
  await expectNoSeriousIssues(page, "C-04 suggestions");
  await reco.getByRole("button", { name: "Tambah Croissant" }).click();
  await expect(reco.getByText("Ditambahkan")).toBeVisible();
  await expectNoSeriousIssues(page, "C-04 item added");
  await reco.getByRole("button", { name: /^Lanjut bayar/ }).click();

  await expect(page.getByRole("heading", { name: "Pembayaran" })).toBeVisible();
  await expectNoSeriousIssues(page, "C-05 payment");

  await page.getByRole("button", { name: "Simulasi bayar" }).click();
  await expect(page.getByTestId("queue-number")).toBeVisible();
  await expectNoSeriousIssues(page, "C-06 status");

  await page.goto(`${page.url()}/receipt`);
  await expect(page.getByRole("heading").first()).toBeVisible();
  await expectNoSeriousIssues(page, "C-07 receipt");
});

test("the empty cart and the C-08 edge states pass axe", async ({ page }) => {
  await page.goto(`/o/${token}/cart`);
  await expect(
    page.getByRole("heading", { name: "Keranjang masih kosong" }),
  ).toBeVisible();
  await expectNoSeriousIssues(page, "C-03 empty cart");

  await page.goto("/o/AAAAAAAAAAAAAAAAAAAAAA");
  await expect(
    page.getByRole("heading", { name: "Kode QR sudah tidak berlaku" }),
  ).toBeVisible();
  await expectNoSeriousIssues(page, "C-08 invalid QR");

  await sql`update settings set value = 'false' where key = 'ordering_enabled'`;
  try {
    await page.goto(`/o/${token}`);
    await expect(
      page.getByRole("heading", { name: "Pemesanan sedang ditutup" }),
    ).toBeVisible();
    await expectNoSeriousIssues(page, "C-08 ordering closed");
  } finally {
    await sql`update settings set value = 'true' where key = 'ordering_enabled'`;
  }
});

test("an order can be placed with the keyboard alone", async ({ page }) => {
  await page.goto(`/o/${token}`);
  await menuReady(page);

  // Tab to the first add button with options; C-02 traps focus, Esc closes
  // it and gives focus back.
  const kopi = page.getByRole("button", { name: "Tambah Kopi Susu Gula Aren" });
  await tabTo(page, kopi);
  await page.keyboard.press("Enter");
  const sheet = page.getByRole("dialog", { name: "Kopi Susu Gula Aren" });
  await expect(sheet).toBeVisible();
  for (let i = 0; i < 25; i++) {
    await page.keyboard.press("Tab");
    expect(
      await sheet.evaluate((el) => el.contains(document.activeElement)),
    ).toBe(true);
  }
  await page.keyboard.press("Escape");
  await expect(sheet).toBeHidden();
  await expect(kopi).toBeFocused();

  // Croissant has no options: Enter adds it.
  await tabTo(page, page.getByRole("button", { name: "Tambah Croissant" }));
  await page.keyboard.press("Enter");
  await tabTo(page, page.getByRole("link", { name: /Lihat keranjang/ }));
  await page.keyboard.press("Enter");
  await expect(page.getByRole("heading", { name: "Keranjang" })).toBeVisible();

  // No rule starts from Croissant: straight to the payment.
  await tabTo(page, page.getByRole("button", { name: "Bayar dengan QRIS" }));
  await page.keyboard.press("Enter");
  await expect(page.getByRole("heading", { name: "Pembayaran" })).toBeVisible();
});

// Presses Tab until the locator has focus; every stop shows a focus ring
// (an outline or box-shadow), so focus is never invisible.
async function tabTo(page: Page, target: ReturnType<Page["getByRole"]>) {
  for (let i = 0; i < 80; i++) {
    await page.keyboard.press("Tab");
    const unstyled = await page.evaluate(() => {
      const el = document.activeElement as HTMLElement | null;
      // Next.js dev tools (dev server only) are not part of the app.
      if (!el || el === document.body || el.tagName === "NEXTJS-PORTAL") {
        return null;
      }
      const style = getComputedStyle(el);
      const visible =
        (style.outlineStyle !== "none" && style.outlineWidth !== "0px") ||
        style.boxShadow !== "none";
      return visible ? null : el.outerHTML.slice(0, 200);
    });
    expect(unstyled, "every focused element shows a focus ring").toBeNull();
    if (await target.evaluate((el) => el === document.activeElement)) return;
  }
  throw new Error("could not reach the element with Tab");
}
