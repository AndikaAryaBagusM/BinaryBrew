import { eq } from "drizzle-orm";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { closeSql, getDb } from "@/db/client";
import * as schema from "@/db/schema";
import {
  consumeElevation,
  elevate,
  getSession,
  listPinUsers,
  logout,
  ownerLogin,
  pinLogin,
  registerDevice,
  requireRole,
  resetAuthRateLimits,
  revokeUserSessions,
} from "@/modules/auth/service";
import { at, createDevice, createUser, minutes, unique } from "./auth-fixtures";

afterAll(() => closeSql());
beforeEach(() => resetAuthRateLimits());

const t0 = new Date("2026-10-22T11:00:00Z");
const ip = () => unique("ip");

describe("staff PIN login (Tech §9, FR-POS-03)", () => {
  it("logs in on a registered device and binds the session to it", async () => {
    const user = await createUser();
    const device = await createDevice();

    const login = await pinLogin(
      { userId: user.id, pin: user.pin, deviceToken: device.token, ip: ip() },
      { now: t0 },
    );

    expect(login.user).toMatchObject({
      userId: user.id,
      role: "staff",
      deviceId: device.id,
    });
    expect(await getSession(login.token, { now: t0 })).toEqual(login.user);
  });

  it("locks the user for 5 minutes after 5 wrong PINs", async () => {
    const user = await createUser({ pin: "1234" });
    const device = await createDevice();
    const attempt = (pin: string, now: Date) =>
      pinLogin(
        { userId: user.id, pin, deviceToken: device.token, ip: ip() },
        { now },
      );

    for (const remaining of [4, 3, 2, 1]) {
      await expect(attempt("9999", t0)).rejects.toMatchObject({
        code: "INVALID_CREDENTIALS",
        details: { remainingAttempts: remaining },
      });
    }
    await expect(attempt("9999", t0)).rejects.toMatchObject({
      code: "ACCOUNT_LOCKED",
      details: { lockedUntil: at(t0, minutes(5)).toISOString() },
    });

    // Locked: even the right PIN is refused until the 5 minutes are over.
    await expect(
      attempt("1234", at(t0, minutes(5) - 1000)),
    ).rejects.toMatchObject({ code: "ACCOUNT_LOCKED" });
    await expect(attempt("1234", at(t0, minutes(5)))).resolves.toBeDefined();

    // A successful login clears the counter.
    const [row] = await getDb()
      .select()
      .from(schema.users)
      .where(eq(schema.users.id, user.id));
    expect(row).toMatchObject({ failedPinAttempts: 0, lockedUntil: null });
  });

  it("fails on an unregistered or revoked browser without counting an attempt", async () => {
    const user = await createUser();
    const revoked = await createDevice({ revoked: true });

    for (const deviceToken of [
      undefined,
      "not-a-device-token",
      revoked.token,
    ]) {
      await expect(
        pinLogin({ userId: user.id, pin: user.pin, deviceToken, ip: ip() }),
      ).rejects.toMatchObject({ code: "DEVICE_NOT_REGISTERED" });
    }

    const [row] = await getDb()
      .select()
      .from(schema.users)
      .where(eq(schema.users.id, user.id));
    expect(row!.failedPinAttempts).toBe(0);
  });

  it("refuses inactive users", async () => {
    const user = await createUser({ isActive: false });
    const device = await createDevice();
    await expect(
      pinLogin({
        userId: user.id,
        pin: user.pin,
        deviceToken: device.token,
        ip: ip(),
      }),
    ).rejects.toMatchObject({ code: "INVALID_CREDENTIALS" });
  });

  it("lists active users for the name picker only on a registered device", async () => {
    const active = await createUser();
    const inactive = await createUser({ isActive: false });
    const device = await createDevice();

    const users = await listPinUsers(device.token);
    expect(users).toContainEqual({
      id: active.id,
      name: active.name,
      role: "staff",
    });
    expect(users.map((u) => u.id)).not.toContain(inactive.id);
    expect(Object.keys(users[0]!).sort()).toEqual(["id", "name", "role"]);

    await expect(listPinUsers(undefined)).rejects.toMatchObject({
      code: "DEVICE_NOT_REGISTERED",
    });
  });
});

