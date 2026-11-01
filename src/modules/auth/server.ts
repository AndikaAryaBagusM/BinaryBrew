import { cookies } from "next/headers";
import { connection } from "next/server";
import { DEVICE_COOKIE, SESSION_COOKIE } from "./cookies";
import { getSession, type SessionUser } from "./service";

// Cookie helpers for server components (pages). Route handlers use
// request.ts instead.

export async function sessionFromCookies(): Promise<SessionUser | null> {
  // Sessions are checked against the clock (new Date()), which Cache
  // Components does not allow in a prerender: wait for the request.
  await connection();
  return getSession((await cookies()).get(SESSION_COOKIE)?.value);
}

export async function deviceTokenFromCookies(): Promise<string | undefined> {
  return (await cookies()).get(DEVICE_COOKIE)?.value;
}
