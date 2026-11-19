import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { parseArgs } from "node:util";
import { and, eq } from "drizzle-orm";
import { closeSql, getDb } from "@/db/client";
import { qrTokens } from "@/db/schema";

// Lighthouse on the customer menu page (Tech §11, Plan §6 exit criterion:
// performance ≥ 80 on a throttled mobile profile). Measures a running
// production build: `npm run build && npm run start` first, then
//   npm run perf:menu [-- --url http://localhost:3000] [--label "Meja 1"]
// Uses the installed Chrome, Lighthouse's default mobile profile (simulated
// slow 4G and a 4x slower CPU), and exits with 1 below the target.

const TARGET = 80;

async function main() {
  if (existsSync(".env")) process.loadEnvFile(".env");
  const { values } = parseArgs({
    options: {
      url: { type: "string", default: "http://localhost:3000" },
      label: { type: "string", default: "Meja 1" },
    },
  });
  const base = values.url;
  const label = values.label;

  const [qr] = await getDb()
    .select({ token: qrTokens.token })
    .from(qrTokens)
    .where(and(eq(qrTokens.label, label), eq(qrTokens.isActive, true)));
  await closeSql();
  if (!qr) throw new Error(`No active QR code labelled "${label}"`);
  const url = `${base}/o/${qr.token}`;

  const probe = await fetch(url).catch(() => null);
  if (!probe?.ok) {
    throw new Error(
      `${url} did not answer: start the app with \`npm run build && npm run start\``,
    );
  }

  const dir = mkdtempSync(path.join(tmpdir(), "bb-lighthouse-"));
  const report = path.join(dir, "menu.json");
  try {
    const cli = path.join("node_modules", "lighthouse", "cli", "index.js");
    const run = spawnSync(
      process.execPath,
      [
        cli,
        url,
        "--quiet",
        "--output=json",
        `--output-path=${report}`,
        "--only-categories=performance,accessibility,best-practices",
        "--chrome-flags=--headless=new",
      ],
      { stdio: "inherit" },
    );
    if (run.status !== 0) throw new Error("Lighthouse failed");

    const result = JSON.parse(readFileSync(report, "utf8"));
    const score = (id: string) =>
      Math.round((result.categories[id]?.score ?? 0) * 100);
    const metric = (id: string) => result.audits[id]?.displayValue ?? "-";

    console.log(`Lighthouse ${result.lighthouseVersion}, mobile, ${url}`);
    console.log(`  Performance      ${score("performance")}`);
    console.log(`  Accessibility    ${score("accessibility")}`);
    console.log(`  Best practices   ${score("best-practices")}`);
    for (const [id, name] of [
      ["first-contentful-paint", "First contentful paint"],
      ["largest-contentful-paint", "Largest contentful paint"],
      ["total-blocking-time", "Total blocking time"],
      ["cumulative-layout-shift", "Cumulative layout shift"],
      ["interactive", "Time to interactive"],
    ] as const) {
      console.log(`  ${name.padEnd(26)} ${metric(id)}`);
    }

    if (score("performance") < TARGET) {
      console.error(`Performance is below the target of ${TARGET}.`);
      process.exitCode = 1;
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
