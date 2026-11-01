import { and, desc, eq } from "drizzle-orm";
import { NextRequest } from "next/server";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { PATCH as categoryPatch } from "@/app/api/owner/categories/[id]/route";
import { POST as categoriesPost } from "@/app/api/owner/categories/route";
import { GET as devicesGet } from "@/app/api/owner/devices/route";
import { PATCH as menuItemPatch } from "@/app/api/owner/menu-items/[id]/route";
import {
  GET as menuItemsGet,
  POST as menuItemsPost,
} from "@/app/api/owner/menu-items/route";
import {
  GET as settingsGet,
  PUT as settingsPut,
} from "@/app/api/owner/settings/route";
import { POST as pinPost } from "@/app/api/owner/users/[id]/pin/route";
import {
  GET as usersGet,
  POST as usersPost,
} from "@/app/api/owner/users/route";
import { closeSql, getDb } from "@/db/client";
import * as schema from "@/db/schema";
import { SESSION_COOKIE } from "@/modules/auth/cookies";
import {
  createUser as createUserService,
  getSession,
  listUsers,
  ownerLogin,
  pinLogin,
  resetAuthRateLimits,
  resetPin,
  type SessionUser,
} from "@/modules/auth/service";
import {
  createCategory,
  createMenuItem,
  getCounterMenu,
  getOwnerMenu,
  getPublicMenu,
  updateCategory,
  updateMenuItem,
} from "@/modules/menu/service";
import {
  getAllSettings,
  getSettings,
  setSettings,
} from "@/modules/settings/service";
import { createDevice, createUser, unique } from "./auth-fixtures";
import { createCatalog } from "./menu-fixtures";

// P1-13 (FR-OW-01, 02, 04, 05, FR-RC-05): owner-only menu, user, device and
// settings management. A price change reaches the customer menu at once; a
// new staff user can sign in by PIN on a registered device.

afterAll(() => closeSql());
beforeEach(() => resetAuthRateLimits());

let catalog: Awaited<ReturnType<typeof createCatalog>>;
let owner: SessionUser;
let ownerToken: string;
let staffToken: string;
beforeAll(async () => {
  catalog = await createCatalog();
  const ownerRow = await createUser({ role: "owner" });
  const login = await ownerLogin({
    email: ownerRow.email!,
    password: ownerRow.password,
    ip: unique("ip"),
  });
  owner = login.user;
  ownerToken = login.token;
  const staff = await createUser({ role: "staff", pin: "135790" });
  const device = await createDevice();
  staffToken = (
    await pinLogin({
      userId: staff.id,
      pin: staff.pin,
      deviceToken: device.token,
      ip: unique("ip"),
    })
  ).token;
});

const BASE = "http://localhost:3000";

function request(
  path: string,
  options: {
    method?: "GET" | "POST" | "PATCH" | "PUT";
    body?: unknown;
    session?: string;
    origin?: string | null;
  } = {},
) {
  const headers = new Headers({
    host: new URL(BASE).host,
    "content-type": "application/json",
    "x-forwarded-for": unique("ip"),
  });
  const origin = options.origin === undefined ? BASE : options.origin;
  if (origin) headers.set("origin", origin);
  if (options.session) {
    headers.set("cookie", `${SESSION_COOKIE}=${options.session}`);
  }
  return new NextRequest(`${BASE}${path}`, {
    method: options.method ?? "POST",
    headers,
    body: options.body === undefined ? undefined : JSON.stringify(options.body),
  });
}

const params = <T>(value: T) => ({ params: Promise.resolve(value) });

async function lastAudit(action: string, entityId: string) {
  const [row] = await getDb()
    .select()
    .from(schema.auditLogs)
    .where(
      and(
        eq(schema.auditLogs.action, action),
        eq(schema.auditLogs.entityId, entityId),
      ),
    )
    .orderBy(desc(schema.auditLogs.id))
    .limit(1);
  return row;
}

const publicItem = async (id: string) =>
  (await getPublicMenu(catalog.qr.token)).categories
    .flatMap((category) => category.items)
    .find((item) => item.id === id);