describe("owner email and password login (FR-OW-01)", () => {
  it("logs in with the right email (any case) and password", async () => {
    const owner = await createUser({ role: "owner" });
    const login = await ownerLogin(
      { email: owner.email!.toUpperCase(), password: owner.password, ip: ip() },
      { now: t0 },
    );
    expect(login.user).toMatchObject({
      userId: owner.id,
      role: "owner",
      deviceId: null,
    });
  });

  it("gives the same error for an unknown email and a wrong password", async () => {
    const owner = await createUser({ role: "owner" });
    await expect(
      ownerLogin({ email: owner.email!, password: "wrong password", ip: ip() }),
    ).rejects.toMatchObject({ code: "INVALID_CREDENTIALS" });
    await expect(
      ownerLogin({
        email: "nobody@test.local",
        password: owner.password,
        ip: ip(),
      }),
    ).rejects.toMatchObject({ code: "INVALID_CREDENTIALS" });
  });

  it("rate limits 5 failures per 15 minutes per account and per IP", async () => {
    const owner = await createUser({ role: "owner" });
    for (let i = 0; i < 5; i++) {
      await expect(
        ownerLogin(
          { email: owner.email!, password: "wrong", ip: ip() },
          { now: t0 },
        ),
      ).rejects.toMatchObject({ code: "INVALID_CREDENTIALS" });
    }
    // Account limit: even the right password from a new IP is refused.
    await expect(
      ownerLogin(
        { email: owner.email!, password: owner.password, ip: ip() },
        { now: at(t0, minutes(1)) },
      ),
    ).rejects.toMatchObject({ code: "RATE_LIMITED" });
    await expect(
      ownerLogin(
        { email: owner.email!, password: owner.password, ip: ip() },
        { now: at(t0, minutes(15) + 1000) },
      ),
    ).resolves.toBeDefined();

    // IP limit: failures against different accounts from one address.
    const sameIp = ip();
    for (let i = 0; i < 5; i++) {
      await expect(
        ownerLogin(
          { email: `${unique("x")}@test.local`, password: "wrong", ip: sameIp },
          { now: t0 },
        ),
      ).rejects.toMatchObject({ code: "INVALID_CREDENTIALS" });
    }
    await expect(
      ownerLogin(
        { email: owner.email!, password: owner.password, ip: sameIp },
        { now: t0 },
      ),
    ).rejects.toMatchObject({ code: "RATE_LIMITED" });
  });
});

describe("sessions (Tech §9)", () => {
  it("stores only a keyed hash of the cookie value", async () => {
    const owner = await createUser({ role: "owner" });
    const { token, user } = await ownerLogin({
      email: owner.email!,
      password: owner.password,
      ip: ip(),
    });
    const [row] = await getDb()
      .select()
      .from(schema.sessions)
      .where(eq(schema.sessions.id, user.sessionId));
    expect(row!.tokenHash).toMatch(/^[0-9a-f]{64}$/);
    expect(row!.tokenHash).not.toContain(token);
  });

  it("can be revoked by logout and for all of a user's sessions", async () => {
    const owner = await createUser({ role: "owner" });
    const login = () =>
      ownerLogin({ email: owner.email!, password: owner.password, ip: ip() });

    const first = await login();
    await logout(first.token);
    expect(await getSession(first.token)).toBeNull();

    const second = await login();
    const third = await login();
    expect(await revokeUserSessions(owner.id)).toBe(2);
    expect(await getSession(second.token)).toBeNull();
    expect(await getSession(third.token)).toBeNull();
  });

  it("expires after 8 hours idle or 12 hours in total", async () => {
    const owner = await createUser({ role: "owner" });
    const { token } = await ownerLogin(
      { email: owner.email!, password: owner.password, ip: ip() },
      { now: t0 },
    );

    // Activity at 7 h keeps it alive; 8 h after the last activity it is gone.
    expect(
      await getSession(token, { now: at(t0, minutes(7 * 60)) }),
    ).not.toBeNull();
    expect(
      await getSession(token, { now: at(t0, minutes(11 * 60)) }),
    ).not.toBeNull();
    expect(
      await getSession(token, { now: at(t0, minutes(12 * 60)) }),
    ).toBeNull();

    const idle = await ownerLogin(
      { email: owner.email!, password: owner.password, ip: ip() },
      { now: t0 },
    );
    expect(
      await getSession(idle.token, { now: at(t0, minutes(8 * 60)) }),
    ).toBeNull();
  });

  it("ends when the user is deactivated or the device is revoked", async () => {
    const user = await createUser();
    const device = await createDevice();
    const login = () =>
      pinLogin({
        userId: user.id,
        pin: user.pin,
        deviceToken: device.token,
        ip: ip(),
      });

    const onDevice = await login();
    await getDb()
      .update(schema.devices)
      .set({ revokedAt: new Date() })
      .where(eq(schema.devices.id, device.id));
    expect(await getSession(onDevice.token)).toBeNull();

    const owner = await createUser({ role: "owner" });
    const ownerSession = await ownerLogin({
      email: owner.email!,
      password: owner.password,
      ip: ip(),
    });
    await getDb()
      .update(schema.users)
      .set({ isActive: false })
      .where(eq(schema.users.id, owner.id));
    expect(await getSession(ownerSession.token)).toBeNull();
  });
});

describe("requireRole (Tech §9)", () => {
  it("passes allowed roles and refuses the rest", async () => {
    const user = await createUser({ role: "barista" });
    const device = await createDevice();
    const { user: actor } = await pinLogin({
      userId: user.id,
      pin: user.pin,
      deviceToken: device.token,
      ip: ip(),
    });

    expect(requireRole(actor, ["staff", "barista"])).toBe(actor);
    expect(() => requireRole(actor, ["owner"])).toThrow(
      expect.objectContaining({ code: "FORBIDDEN" }),
    );
    expect(() => requireRole(null, ["owner"])).toThrow(
      expect.objectContaining({ code: "UNAUTHENTICATED" }),
    );
  });
});

