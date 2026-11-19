import { existsSync } from "node:fs";
import { parseArgs } from "node:util";
import { closeSql } from "@/db/client";
import { isAppError } from "@/lib/errors";
import { getPublicOrder } from "@/modules/orders/service";
import { signedMockPaidEvent } from "@/modules/payments/service";

// Demo step 8 (Plan §6): sends one signed mock "paid" webhook for an order
// twice to the running app and prints both answers. The second one is a
// duplicate and changes nothing (Schema §5.2). Mock provider only.
//
//   npm run demo:replay-webhook -- <publicToken> [--url http://localhost:3000]
//
// The public token is the last part of the order's status link (/s/<token>).

async function main() {
  if (existsSync(".env")) process.loadEnvFile(".env");
  const { values, positionals } = parseArgs({
    allowPositionals: true,
    options: { url: { type: "string", default: "http://localhost:3000" } },
  });
  const publicToken = positionals[0];
  if (!publicToken) {
    throw new Error("Usage: npm run demo:replay-webhook -- <publicToken>");
  }

  const order = await getPublicOrder(publicToken);
  if (!order.payment) throw new Error("This order has no QRIS charge");
  const { body, headers } = await signedMockPaidEvent(order.payment.id);
  await closeSql();

  const url = `${values.url.replace(/\/$/, "")}/api/webhooks/payments/mock`;
  console.log(
    `Order ${publicToken} (${order.status}), event ${JSON.parse(body).eventId}`,
  );
  for (const attempt of [1, 2]) {
    const response = await fetch(url, { method: "POST", headers, body });
    const answer = await response.json().catch(() => null);
    console.log(
      `  send ${attempt}: HTTP ${response.status}, outcome ${answer?.data?.outcome ?? JSON.stringify(answer)}`,
    );
  }
}

main().catch(async (error: unknown) => {
  await closeSql();
  console.error(
    isAppError(error)
      ? `${error.code}: unknown order, or the payment provider is not mock`
      : error instanceof Error
        ? error.message
        : error,
  );
  process.exitCode = 1;
});
