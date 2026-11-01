import { desc, eq, sql } from "drizzle-orm";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { closeSql, getDb } from "@/db/client";
import * as schema from "@/db/schema";
import { audit } from "@/modules/audit/service";
import {
  elevate,
  ownerLogin,
  pinLogin,
  registerDevice,
  resetAuthRateLimits,
} from "@/modules/auth/service";
import { defaultSettings } from "@/modules/settings/definitions";
import {
  getAllSettings,
  getSetting,
  getSettings,
  setSetting,
} from "@/modules/settings/service";
import { createDevice, createUser, unique } from "./auth-fixtures";

afterAll(() => closeSql());
beforeEach(async () => {
  resetAuthRateLimits();
  await getDb().delete(schema.settings);
});

async function ownerActor() {
  const owner = await createUser({ role: "owner" });
  const { user } = await ownerLogin({
    email: owner.email!,
    password: owner.password,
    ip: unique("ip"),
  });
  return user;
}

async function staffActor() {
  const staff = await createUser();
  const device = await createDevice();
  const { user } = await pinLogin({
    userId: staff.id,
    pin: staff.pin,
    deviceToken: device.token,
    ip: unique("ip"),
  });
  return user;
}

const auditRowsFor = (entityType: string, entityId: string) =>
  getDb()
    .select()
    .from(schema.auditLogs)
    .where(
      sql`${schema.auditLogs.entityType} = ${entityType} and ${schema.auditLogs.entityId} = ${entityId}`,
    )
    .orderBy(desc(schema.auditLogs.id));

describe("settings (P1-02, FR-OW-04)", () => {
  it("falls back to the §3.9 defaults when no row exists", async () => {
    expect(await getAllSettings()).toEqual(defaultSettings);
    expect(await getSetting("order_expiry_minutes")).toBe(10);
  });

  it("round-trips each type: number, boolean, string", async () => {
    const owner = await ownerActor();
    await setSetting(owner, "tax_rate_bps", 1100);
    await setSetting(owner, "ordering_enabled", false);
    await setSetting(owner, "business_day_cutoff", "05:00");
    await setSetting(owner, "reco_min_confidence", 0.3);

    const values = await getSettings([
      "tax_rate_bps",
      "ordering_enabled",
      "business_day_cutoff",
      "reco_min_confidence",
      "service_charge_bps",
    ]);
    expect(values).toEqual({
      tax_rate_bps: 1100,
      ordering_enabled: false,
      business_day_cutoff: "05:00",
      reco_min_confidence: 0.3,
      service_charge_bps: 0,
    });
    expect(typeof values.tax_rate_bps).toBe("number");
    expect(typeof values.ordering_enabled).toBe("boolean");

    const [row] = await getDb()
      .select()
      .from(schema.settings)
      .where(eq(schema.settings.key, "tax_rate_bps"));
    expect(row).toMatchObject({ value: 1100, updatedBy: owner.userId });
  });

  it("rejects invalid values and unknown keys without writing", async () => {
    const owner = await ownerActor();
    for (const [key, value] of [
      ["tax_rate_bps", -5],
      ["tax_rate_bps", "1100"],
      ["business_day_cutoff", "24:30"],
      ["no_such_setting", 1],
    ] as const) {
      await expect(setSetting(owner, key, value)).rejects.toMatchObject({
        code: "VALIDATION_FAILED",
      });
    }
    expect(await getDb().select().from(schema.settings)).toEqual([]);
  });

  it("is owner-only", async () => {
    const staff = await staffActor();
    await expect(setSetting(staff, "cash_enabled", true)).rejects.toMatchObject(
      {
        code: "FORBIDDEN",
      },
    );
    await expect(setSetting(null, "cash_enabled", true)).rejects.toMatchObject({
      code: "UNAUTHENTICATED",
    });
  });

  it("refuses to use a stored value of the wrong type", async () => {
    await getDb()
      .insert(schema.settings)
      .values({ key: "tax_rate_bps", value: "eleven percent" });
    await expect(getSetting("tax_rate_bps")).rejects.toMatchObject({
      code: "INTERNAL",
      details: { setting: "tax_rate_bps" },
    });
  });

  it("audits each change with the old and new value, and skips no-ops", async () => {
    const owner = await ownerActor();
    const first = await setSetting(owner, "service_charge_bps", 500, {
      reason: "Biaya layanan baru",
    });
    const second = await setSetting(owner, "service_charge_bps", 750);
    const same = await setSetting(owner, "service_charge_bps", 750);
    expect([first.changed, second.changed, same.changed]).toEqual([
      true,
      true,
      false,
    ]);

    const rows = await auditRowsFor("setting", "service_charge_bps");
    const mine = rows.filter((r) => r.actorUserId === owner.userId);
    expect(mine).toHaveLength(2);
    expect(mine[0]).toMatchObject({
      action: "setting.update",
      metadata: { from: 500, to: 750 },
      reason: null,
    });
    expect(mine[1]).toMatchObject({
      metadata: { from: 0, to: 500 },
      reason: "Biaya layanan baru",
    });
  });
});

