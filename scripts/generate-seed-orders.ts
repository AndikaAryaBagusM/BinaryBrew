import { existsSync } from "node:fs";
import { parseArgs } from "node:util";
import { closeSql } from "@/db/client";
import { getEnv } from "@/lib/env";
import { isAppError } from "@/lib/errors";
import { addDays, businessDate } from "@/lib/time";
import { seedDemoOrders } from "@/modules/orders/service";
import { getSetting } from "@/modules/settings/service";

// `npm run seed:orders -- [--replace] [--end-date=YYYY-MM-DD]` (FR-RC-07,
// docs/06 §7): demo order history for the Apriori job. Parameters and the
// planted rules are described in scripts/README.md.

const usage =
  "Usage: npm run seed:orders -- [--replace] [--end-date=YYYY-MM-DD]";

async function main() {
  if (existsSync(".env")) process.loadEnvFile(".env");
  getEnv();
  const { values } = parseArgs({
    options: {
      replace: { type: "boolean", default: false },
      "end-date": { type: "string" },
    },
  });
  const endDate =
    values["end-date"] ??
    addDays(
      businessDate(new Date(), await getSetting("business_day_cutoff")),
      -1,
    );
  if (!/^\d{4}-\d{2}-\d{2}$/.test(endDate)) throw new Error(usage);

  const result = await seedDemoOrders({ endDate, replace: values.replace });
  if (result.status === "exists") {
    console.log(
      `${result.existing} seeded orders already exist. Run again with --replace to make them again.`,
    );
    process.exitCode = 1;
    return;
  }
  if (result.replaced > 0) {
    console.log(`Deleted ${result.replaced} earlier seeded orders.`);
  }
  console.log(
    `Created ${result.created} paid orders from ${result.firstDate} to ${result.lastDate} (is_seed).`,
  );
  console.log("Planted rules in the generated baskets:");
  console.table(
    result.rules.map((rule) => ({
      rule: `${rule.antecedent} → ${rule.consequent}`,
      target: rule.targetConfidence,
      confidence: Number(rule.confidence.toFixed(3)),
      support: Number(rule.support.toFixed(4)),
      lift: Number(rule.lift.toFixed(2)),
    })),
  );
}

main()
  .catch((error: unknown) => {
    if (isAppError(error)) {
      console.error(`${error.code}: ${JSON.stringify(error.details ?? {})}`);
      if (error.details?.reason === "demo_data_missing") {
        console.error("Run `npm run db:seed` first.");
      }
    } else {
      console.error(error instanceof Error ? error.message : error);
    }
    process.exitCode = 1;
  })
  .finally(closeSql);
