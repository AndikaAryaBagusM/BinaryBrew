import type { DbExecutor } from "@/db/client";
import { getEnv } from "@/lib/env";
import { AppError } from "@/lib/errors";
import { newSecretToken } from "@/lib/ids";
import { logger } from "@/lib/logger";
import { hashSecret, hashToken, verifySecret } from "./hashing";
import { createRateLimiter } from "./rate-limit";
import * as repo from "./repo";

// Auth rules (Tech §9, PRD A3–A5). Every function takes an optional `now` so
// tests can move the clock; production callers leave it out.

export type UserRole = "owner" | "staff" | "barista";

export type SessionUser = {
  sessionId: string;
  userId: string;
  name: string;
  role: UserRole;
  deviceId: string | null;
};

export type Login = { token: string; expiresAt: Date; user: SessionUser };

type Clock = { now?: Date };

export const elevationScopes = [
  "void_order",
  "manual_payment",
  "stock_adjustment",
  "refund_processed",
] as const;
export type ElevationScope = (typeof elevationScopes)[number];

export const SESSION_MAX_AGE_MS = 12 * 60 * 60_000;
const SESSION_IDLE_MS = 8 * 60 * 60_000;
const SESSION_TOUCH_INTERVAL_MS = 60_000;
const MAX_PIN_ATTEMPTS = 5;
const PIN_LOCK_MS = 5 * 60_000;
const ELEVATION_TTL_MS = 60_000;

const FIFTEEN_MINUTES = 15 * 60_000;
const ownerFailuresByAccount = createRateLimiter({
  limit: 5,
  windowMs: FIFTEEN_MINUTES,
});
const ownerFailuresByIp = createRateLimiter({
  limit: 5,
  windowMs: FIFTEEN_MINUTES,
});
// Per-user lockout is the main PIN defence; this caps guessing across users.
const pinFailuresByIp = createRateLimiter({
  limit: 30,
  windowMs: FIFTEEN_MINUTES,
});

export function resetAuthRateLimits() {
  ownerFailuresByAccount.clear();
  ownerFailuresByIp.clear();
  pinFailuresByIp.clear();
}

const tokenHash = (token: string) =>
  hashToken(token, getEnv().TOKEN_HASH_PEPPER);

// Verifying against a real argon2 hash when the email is unknown keeps the
// response time the same, so it does not reveal which emails exist.
let dummyHash: Promise<string> | undefined;
const getDummyHash = () =>
  (dummyHash ??= hashSecret("binary-brew-timing-guard"));

export function requireRole(
  actor: SessionUser | null | undefined,
  roles: readonly UserRole[],
): SessionUser {
  if (!actor) throw new AppError("UNAUTHENTICATED");
  if (!roles.includes(actor.role)) throw new AppError("FORBIDDEN");
  return actor;
}

async function createSession(
  user: { id: string; name: string; role: UserRole },
  deviceId: string | null,
  now: Date,
): Promise<Login> {
  const token = newSecretToken();
  const expiresAt = new Date(now.getTime() + SESSION_MAX_AGE_MS);
  const session = await repo.insertSession({
    userId: user.id,
    deviceId,
    tokenHash: tokenHash(token),
    now,
    expiresAt,
  });
  return {
    token,
    expiresAt,
    user: {
      sessionId: session.id,
      userId: user.id,
      name: user.name,
      role: user.role,
      deviceId,
    },
  };
}

