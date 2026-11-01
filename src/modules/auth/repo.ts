import { and, asc, eq, gt, isNull, max, sql } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import { type DbExecutor, getDb } from "@/db/client";
import { devices, elevations, sessions, users } from "@/db/schema";

// SQL only; the rules live in service.ts (Tech §4 rule 2).

export async function findUserById(id: string, db: DbExecutor = getDb()) {
  const [user] = await db.select().from(users).where(eq(users.id, id));
  return user;
}

export async function findOwnerByEmail(
  email: string,
  db: DbExecutor = getDb(),
) {
  const [user] = await db
    .select()
    .from(users)
    .where(
      and(
        eq(sql`lower(${users.email})`, email.toLowerCase()),
        eq(users.role, "owner"),
      ),
    );
  return user;
}

export function findActiveOwners(db: DbExecutor = getDb()) {
  return db
    .select()
    .from(users)
    .where(and(eq(users.role, "owner"), eq(users.isActive, true)));
}

export function listActiveUsers(db: DbExecutor = getDb()) {
  return db
    .select({ id: users.id, name: users.name, role: users.role })
    .from(users)
    .where(eq(users.isActive, true))
    .orderBy(asc(users.name));
}

// O-13: every user, with the last time any of their sessions was used.
export function listUsersWithActivity(db: DbExecutor = getDb()) {
  return db
    .select({
      id: users.id,
      name: users.name,
      role: users.role,
      isActive: users.isActive,
      lastActiveAt: max(sessions.lastActivityAt),
    })
    .from(users)
    .leftJoin(sessions, eq(sessions.userId, users.id))
    .groupBy(users.id)
    .orderBy(asc(users.role), asc(users.name));
}

// Serialises user creation, so two owners' tabs cannot both pass the
// duplicate-name check.
export async function lockUserNames(db: DbExecutor) {
  await db.execute(
    sql`select pg_advisory_xact_lock(hashtextextended('users.name', 0))`,
  );
}

export async function findActiveUserByName(name: string, db: DbExecutor) {
  const [user] = await db
    .select({ id: users.id })
    .from(users)
    .where(
      and(
        eq(sql`lower(${users.name})`, name.toLowerCase()),
        eq(users.isActive, true),
      ),
    );
  return user;
}

export async function insertUser(
  values: {
    name: string;
    role: "staff" | "barista";
    pinHash: string;
    now: Date;
  },
  db: DbExecutor,
) {
  const [user] = await db
    .insert(users)
    .values({
      name: values.name,
      role: values.role,
      pinHash: values.pinHash,
      createdAt: values.now,
      updatedAt: values.now,
    })
    .returning({ id: users.id, name: users.name, role: users.role });
  return user!;
}

// A new PIN also lifts any lockout.
export async function setUserPin(
  id: string,
  pinHash: string,
  now: Date,
  db: DbExecutor,
) {
  const rows = await db
    .update(users)
    .set({ pinHash, failedPinAttempts: 0, lockedUntil: null, updatedAt: now })
    .where(eq(users.id, id))
    .returning({ id: users.id, name: users.name });
  return rows[0];
}

// O-13 devices, newest first, with who registered each one.
export function listDevicesWithRegistrar(db: DbExecutor = getDb()) {
  const registrar = alias(users, "registrar");
  return db
    .select({
      id: devices.id,
      name: devices.name,
      kind: devices.kind,
      registeredAt: devices.registeredAt,
      registeredByName: registrar.name,
      lastSeenAt: devices.lastSeenAt,
      revokedAt: devices.revokedAt,
    })
    .from(devices)
    .leftJoin(registrar, eq(registrar.id, devices.registeredBy))
    .orderBy(asc(devices.registeredAt));
}

// One atomic update, so parallel wrong PINs are all counted. On the attempt
// that reaches the limit the counter restarts and the lock is set.
export async function recordPinFailure(
  userId: string,
  options: { maxAttempts: number; lockedUntil: Date; now: Date },
  db: DbExecutor = getDb(),
) {
  const reachesLimit = sql`${users.failedPinAttempts} + 1 >= ${options.maxAttempts}`;
  const [row] = await db
    .update(users)
    .set({
      failedPinAttempts: sql`case when ${reachesLimit} then 0 else ${users.failedPinAttempts} + 1 end`,
      lockedUntil: sql`case when ${reachesLimit} then ${options.lockedUntil.toISOString()}::timestamptz else null end`,
      updatedAt: options.now,
    })
    .where(eq(users.id, userId))
    .returning({
      failedPinAttempts: users.failedPinAttempts,
      lockedUntil: users.lockedUntil,
    });
  return row!;
}

