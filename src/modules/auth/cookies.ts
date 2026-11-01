import type { NextResponse } from "next/server";
import { getEnv } from "@/lib/env";
import { SESSION_MAX_AGE_MS } from "./service";

// Cookie names and flags (Tech §9): HttpOnly, SameSite=Lax, Secure only when
// the app is served over HTTPS. The values are opaque tokens; only their hashes
// are stored.
export const SESSION_COOKIE = "bb_session";
export const DEVICE_COOKIE = "bb_device";

// Browsers cap cookie lifetime at 400 days.
const DEVICE_MAX_AGE_S = 400 * 24 * 60 * 60;

function baseOptions() {
  return {
    httpOnly: true,
    sameSite: "lax" as const,
    path: "/",
    secure: new URL(getEnv().APP_BASE_URL).protocol === "https:",
  };
}

export function setSessionCookie(response: NextResponse, token: string) {
  response.cookies.set(SESSION_COOKIE, token, {
    ...baseOptions(),
    maxAge: SESSION_MAX_AGE_MS / 1000,
  });
}

export function clearSessionCookie(response: NextResponse) {
  response.cookies.set(SESSION_COOKIE, "", { ...baseOptions(), maxAge: 0 });
}

export function setDeviceCookie(response: NextResponse, token: string) {
  response.cookies.set(DEVICE_COOKIE, token, {
    ...baseOptions(),
    maxAge: DEVICE_MAX_AGE_S,
  });
}
