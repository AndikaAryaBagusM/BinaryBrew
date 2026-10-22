import { existsSync } from "node:fs";
import { z } from "zod";
import { closeSql, getDb } from "@/db/client";
import { getEnv } from "@/lib/env";
import { activeQrTokens, seedDatabase } from "./seed";

// `npm run db:seed`: loads Schema §7 steps 1-3. Safe to run repeatedly.
// Secrets come from .env and are never printed.
const pin = z.string().regex(/^\d{4,6}$/, "must be 4-6 digits");

const seedEnvSchema = z.object({
  SEED_OWNER_EMAIL: z.email(),
  SEED_OWNER_PASSWORD: z.string().min(12, "must be at least 12 characters"),
  SEED_OWNER_PIN: pin,
  SEED_STAFF_PIN: pin,
  SEED_COUNTER_DEVICE_TOKEN: z
    .string()
    .regex(/^[A-Za-z0-9_-]{43,}$/, "must be 32+ random bytes as base64url"),
});

async function main() {
  if (existsSync(".env")) process.loadEnvFile(".env");
  const env = getEnv();
  const parsed = seedEnvSchema.safeParse(process.env);
  if (!parsed.success) {
    const problems = parsed.error.issues
      .map((issue) => `  ${issue.path.join(".")}: ${issue.message}`)
      .join("\n");
    throw new Error(`Invalid seed variables (see .env.example):\n${problems}`);
  }
  const seedEnv = parsed.data;

  const db = getDb();
  const summary = await seedDatabase(db, {
    ownerEmail: seedEnv.SEED_OWNER_EMAIL,
    ownerPassword: seedEnv.SEED_OWNER_PASSWORD,
    ownerPin: seedEnv.SEED_OWNER_PIN,
    staffPin: seedEnv.SEED_STAFF_PIN,
    counterDeviceToken: seedEnv.SEED_COUNTER_DEVICE_TOKEN,
    tokenHashPepper: env.TOKEN_HASH_PEPPER,
  });

  console.log("Seed complete. Rows created (0 = already present):");
  console.table(summary);
  console.log("QR links (print these for the tables):");
  for (const qr of await activeQrTokens(db)) {
    console.log(`  ${qr.label.padEnd(12)} ${env.APP_BASE_URL}/o/${qr.token}`);
  }
}

main()
  .catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  })
  .finally(closeSql);
