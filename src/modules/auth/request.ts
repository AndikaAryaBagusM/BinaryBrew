import type { NextRequest } from "next/server";
import { AppError } from "@/lib/errors";
import { DEVICE_COOKIE, SESSION_COOKIE } from "./cookies";
import { getSession, type SessionUser } from "./service";

// Request helpers for route handlers.

// CSRF (Tech §9 checklist): a state-changing request must come from a page on
// this host. Browsers always send Origin on cross-site POSTs and scripts cannot
// forge it; a missing header is refused too.
export function assertSameOrigin(request: NextRequest) {
  const origin = request.headers.get("origin");
  const host =
    request.headers.get("x-forwarded-host") ?? request.headers.get("host");
  if (!origin || !host) throw new AppError("FORBIDDEN");
  let originHost: string;
  try {
    originHost = new URL(origin).host;
  } catch {
    throw new AppError("FORBIDDEN");
  }
  if (originHost !== host) throw new AppError("FORBIDDEN");
}

// Used only as a rate-limit key. Next.js fills x-forwarded-for from the socket
// address when it is missing; without a reverse proxy a client can still send
// its own value, which is acceptable on the shop LAN (Phase 4 adds a proxy).
export function clientIp(request: NextRequest): string {
  return (
    request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "unknown"
  );
}

export const sessionToken = (request: NextRequest) =>
  request.cookies.get(SESSION_COOKIE)?.value;

export const deviceToken = (request: NextRequest) =>
  request.cookies.get(DEVICE_COOKIE)?.value;

export function sessionFromRequest(
  request: NextRequest,
): Promise<SessionUser | null> {
  return getSession(sessionToken(request));
}