describe("device registration (FR-OW-05)", () => {
  it("lets only the owner register a device, storing only the token hash", async () => {
    const owner = await createUser({ role: "owner" });
    const { user: actor } = await ownerLogin({
      email: owner.email!,
      password: owner.password,
      ip: ip(),
    });

    const { deviceToken, deviceId } = await registerDevice(actor, {
      name: "Tablet kasir 2",
    });
    const [row] = await getDb()
      .select()
      .from(schema.devices)
      .where(eq(schema.devices.id, deviceId));
    expect(row).toMatchObject({
      name: "Tablet kasir 2",
      kind: "counter",
      registeredBy: owner.id,
    });
    expect(row!.tokenHash).not.toContain(deviceToken);
    await expect(listPinUsers(deviceToken)).resolves.toBeInstanceOf(Array);

    const staff = await createUser();
    const staffLogin = await pinLogin({
      userId: staff.id,
      pin: staff.pin,
      deviceToken,
      ip: ip(),
    });
    await expect(
      registerDevice(staffLogin.user, { name: "Sneaky tablet" }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
  });
});

describe("owner PIN elevation (Tech §9, Flow §8)", () => {
  // Elevation checks the PIN of the active owner, so each test starts with
  // exactly one active owner. Integration files run one at a time.
  let owner: Awaited<ReturnType<typeof createUser>>;
  let staffActor: Awaited<ReturnType<typeof pinLogin>>["user"];

  beforeEach(async () => {
    await getDb()
      .update(schema.users)
      .set({ isActive: false })
      .where(eq(schema.users.role, "owner"));
    owner = await createUser({ role: "owner", pin: "135790" });
    const staff = await createUser();
    const device = await createDevice();
    ({ user: staffActor } = await pinLogin({
      userId: staff.id,
      pin: staff.pin,
      deviceToken: device.token,
      ip: ip(),
    }));
  });

  it("works once for its scope and session", async () => {
    const { elevationId, expiresAt } = await elevate(
      staffActor,
      { pin: "135790", scope: "manual_payment" },
      { now: t0 },
    );
    expect(expiresAt).toEqual(at(t0, 60_000));

    await expect(
      consumeElevation(
        staffActor,
        { elevationId, scope: "void_order" },
        { now: t0 },
      ),
    ).rejects.toMatchObject({ code: "ELEVATION_REQUIRED" });

    await expect(
      consumeElevation(
        staffActor,
        { elevationId, scope: "manual_payment" },
        { now: at(t0, 30_000) },
      ),
    ).resolves.toEqual({ elevationId, ownerUserId: owner.id });

    await expect(
      consumeElevation(
        staffActor,
        { elevationId, scope: "manual_payment" },
        { now: at(t0, 31_000) },
      ),
    ).rejects.toMatchObject({ code: "ELEVATION_REQUIRED" });
  });

  it("expires after 60 seconds", async () => {
    const { elevationId } = await elevate(
      staffActor,
      { pin: "135790", scope: "void_order" },
      { now: t0 },
    );
    await expect(
      consumeElevation(
        staffActor,
        { elevationId, scope: "void_order" },
        { now: at(t0, 60_000) },
      ),
    ).rejects.toMatchObject({ code: "ELEVATION_REQUIRED" });
  });

  it("cannot be used from another session", async () => {
    const { elevationId } = await elevate(
      staffActor,
      { pin: "135790", scope: "void_order" },
      { now: t0 },
    );
    const { user: ownerActor } = await ownerLogin({
      email: owner.email!,
      password: owner.password,
      ip: ip(),
    });
    await expect(
      consumeElevation(
        ownerActor,
        { elevationId, scope: "void_order" },
        { now: t0 },
      ),
    ).rejects.toMatchObject({ code: "ELEVATION_REQUIRED" });
  });

  it("lets the signed-in owner confirm with their own PIN", async () => {
    const { user: ownerActor } = await ownerLogin({
      email: owner.email!,
      password: owner.password,
      ip: ip(),
    });
    const { elevationId } = await elevate(
      ownerActor,
      { pin: "135790", scope: "stock_adjustment" },
      { now: t0 },
    );
    await expect(
      consumeElevation(
        ownerActor,
        { elevationId, scope: "stock_adjustment" },
        { now: t0 },
      ),
    ).resolves.toMatchObject({ ownerUserId: owner.id });
  });

  it("counts a wrong owner PIN toward the owner's lockout", async () => {
    for (let i = 0; i < 4; i++) {
      await expect(
        elevate(
          staffActor,
          { pin: "000000", scope: "void_order" },
          { now: t0 },
        ),
      ).rejects.toMatchObject({ code: "INVALID_CREDENTIALS" });
    }
    await expect(
      elevate(staffActor, { pin: "000000", scope: "void_order" }, { now: t0 }),
    ).rejects.toMatchObject({ code: "ACCOUNT_LOCKED" });
    await expect(
      elevate(staffActor, { pin: "135790", scope: "void_order" }, { now: t0 }),
    ).rejects.toMatchObject({ code: "ACCOUNT_LOCKED" });
  });
});
