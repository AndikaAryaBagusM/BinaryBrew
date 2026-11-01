import { NextRequest } from "next/server";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { POST as elevatePost } from "@/app/api/auth/elevate/route";
import { POST as logoutPost } from "@/app/api/auth/logout/route";
import { POST as ownerLoginPost } from "@/app/api/auth/owner-login/route";
import { POST as pinLoginPost } from "@/app/api/auth/pin-login/route";
import { GET as pinUsersGet } from "@/app/api/auth/pin-users/route";
import { POST as registerDevicePost } from "@/app/api/devices/register/route";
import { closeSql } from "@/db/client";
import { DEVICE_COOKIE, SESSION_COOKIE } from "@/modules/auth/cookies";
import { getSession, resetAuthRateLimits } from "@/modules/auth/service";
import { createDevice, createUser, unique } from "./auth-fixtures";

afterAll(() => closeSql());
beforeEach(() => resetAuthRateLimits());

const BASE = "http://localhost:3000";

function request(
  path: string,
  options: {
    method?: "GET" | "POST";
    body?: unknown;
    cookies?: Record<string, string>;
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
  if (options.cookies) {
    headers.set(
      "cookie",
      Object.entries(options.cookies)
        .map(([name, value]) => `${name}=${value}`)
        .join("; "),
    );
  }
  return new NextRequest(`${BASE}${path}`, {
    method: options.method ?? "POST",
    headers,
    body: options.body === undefined ? undefined : JSON.stringify(options.body),
  });
}

async function ownerSessionToken() {
  const owner = await createUser({ role: "owner" });
  const response = await ownerLoginPost(
    request("/api/auth/owner-login", {
      body: { email: owner.email, password: owner.password },
    }),
  );
  return { owner, token: response.cookies.get(SESSION_COOKIE)!.value };
}

describe("POST /api/auth/owner-login", () => {
  it("sets an HttpOnly, SameSite=Lax session cookie and never returns the token", async () => {
    const owner = await createUser({ role: "owner" });
    const response = await ownerLoginPost(
      request("/api/auth/owner-login", {
        body: { email: owner.email, password: owner.password },
      }),
    );

    expect(response.status).toBe(200);
    const cookie = response.cookies.get(SESSION_COOKIE)!;
    expect(cookie).toMatchObject({
      httpOnly: true,
      sameSite: "lax",
      path: "/",
      maxAge: 12 * 60 * 60,
    });
    expect(cookie.secure).toBeFalsy(); // APP_BASE_URL is http in development
    const body = await response.json();
    expect(body).toEqual({
      data: { user: { name: owner.name, role: "owner" } },
    });
    expect(JSON.stringify(body)).not.toContain(cookie.value);
  });

  it("answers 401 with an Indonesian message for wrong credentials", async () => {
    const owner = await createUser({ role: "owner" });
    const response = await ownerLoginPost(
      request("/api/auth/owner-login", {
        body: { email: owner.email, password: "wrong password" },
      }),
    );
    expect(response.status).toBe(401);
    const body = await response.json();
    expect(body.error.code).toBe("INVALID_CREDENTIALS");
    expect(body.error.message).toMatch(/salah/i);
    expect(response.cookies.get(SESSION_COOKIE)).toBeUndefined();
  });

  it("rejects a missing or foreign Origin header (CSRF)", async () => {
    const owner = await createUser({ role: "owner" });
    for (const origin of [null, "http://evil.example"]) {
      const response = await ownerLoginPost(
        request("/api/auth/owner-login", {
          origin,
          body: { email: owner.email, password: owner.password },
        }),
      );
      expect(response.status).toBe(403);
      expect((await response.json()).error.code).toBe("FORBIDDEN");
    }
  });

  it("rejects unknown fields and malformed bodies", async () => {
    const owner = await createUser({ role: "owner" });
    const response = await ownerLoginPost(
      request("/api/auth/owner-login", {
        body: { email: owner.email, password: owner.password, role: "owner" },
      }),
    );
    expect(response.status).toBe(400);
    expect((await response.json()).error.code).toBe("VALIDATION_FAILED");
  });
});

describe("POST /api/auth/pin-login and GET /api/auth/pin-users", () => {
  it("needs the device cookie of a registered device", async () => {
    const user = await createUser();
    const noDevice = await pinLoginPost(
      request("/api/auth/pin-login", {
        body: { userId: user.id, pin: user.pin },
      }),
    );
    expect(noDevice.status).toBe(403);
    expect((await noDevice.json()).error.code).toBe("DEVICE_NOT_REGISTERED");

    const listNoDevice = await pinUsersGet(
      request("/api/auth/pin-users", { method: "GET" }),
    );
    expect(listNoDevice.status).toBe(403);
  });

  it("logs in with the device cookie and reports attempts and the lock", async () => {
    const user = await createUser({ pin: "2468" });
    const device = await createDevice();
    const cookies = { [DEVICE_COOKIE]: device.token };

    const list = await pinUsersGet(
      request("/api/auth/pin-users", { method: "GET", cookies }),
    );
    expect(list.status).toBe(200);
    expect((await list.json()).data.users).toContainEqual({
      id: user.id,
      name: user.name,
      role: "staff",
    });

    const wrong = await pinLoginPost(
      request("/api/auth/pin-login", {
        cookies,
        body: { userId: user.id, pin: "0000" },
      }),
    );
    expect(wrong.status).toBe(401);
    expect((await wrong.json()).error).toMatchObject({
      code: "INVALID_CREDENTIALS",
      details: { remainingAttempts: 4 },
    });

    const ok = await pinLoginPost(
      request("/api/auth/pin-login", {
        cookies,
        body: { userId: user.id, pin: "2468" },
      }),
    );
    expect(ok.status).toBe(200);
    expect(ok.cookies.get(SESSION_COOKIE)?.httpOnly).toBe(true);

    for (let i = 0; i < 5; i++) {
      await pinLoginPost(
        request("/api/auth/pin-login", {
          cookies,
          body: { userId: user.id, pin: "0000" },
        }),
      );
    }
    const locked = await pinLoginPost(
      request("/api/auth/pin-login", {
        cookies,
        body: { userId: user.id, pin: "2468" },
      }),
    );
    expect(locked.status).toBe(423);
    expect((await locked.json()).error.details.lockedUntil).toEqual(
      expect.any(String),
    );
  });

  it("rejects a PIN that is not 4-6 digits", async () => {
    const user = await createUser();
    const device = await createDevice();
    const response = await pinLoginPost(
      request("/api/auth/pin-login", {
        cookies: { [DEVICE_COOKIE]: device.token },
        body: { userId: user.id, pin: "12a4" },
      }),
    );
    expect(response.status).toBe(400);
  });
});

describe("POST /api/auth/logout", () => {
  it("revokes the session and clears the cookie", async () => {
    const { token } = await ownerSessionToken();
    const response = await logoutPost(
      request("/api/auth/logout", { cookies: { [SESSION_COOKIE]: token } }),
    );
    expect(response.status).toBe(200);
    expect(response.cookies.get(SESSION_COOKIE)?.value).toBe("");
    expect(await getSession(token)).toBeNull();
  });
});

describe("POST /api/auth/elevate", () => {
  it("needs a session", async () => {
    const response = await elevatePost(
      request("/api/auth/elevate", {
        body: { pin: "135790", scope: "void_order" },
      }),
    );
    expect(response.status).toBe(401);
  });

  it("rejects an unknown scope", async () => {
    const { token } = await ownerSessionToken();
    const response = await elevatePost(
      request("/api/auth/elevate", {
        cookies: { [SESSION_COOKIE]: token },
        body: { pin: "1234", scope: "delete_everything" },
      }),
    );
    expect(response.status).toBe(400);
  });

  it("returns the elevation id and expiry for the owner's own PIN", async () => {
    const { owner, token } = await ownerSessionToken();
    const response = await elevatePost(
      request("/api/auth/elevate", {
        cookies: { [SESSION_COOKIE]: token },
        body: { pin: owner.pin, scope: "void_order" },
      }),
    );
    expect(response.status).toBe(200);
    expect((await response.json()).data).toEqual({
      elevationId: expect.any(String),
      expiresAt: expect.any(String),
    });
  });
});

describe("POST /api/devices/register", () => {
  it("is owner-only and sets a long-lived device cookie", async () => {
    const staff = await createUser();
    const device = await createDevice();
    const staffLogin = await pinLoginPost(
      request("/api/auth/pin-login", {
        cookies: { [DEVICE_COOKIE]: device.token },
        body: { userId: staff.id, pin: staff.pin },
      }),
    );
    const staffToken = staffLogin.cookies.get(SESSION_COOKIE)!.value;
    const forbidden = await registerDevicePost(
      request("/api/devices/register", {
        cookies: { [SESSION_COOKIE]: staffToken },
        body: { name: "Tablet baru" },
      }),
    );
    expect(forbidden.status).toBe(403);

    const { token } = await ownerSessionToken();
    const response = await registerDevicePost(
      request("/api/devices/register", {
        cookies: { [SESSION_COOKIE]: token },
        body: { name: "Tablet baru" },
      }),
    );
    expect(response.status).toBe(201);
    const cookie = response.cookies.get(DEVICE_COOKIE)!;
    expect(cookie).toMatchObject({
      httpOnly: true,
      sameSite: "lax",
      path: "/",
    });
    expect(cookie.maxAge).toBeGreaterThanOrEqual(365 * 24 * 60 * 60);
    expect((await response.json()).data.device).toEqual({
      id: expect.any(String),
      name: "Tablet baru",
    });
  });
});