export async function clearPinFailures(
  userId: string,
  now: Date,
  db: DbExecutor = getDb(),
) {
  await db
    .update(users)
    .set({ failedPinAttempts: 0, lockedUntil: null, updatedAt: now })
    .where(eq(users.id, userId));
}

export async function findDeviceByTokenHash(
  tokenHash: string,
  db: DbExecutor = getDb(),
) {
  const [device] = await db
    .select()
    .from(devices)
    .where(eq(devices.tokenHash, tokenHash));
  return device;
}

export async function insertDevice(
  values: { name: string; tokenHash: string; registeredBy: string; now: Date },
  db: DbExecutor = getDb(),
) {
  const [device] = await db
    .insert(devices)
    .values({
      name: values.name,
      kind: "counter",
      tokenHash: values.tokenHash,
      registeredBy: values.registeredBy,
      registeredAt: values.now,
    })
    .returning({ id: devices.id, name: devices.name });
  return device!;
}

export async function touchDevice(
  id: string,
  now: Date,
  db: DbExecutor = getDb(),
) {
  await db.update(devices).set({ lastSeenAt: now }).where(eq(devices.id, id));
}

export async function insertSession(
  values: {
    userId: string;
    deviceId: string | null;
    tokenHash: string;
    now: Date;
    expiresAt: Date;
  },
  db: DbExecutor = getDb(),
) {
  const [session] = await db
    .insert(sessions)
    .values({
      userId: values.userId,
      deviceId: values.deviceId,
      tokenHash: values.tokenHash,
      createdAt: values.now,
      lastActivityAt: values.now,
      expiresAt: values.expiresAt,
    })
    .returning({ id: sessions.id });
  return session!;
}

export async function findSessionByTokenHash(
  tokenHash: string,
  db: DbExecutor = getDb(),
) {
  const [row] = await db
    .select({
      sessionId: sessions.id,
      expiresAt: sessions.expiresAt,
      lastActivityAt: sessions.lastActivityAt,
      revokedAt: sessions.revokedAt,
      deviceId: sessions.deviceId,
      deviceRevokedAt: devices.revokedAt,
      userId: users.id,
      name: users.name,
      role: users.role,
      userIsActive: users.isActive,
    })
    .from(sessions)
    .innerJoin(users, eq(users.id, sessions.userId))
    .leftJoin(devices, eq(devices.id, sessions.deviceId))
    .where(eq(sessions.tokenHash, tokenHash));
  return row;
}

export async function touchSession(
  id: string,
  now: Date,
  db: DbExecutor = getDb(),
) {
  await db
    .update(sessions)
    .set({ lastActivityAt: now })
    .where(eq(sessions.id, id));
}

export async function revokeSessionByTokenHash(
  tokenHash: string,
  now: Date,
  db: DbExecutor = getDb(),
) {
  await db
    .update(sessions)
    .set({ revokedAt: now })
    .where(and(eq(sessions.tokenHash, tokenHash), isNull(sessions.revokedAt)));
}

export async function revokeSessionsOfUser(
  userId: string,
  now: Date,
  db: DbExecutor = getDb(),
) {
  const rows = await db
    .update(sessions)
    .set({ revokedAt: now })
    .where(and(eq(sessions.userId, userId), isNull(sessions.revokedAt)))
    .returning({ id: sessions.id });
  return rows.length;
}

export async function insertElevation(
  values: {
    sessionId: string;
    ownerUserId: string;
    scope: string;
    now: Date;
    expiresAt: Date;
  },
  db: DbExecutor = getDb(),
) {
  const [elevation] = await db
    .insert(elevations)
    .values({
      sessionId: values.sessionId,
      ownerUserId: values.ownerUserId,
      scope: values.scope,
      createdAt: values.now,
      expiresAt: values.expiresAt,
    })
    .returning({ id: elevations.id, expiresAt: elevations.expiresAt });
  return elevation!;
}

// Single statement: an elevation can only ever be used once, even when two
// requests race for it.
export async function useElevation(
  values: { id: string; sessionId: string; scope: string; now: Date },
  db: DbExecutor = getDb(),
) {
  const [row] = await db
    .update(elevations)
    .set({ usedAt: values.now })
    .where(
      and(
        eq(elevations.id, values.id),
        eq(elevations.sessionId, values.sessionId),
        eq(elevations.scope, values.scope),
        isNull(elevations.usedAt),
        gt(elevations.expiresAt, values.now),
      ),
    )
    .returning({ ownerUserId: elevations.ownerUserId });
  return row;
}
