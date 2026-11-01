import { expect, type Page, test } from "@playwright/test";
import postgres from "postgres";
import { formatBoardNumber } from "@/lib/board";
import { formatQueueNumber } from "@/lib/order-display";
import { e2eTestDatabaseUrl } from "../integration/databases";

// P1-12 acceptance (T-01, FR-QF-04, D19): Preparing and Ready numbers appear
// and move on a second browser window while the Counter moves the order; no
// personal data on screen.

const deviceToken = process.env.E2E_DEVICE_TOKEN!;
const STAFF_PIN = "1470"; // global-setup.ts
const sql = postgres(e2eTestDatabaseUrl(process.env.TEST_DATABASE_URL!), {
  max: 1,
  onnotice: () => {},
});
test.afterAll(() => sql.end());

const column = (board: Page, name: string) =>
  board.getByRole("region", { name });

test("numbers appear and move on the board as the Counter moves the order", async ({
  browser,
  page: board,
  baseURL,
}) => {
  // Other specs leave orders in the queue; finish them so the board starts
  // from a known state.
  await sql`update orders set status = 'completed', completed_at = now()
    where status in ('paid', 'preparing', 'ready')`;
  await board.goto("/board");
  await expect(board.getByText("Belum ada pesanan")).toBeVisible();

  // A second window: the Counter takes a walk-in order, paid via mock.
  // (Self-orders are rate limited per IP, and earlier specs use that up.)
  const counterContext = await browser.newContext({
    viewport: { width: 1280, height: 800 },
  });
  await counterContext.addCookies([
    { name: "bb_device", value: deviceToken, url: baseURL! },
  ]);
  const counter = await counterContext.newPage();
  await counter.goto("/counter/login");
  await counter.getByRole("button", { name: "Rina" }).click();
  await counter.keyboard.type(STAFF_PIN);
  await counter.getByRole("button", { name: "Masuk" }).click();
  await counter
    .getByRole("main")
    .getByRole("button", { name: /Croissant/ })
    .click();
  await counter.getByRole("button", { name: /^Bayar/ }).click();
  await counter.getByRole("button", { name: "Simulasi bayar" }).click();
  await expect(counter.getByTestId("paid-number")).toBeVisible();
  const [row] = await sql<{ queue_number: number; public_token: string }[]>`
    select queue_number, public_token from orders
    where channel = 'counter' and status = 'paid'
    order by paid_at desc limit 1`;
  const shown = formatBoardNumber(row!.queue_number);
  await counter.getByRole("button", { name: "Selesai" }).click();

  // Paid but not started: not on the board yet.
  await expect(board.getByText("Belum ada pesanan")).toBeVisible();

  const card = counter.getByRole("article", {
    name: `Pesanan ${formatQueueNumber(row!.queue_number)}`,
  });

  await card.getByRole("button", { name: "Mulai" }).click();
  const preparing = column(board, "Sedang disiapkan");
  const ready = column(board, "Siap diambil");
  await expect(preparing.getByText(shown, { exact: true })).toBeVisible();
  await expect(ready.getByText(shown, { exact: true })).toHaveCount(0);

  await card.getByRole("button", { name: "Siap" }).click();
  const tile = ready.getByText(shown, { exact: true });
  await expect(tile).toBeVisible();
  await expect(preparing.getByText(shown, { exact: true })).toHaveCount(0);
  // It glows for 5 s after entering Ready.
  await expect(tile).toHaveClass(/border-board-ready/);
  await expect(tile).not.toHaveClass(/border-board-ready/, { timeout: 8_000 });

  // No personal data: no items, staff or tokens on the board.
  const text = await board.locator("body").innerText();
  for (const forbidden of ["Croissant", "Rina", row!.public_token]) {
    expect(text).not.toContain(forbidden);
  }

  await card.getByRole("button", { name: "Diambil" }).click();
  await expect(board.getByText("Belum ada pesanan")).toBeVisible();
  await counterContext.close();
});