describe("audit() (P1-02, Schema §3.7)", () => {
  it("writes a row with actor, device, entity, reason and metadata", async () => {
    const staff = await staffActor();
    const entityId = unique("order");
    const { id } = await audit({
      action: "setting.update",
      actor: staff,
      entity: { type: "test", id: entityId },
      reason: "test",
      metadata: { nested: { ok: true } },
    });

    const [row] = await getDb()
      .select()
      .from(schema.auditLogs)
      .where(eq(schema.auditLogs.id, id));
    expect(row).toMatchObject({
      actorUserId: staff.userId,
      deviceId: staff.deviceId,
      action: "setting.update",
      entityType: "test",
      entityId,
      reason: "test",
      metadata: { nested: { ok: true } },
    });
    expect(row!.createdAt).toBeInstanceOf(Date);
  });

  it("allows a system entry with no actor", async () => {
    const { id } = await audit({ action: "setting.update", actor: null });
    const [row] = await getDb()
      .select()
      .from(schema.auditLogs)
      .where(eq(schema.auditLogs.id, id));
    expect(row).toMatchObject({
      actorUserId: null,
      deviceId: null,
      metadata: {},
    });
  });

  it("cannot be changed or deleted afterwards", async () => {
    const { id } = await audit({ action: "setting.update", actor: null });
    // Drizzle wraps the database error; the trigger's message is the cause.
    const causeOf = async (query: PromiseLike<unknown>) => {
      try {
        await query;
      } catch (error) {
        return String((error as Error).cause);
      }
      throw new Error("expected the query to fail");
    };

    expect(
      await causeOf(
        getDb()
          .update(schema.auditLogs)
          .set({ reason: "rewritten" })
          .where(eq(schema.auditLogs.id, id)),
      ),
    ).toMatch(/audit_logs is append-only/);
    expect(
      await causeOf(
        getDb().delete(schema.auditLogs).where(eq(schema.auditLogs.id, id)),
      ),
    ).toMatch(/audit_logs is append-only/);

    const [row] = await getDb()
      .select()
      .from(schema.auditLogs)
      .where(eq(schema.auditLogs.id, id));
    expect(row!.reason).toBeNull();
  });

  it("is rolled back with the action's transaction", async () => {
    const entityId = unique("rollback");
    await expect(
      getDb().transaction(async (tx) => {
        await audit(
          {
            action: "setting.update",
            actor: null,
            entity: { type: "test", id: entityId },
          },
          { db: tx },
        );
        throw new Error("action failed");
      }),
    ).rejects.toThrow("action failed");
    expect(await auditRowsFor("test", entityId)).toEqual([]);
  });

  it("refuses metadata that looks like a secret", async () => {
    for (const metadata of [
      { pin: "1234" },
      { owner: { passwordHash: "x" } },
      { deviceToken: "abc" },
    ]) {
      await expect(
        audit({ action: "setting.update", actor: null, metadata }),
      ).rejects.toMatchObject({ code: "INTERNAL" });
    }
  });
});

describe("audit entries from auth (P1-01 follow-up)", () => {
  it("records device registration", async () => {
    const owner = await ownerActor();
    const { deviceId } = await registerDevice(owner, { name: "Tablet bar" });
    const [row] = await auditRowsFor("device", deviceId);
    expect(row).toMatchObject({
      action: "device.register",
      actorUserId: owner.userId,
      metadata: { name: "Tablet bar" },
    });
  });

  it("records an elevation grant with the confirming owner", async () => {
    await getDb()
      .update(schema.users)
      .set({ isActive: false })
      .where(eq(schema.users.role, "owner"));
    const owner = await createUser({ role: "owner", pin: "246810" });
    const staff = await staffActor();

    const { elevationId } = await elevate(staff, {
      pin: "246810",
      scope: "manual_payment",
    });
    const [row] = await auditRowsFor("elevation", elevationId);
    expect(row).toMatchObject({
      action: "elevation.grant",
      actorUserId: staff.userId,
      deviceId: staff.deviceId,
      metadata: { scope: "manual_payment", ownerUserId: owner.id },
    });
    expect(JSON.stringify(row)).not.toContain("246810");
  });
});
