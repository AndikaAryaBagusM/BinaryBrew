import { existsSync, readFileSync } from "node:fs";
import { parseArgs } from "node:util";
import { closeSql } from "@/db/client";
import { getEnv } from "@/lib/env";
import { isAppError } from "@/lib/errors";
import { importOrderHistory } from "@/modules/orders/service";

// `npm run import:orders -- <file.csv> [--dry-run]` (FR-RC-07): order history
// exported from the old POS. The CSV format is in docs/02 §10. Nothing is
// imported when any row is wrong; --dry-run only checks the file.

const usage = "Usage: npm run import:orders -- <file.csv> [--dry-run]";
const MAX_PROBLEMS_SHOWN = 50;

async function main() {
  if (existsSync(".env")) process.loadEnvFile(".env");
  getEnv();
  const { values, positionals } = parseArgs({
    allowPositionals: true,
    options: { "dry-run": { type: "boolean", default: false } },
  });
  const [file] = positionals;
  if (!file || positionals.length > 1) throw new Error(usage);

  const result = await importOrderHistory(readFileSync(file, "utf8"), {
    dryRun: values["dry-run"],
  });
  if (result.status === "invalid") {
    console.error(
      `${file}: ${result.problems.length} problem(s), nothing imported.`,
    );
    for (const problem of result.problems.slice(0, MAX_PROBLEMS_SHOWN)) {
      console.error(`  line ${problem.line}: ${problem.message}`);
    }
    if (result.problems.length > MAX_PROBLEMS_SHOWN) {
      console.error(
        `  … and ${result.problems.length - MAX_PROBLEMS_SHOWN} more`,
      );
    }
    process.exitCode = 1;
    return;
  }
  const verb = result.status === "checked" ? "Would import" : "Imported";
  console.log(
    `${verb} ${result.orders} orders (${result.lines} lines); ${result.skipped} already imported before.`,
  );
}

main()
  .catch((error: unknown) => {
    if (isAppError(error)) {
      console.error(`${error.code}: ${JSON.stringify(error.details ?? {})}`);
    } else {
      console.error(error instanceof Error ? error.message : error);
    }
    process.exitCode = 1;
  })
  .finally(closeSql);