describe("owner menu (FR-OW-02, FR-RC-05)", () => {
  it("a price change shows on the customer menu at once and is audited", async () => {
    const item = catalog.items.latte;
    await updateMenuItem(owner, item.id, { price: 27_500 });
    expect((await publicItem(item.id))?.price).toBe(27_500);

    const row = await lastAudit("menu_item.update", item.id);
    expect(row?.actorUserId).toBe(owner.userId);
    expect(row?.metadata).toMatchObject({
      changes: { price: { from: 25_000, to: 27_500 } },
    });
  });

  it("an unchanged update writes nothing", async () => {
    const item = catalog.items.americano;
    const result = await updateMenuItem(owner, item.id, { price: 18_000 });
    expect(result.changed).toEqual([]);
    expect(await lastAudit("menu_item.update", item.id)).toBeUndefined();
  });

  it("creates an item in a new category; Nonaktif hides it everywhere", async () => {
    const category = await createCategory(owner, { name: unique("Musiman") });
    const { id } = await createMenuItem(owner, {
      categoryId: category.id,
      name: "Es Kopi Pandan",
      description: null,
      price: 24_000,
      isActive: true,
      isPromoted: true,
    });
    expect((await publicItem(id))?.price).toBe(24_000);
    expect((await lastAudit("menu_item.create", id))?.metadata).toMatchObject({
      name: "Es Kopi Pandan",
      price: 24_000,
      isPromoted: true,
    });

    await updateMenuItem(owner, id, { isActive: false });
    expect(await publicItem(id)).toBeUndefined();
    const counter = await getCounterMenu(owner);
    expect(
      counter.categories.flatMap((c) => c.items).some((i) => i.id === id),
    ).toBe(false);
    // The owner still sees it, marked inactive.
    const mine = await getOwnerMenu(owner);
    expect(mine.items.find((i) => i.id === id)).toMatchObject({
      isActive: false,
      isPromoted: true,
    });
  });

  it("switching a category off hides its items; the items keep their own flag", async () => {
    const category = await createCategory(owner, { name: unique("Sementara") });
    const { id } = await createMenuItem(owner, {
      categoryId: category.id,
      name: "Teh Tarik",
      description: "Teh susu",
      price: 15_000,
      isActive: true,
      isPromoted: false,
    });
    await updateCategory(owner, category.id, { isActive: false });
    expect(await publicItem(id)).toBeUndefined();
    await updateCategory(owner, category.id, { isActive: true });
    expect(await publicItem(id)).toBeDefined();
    expect(
      (await lastAudit("category.update", category.id))?.metadata,
    ).toMatchObject({ changes: { isActive: { from: false, to: true } } });
  });

  it("refuses a duplicate category name, whatever the case", async () => {
    const name = unique("Kopi");
    await createCategory(owner, { name });
    await expect(
      createCategory(owner, { name: name.toUpperCase() }),
    ).rejects.toMatchObject({ code: "NAME_TAKEN" });
  });

  it("lists every category and item with the sold-out mark", async () => {
    const menu = await getOwnerMenu(owner);
    const ids = new Set(menu.items.map((item) => item.id));
    expect(ids.has(catalog.items.inactive.id)).toBe(true);
    expect(ids.has(catalog.items.archived.id)).toBe(true);
    const hidden = menu.categories.find(
      (c) => c.id === catalog.categories.hidden.id,
    );
    expect(hidden).toMatchObject({ isActive: false });
    expect(
      menu.items.find((item) => item.id === catalog.items.soldOut.id)?.soldOut,
    ).not.toBeNull();
  });

  it("is owner only", async () => {
    const staff = (await getSession(staffToken))!;
    await expect(getOwnerMenu(staff)).rejects.toMatchObject({
      code: "FORBIDDEN",
    });
    await expect(
      updateMenuItem(staff, catalog.items.latte.id, { price: 1 }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(getOwnerMenu(null)).rejects.toMatchObject({
      code: "UNAUTHENTICATED",
    });
  });
});

describe("owner menu routes", () => {
  it("GET lists the menu for the owner, 403 for staff, 401 without a session", async () => {
    const ok = await menuItemsGet(
      request("/api/owner/menu-items", { method: "GET", session: ownerToken }),
    );
    expect(ok.status).toBe(200);
    expect(ok.headers.get("cache-control")).toBe("no-store");
    const staff = await menuItemsGet(
      request("/api/owner/menu-items", { method: "GET", session: staffToken }),
    );
    expect(staff.status).toBe(403);
    const none = await menuItemsGet(
      request("/api/owner/menu-items", { method: "GET" }),
    );
    expect(none.status).toBe(401);
  });

  it("POST creates an item; bad prices and unknown categories are refused", async () => {
    const body = {
      categoryId: catalog.categories.food.id,
      name: unique("Pisang Goreng"),
      price: 12_000,
    };
    const created = await menuItemsPost(
      request("/api/owner/menu-items", { body, session: ownerToken }),
    );
    expect(created.status).toBe(201);

    for (const bad of [
      { ...body, price: 1.5 },
      { ...body, price: -1 },
      { ...body, price: 10_000_001 },
      { ...body, name: " " },
      { ...body, extra: true },
    ]) {
      const response = await menuItemsPost(
        request("/api/owner/menu-items", { body: bad, session: ownerToken }),
      );
      expect(response.status).toBe(400);
    }
    const unknown = await menuItemsPost(
      request("/api/owner/menu-items", {
        body: { ...body, categoryId: crypto.randomUUID() },
        session: ownerToken,
      }),
    );
    expect(unknown.status).toBe(400);
  });

  it("PATCH sets the promoted flag; another origin is refused", async () => {
    const id = catalog.items.croissant.id;
    const response = await menuItemPatch(
      request(`/api/owner/menu-items/${id}`, {
        method: "PATCH",
        body: { isPromoted: true },
        session: ownerToken,
      }),
      params({ id }),
    );
    expect(response.status).toBe(200);
    expect((await response.json()).data.changed).toEqual(["isPromoted"]);

    const foreign = await menuItemPatch(
      request(`/api/owner/menu-items/${id}`, {
        method: "PATCH",
        body: { isPromoted: false },
        session: ownerToken,
        origin: "https://evil.example",
      }),
      params({ id }),
    );
    expect(foreign.status).toBe(403);
    const empty = await menuItemPatch(
      request(`/api/owner/menu-items/${id}`, {
        method: "PATCH",
        body: {},
        session: ownerToken,
      }),
      params({ id }),
    );
    expect(empty.status).toBe(400);
  });

  it("categories: POST creates, PATCH renames, a taken name is 409", async () => {
    const name = unique("Teh");
    const created = await categoriesPost(
      request("/api/owner/categories", { body: { name }, session: ownerToken }),
    );
    expect(created.status).toBe(201);
    const { id } = (await created.json()).data;
    const renamed = await categoryPatch(
      request(`/api/owner/categories/${id}`, {
        method: "PATCH",
        body: { name: `${name} Panas` },
        session: ownerToken,
      }),
      params({ id }),
    );
    expect(renamed.status).toBe(200);
    const taken = await categoryPatch(
      request(`/api/owner/categories/${id}`, {
        method: "PATCH",
        body: { name: catalog.categories.drinks.name },
        session: ownerToken,
      }),
      params({ id }),
    );
    expect(taken.status).toBe(409);
    expect((await taken.json()).error.code).toBe("NAME_TAKEN");
  });
});

describe("users and devices (FR-OW-05)", () => {
  it("a new staff user can sign in by PIN on a registered device", async () => {
    const name = unique("Wulan");
    const user = await createUserService(owner, {
      name,
      role: "staff",
      pin: "246813",
    });
    const device = await createDevice();
    const login = await pinLogin({
      userId: user.id,
      pin: "246813",
      deviceToken: device.token,
      ip: unique("ip"),
    });
    expect(login.user).toMatchObject({ name, role: "staff" });
    expect((await lastAudit("user.create", user.id))?.metadata).toEqual({
      name,
      role: "staff",
    });
  });

  it("refuses an active user's name in another case", async () => {
    const name = unique("Sari");
    await createUserService(owner, { name, role: "barista", pin: "1357" });
    await expect(
      createUserService(owner, {
        name: name.toUpperCase(),
        role: "staff",
        pin: "2468",
      }),
    ).rejects.toMatchObject({ code: "NAME_TAKEN" });
  });

  it("a PIN reset ends the user's sessions, lifts a lockout, and the old PIN fails", async () => {
    const user = await createUser({ role: "barista", pin: "1111" });
    const device = await createDevice();
    const { token } = await pinLogin({
      userId: user.id,
      pin: "1111",
      deviceToken: device.token,
      ip: unique("ip"),
    });
    await getDb()
      .update(schema.users)
      .set({ lockedUntil: new Date(Date.now() + 60_000) })
      .where(eq(schema.users.id, user.id));

    await resetPin(owner, { userId: user.id, pin: "2222" });
    expect(await getSession(token)).toBeNull();
    await expect(
      pinLogin({
        userId: user.id,
        pin: "1111",
        deviceToken: device.token,
        ip: unique("ip"),
      }),
    ).rejects.toMatchObject({ code: "INVALID_CREDENTIALS" });
    const again = await pinLogin({
      userId: user.id,
      pin: "2222",
      deviceToken: device.token,
      ip: unique("ip"),
    });
    expect(again.user.userId).toBe(user.id);

    const row = await lastAudit("user.pin_reset", user.id);
    expect(row?.metadata).toEqual({ name: user.name, sessionsEnded: 1 });
  });

  it("lists users with their last activity", async () => {
    const users = await listUsers(owner);
    const me = users.find((u) => u.id === owner.userId);
    expect(me).toMatchObject({ role: "owner", isActive: true });
    expect(me?.lastActiveAt).toBeInstanceOf(Date);
  });

  it("routes: owner only, validated, no PIN in any response", async () => {
    const created = await usersPost(
      request("/api/owner/users", {
        body: { name: unique("Dewi"), role: "barista", pin: "8642" },
        session: ownerToken,
      }),
    );
    expect(created.status).toBe(201);
    const { data } = await created.json();
    expect(JSON.stringify(data)).not.toMatch(/pin/i);

    for (const body of [
      { name: unique("A"), role: "owner", pin: "1234" },
      { name: unique("B"), role: "staff", pin: "12" },
      { name: unique("C"), role: "staff", pin: "12345a" },
    ]) {
      const response = await usersPost(
        request("/api/owner/users", { body, session: ownerToken }),
      );
      expect(response.status).toBe(400);
    }
    const asStaff = await usersPost(
      request("/api/owner/users", {
        body: { name: unique("D"), role: "staff", pin: "1234" },
        session: staffToken,
      }),
    );
    expect(asStaff.status).toBe(403);

    const reset = await pinPost(
      request(`/api/owner/users/${data.id}/pin`, {
        body: { pin: "97531" },
        session: ownerToken,
      }),
      params({ id: data.id }),
    );
    expect(reset.status).toBe(200);
    const missing = await pinPost(
      request(`/api/owner/users/${crypto.randomUUID()}/pin`, {
        body: { pin: "97531" },
        session: ownerToken,
      }),
      params({ id: crypto.randomUUID() }),
    );
    expect(missing.status).toBe(404);

    const list = await usersGet(
      request("/api/owner/users", { method: "GET", session: ownerToken }),
    );
    expect(JSON.stringify(await list.json())).not.toMatch(/pin_?hash/i);
    const devices = await devicesGet(
      request("/api/owner/devices", { method: "GET", session: ownerToken }),
    );
    expect(devices.status).toBe(200);
    const body = await devices.json();
    expect(JSON.stringify(body)).not.toMatch(/token/i);
    const staffDevices = await devicesGet(
      request("/api/owner/devices", { method: "GET", session: staffToken }),
    );
    expect(staffDevices.status).toBe(403);
  });
});

describe("settings (FR-OW-04)", () => {
  let before: Awaited<ReturnType<typeof getAllSettings>>;
  beforeAll(async () => {
    before = await getAllSettings();
  });
  afterAll(async () => {
    // Other files expect the seeded values.
    await setSettings(owner, before);
  });

  it("saves several keys at once and audits each changed one", async () => {
    const { changed } = await setSettings(owner, {
      service_charge_bps: before.service_charge_bps + 100,
      order_expiry_minutes: before.order_expiry_minutes,
      shop_name: "Binary Brew Kemang",
    });
    expect(changed.sort()).toEqual(["service_charge_bps", "shop_name"]);
    expect(await getSettings(["service_charge_bps", "shop_name"])).toEqual({
      service_charge_bps: before.service_charge_bps + 100,
      shop_name: "Binary Brew Kemang",
    });
    const row = await lastAudit("setting.update", "shop_name");
    expect(row?.metadata).toEqual({
      from: before.shop_name,
      to: "Binary Brew Kemang",
    });
    // The customer menu prices with the new rate at once.
    expect((await getPublicMenu(catalog.qr.token)).pricing).toMatchObject({
      serviceChargeBps: before.service_charge_bps + 100,
    });
  });

  it("is all or nothing: one bad value saves none", async () => {
    await expect(
      setSettings(owner, { shop_name: "Tidak tersimpan", tax_rate_bps: -5 }),
    ).rejects.toMatchObject({
      code: "VALIDATION_FAILED",
      details: { fields: ["tax_rate_bps"] },
    });
    expect((await getSettings(["shop_name"])).shop_name).not.toBe(
      "Tidak tersimpan",
    );
  });

  it("PUT takes only the basic keys; GET is owner only", async () => {
    const ok = await settingsPut(
      request("/api/owner/settings", {
        method: "PUT",
        body: { ordering_enabled: before.ordering_enabled },
        session: ownerToken,
      }),
    );
    expect(ok.status).toBe(200);
    for (const body of [
      { cash_enabled: true },
      { timezone: "Asia/Jakarta" },
      { reco_min_lift: 2 },
      { order_expiry_minutes: 0 },
    ]) {
      const response = await settingsPut(
        request("/api/owner/settings", {
          method: "PUT",
          body,
          session: ownerToken,
        }),
      );
      expect(response.status).toBe(400);
    }
    const staff = await settingsGet(
      request("/api/owner/settings", { method: "GET", session: staffToken }),
    );
    expect(staff.status).toBe(403);
    const owner = await settingsGet(
      request("/api/owner/settings", { method: "GET", session: ownerToken }),
    );
    expect((await owner.json()).data.settings.shop_name).toBeDefined();
  });
});
