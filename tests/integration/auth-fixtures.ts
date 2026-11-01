import { randomUUID } from "node:crypto";
import { getDb } from "@/db/client";
import * as schema from "@/db/schema";
import { newSecretToken } from "@/lib/ids";
import { getEnv } from "@/lib/env";
import { hashSecret, hashToken } from "@/modules/auth/hashing";

// Test data for the auth tests. Names and emails are unique per call because
// integration test files share one database per run.
export const unique = (prefix: string) =>
  `${prefix}-${randomUUID().slice(0, 8)}`;

export async function createUser(
  options: {
    role?: "owner" | "staff" | "barista";
    pin?: string;
    password?: string;
    isActive?: boolean;
  } = {},
) {
  const role = options.role ?? "staff";
  const pin = options.pin ?? "1234";
  const password = options.password ?? "correct horse battery";
  const email = role === "owner" ? `${unique("owner")}@test.local` : null;
  const [user] = await getDb()
    .insert(schema.users)
    .values({
      name: unique(role),
      role,
      email,
      passwordHash: role === "owner" ? await hashSecret(password) : null,
      pinHash: await hashSecret(pin),
      isActive: options.isActive ?? true,
    })
    .returning();
  return { ...user!, pin, password };
}

export async function createDevice(options: { revoked?: boolean } = {}) {
  const token = newSecretToken();
  const [device] = await getDb()
    .insert(schema.devices)
    .values({
      name: unique("tablet"),
      tokenHash: hashToken(token, getEnv().TOKEN_HASH_PEPPER),
      revokedAt: options.revoked ? new Date() : null,
    })
    .returning();
  return { ...device!, token };
}

export const minutes = (n: number) => n * 60_000;
export const at = (base: Date, offsetMs: number) =>
  new Date(base.getTime() + offsetMs);