export async function ownerLogin(
  input: { email: string; password: string; ip: string },
  { now = new Date() }: Clock = {},
): Promise<Login> {
  const email = input.email.trim().toLowerCase();
  const ms = now.getTime();
  if (
    ownerFailuresByAccount.isLimited(email, ms) ||
    ownerFailuresByIp.isLimited(input.ip, ms)
  ) {
    throw new AppError("RATE_LIMITED");
  }

  const user = await repo.findOwnerByEmail(email);
  const passwordOk = user?.passwordHash
    ? await verifySecret(user.passwordHash, input.password)
    : (await verifySecret(await getDummyHash(), input.password), false);

  if (!user || !user.isActive || !passwordOk) {
    ownerFailuresByAccount.hit(email, ms);
    ownerFailuresByIp.hit(input.ip, ms);
    logger.warn({ event: "auth.owner_login_failed" });
    throw new AppError("INVALID_CREDENTIALS");
  }

  ownerFailuresByAccount.reset(email);
  logger.info({ event: "auth.owner_login", userId: user.id });
  return createSession(user, null, now);
}

async function findRegisteredDevice(deviceToken: string | undefined) {
  if (!deviceToken) return undefined;
  const device = await repo.findDeviceByTokenHash(tokenHash(deviceToken));
  return device && !device.revokedAt ? device : undefined;
}

type PinUser = {
  id: string;
  pinHash: string;
  failedPinAttempts: number;
  lockedUntil: Date | null;
};

const lockedError = (lockedUntil: Date) =>
  new AppError("ACCOUNT_LOCKED", {
    details: { lockedUntil: lockedUntil.toISOString() },
  });

const isLocked = (user: PinUser, now: Date) =>
  user.lockedUntil !== null && user.lockedUntil > now;

// Checks a PIN against one or more users (several only when the shop has more
// than one owner). A wrong PIN counts toward the lockout of every user checked.
async function verifyPin<T extends PinUser>(
  candidates: T[],
  pin: string,
  now: Date,
): Promise<T> {
  const open = candidates.filter((user) => !isLocked(user, now));
  if (open.length === 0) {
    const earliest = Math.min(
      ...candidates.map((u) => u.lockedUntil!.getTime()),
    );
    throw lockedError(new Date(earliest));
  }

  for (const user of open) {
    if (await verifySecret(user.pinHash, pin)) {
      if (user.failedPinAttempts > 0 || user.lockedUntil !== null) {
        await repo.clearPinFailures(user.id, now);
      }
      return user;
    }
  }

  const lockedUntil = new Date(now.getTime() + PIN_LOCK_MS);
  const results = await Promise.all(
    open.map((user) =>
      repo.recordPinFailure(user.id, {
        maxAttempts: MAX_PIN_ATTEMPTS,
        lockedUntil,
        now,
      }),
    ),
  );
  if (results.every((row) => row.lockedUntil !== null)) {
    logger.warn({ event: "auth.pin_locked", userIds: open.map((u) => u.id) });
    throw lockedError(lockedUntil);
  }
  const remainingAttempts = Math.min(
    ...results
      .filter((row) => row.lockedUntil === null)
      .map((row) => MAX_PIN_ATTEMPTS - row.failedPinAttempts),
  );
  throw new AppError("INVALID_CREDENTIALS", { details: { remainingAttempts } });
}

export async function pinLogin(
  input: {
    userId: string;
    pin: string;
    deviceToken: string | undefined;
    ip: string;
  },
  { now = new Date() }: Clock = {},
): Promise<Login> {
  const device = await findRegisteredDevice(input.deviceToken);
  if (!device) throw new AppError("DEVICE_NOT_REGISTERED");

  const ms = now.getTime();
  if (pinFailuresByIp.isLimited(input.ip, ms))
    throw new AppError("RATE_LIMITED");

  const user = await repo.findUserById(input.userId);
  if (!user || !user.isActive) {
    pinFailuresByIp.hit(input.ip, ms);
    throw new AppError("INVALID_CREDENTIALS");
  }

  try {
    await verifyPin([user], input.pin, now);
  } catch (error) {
    pinFailuresByIp.hit(input.ip, ms);
    throw error;
  }

  await repo.touchDevice(device.id, now);
  logger.info({
    event: "auth.pin_login",
    userId: user.id,
    deviceId: device.id,
  });
  return createSession(user, device.id, now);
}

// Names for the S-01 picker: only on a registered device, only what it shows.
export async function listPinUsers(deviceToken: string | undefined) {
  if (!(await findRegisteredDevice(deviceToken))) {
    throw new AppError("DEVICE_NOT_REGISTERED");
  }
  return repo.listActiveUsers();
}

export async function getSession(
  token: string | undefined,
  { now = new Date() }: Clock = {},
): Promise<SessionUser | null> {
  if (!token) return null;
  const row = await repo.findSessionByTokenHash(tokenHash(token));
  if (
    !row ||
    row.revokedAt !== null ||
    row.expiresAt <= now ||
    row.lastActivityAt.getTime() + SESSION_IDLE_MS <= now.getTime() ||
    !row.userIsActive ||
    row.deviceRevokedAt !== null
  ) {
    return null;
  }

  if (
    now.getTime() - row.lastActivityAt.getTime() >=
    SESSION_TOUCH_INTERVAL_MS
  ) {
    await repo.touchSession(row.sessionId, now);
  }
  return {
    sessionId: row.sessionId,
    userId: row.userId,
    name: row.name,
    role: row.role,
    deviceId: row.deviceId,
  };
}

export async function logout(
  token: string | undefined,
  { now = new Date() }: Clock = {},
) {
  if (token) await repo.revokeSessionByTokenHash(tokenHash(token), now);
}

// For PIN resets and deactivation (P1-13): every open session of the user ends.
export function revokeUserSessions(
  userId: string,
  { now = new Date() }: Clock = {},
) {
  return repo.revokeSessionsOfUser(userId, now);
}

export async function registerDevice(
  actor: SessionUser | null,
  input: { name: string },
  { now = new Date() }: Clock = {},
) {
  const owner = requireRole(actor, ["owner"]);
  const deviceToken = newSecretToken();
  const device = await repo.insertDevice({
    name: input.name,
    tokenHash: tokenHash(deviceToken),
    registeredBy: owner.userId,
    now,
  });
  logger.info({
    event: "auth.device_registered",
    deviceId: device.id,
    userId: owner.userId,
  });
  return { deviceToken, deviceId: device.id, name: device.name };
}

// Owner PIN → one elevation for one scope, valid 60 s and one use (Tech §9,
// Flow §8). A signed-in owner re-enters their own PIN.
export async function elevate(
  actor: SessionUser | null,
  input: { pin: string; scope: ElevationScope },
  { now = new Date() }: Clock = {},
) {
  const requester = requireRole(actor, ["owner", "staff", "barista"]);
  const owners =
    requester.role === "owner"
      ? [await repo.findUserById(requester.userId)].filter(
          (u) => u !== undefined,
        )
      : await repo.findActiveOwners();
  if (owners.length === 0) throw new AppError("FORBIDDEN");

  const owner = await verifyPin(owners, input.pin, now);
  const elevation = await repo.insertElevation({
    sessionId: requester.sessionId,
    ownerUserId: owner.id,
    scope: input.scope,
    now,
    expiresAt: new Date(now.getTime() + ELEVATION_TTL_MS),
  });
  return { elevationId: elevation.id, expiresAt: elevation.expiresAt };
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Called by sensitive services, inside their own transaction (pass `db`), so
// the elevation is spent only if the action commits.
export async function consumeElevation(
  actor: SessionUser | null,
  input: { elevationId: string; scope: ElevationScope },
  { now = new Date(), db }: Clock & { db?: DbExecutor } = {},
) {
  const requester = requireRole(actor, ["owner", "staff", "barista"]);
  if (!UUID.test(input.elevationId)) throw new AppError("ELEVATION_REQUIRED");
  const used = await repo.useElevation(
    {
      id: input.elevationId,
      sessionId: requester.sessionId,
      scope: input.scope,
      now,
    },
    db,
  );
  if (!used) throw new AppError("ELEVATION_REQUIRED");
  return { elevationId: input.elevationId, ownerUserId: used.ownerUserId };
}
