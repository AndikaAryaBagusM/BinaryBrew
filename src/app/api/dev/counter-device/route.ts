import { NextResponse } from "next/server";
import { AppError } from "@/lib/errors";
import { route } from "@/lib/http";
import { setDeviceCookie } from "@/modules/auth/cookies";

// Development only: makes this browser the seeded counter tablet
// (SEED_COUNTER_DEVICE_TOKEN) until the owner screen can register devices
// (P1-13). 404 everywhere else.
export const GET = route(async (request) => {
  const token = process.env.SEED_COUNTER_DEVICE_TOKEN;
  if (process.env.NODE_ENV !== "development" || !token) {
    throw new AppError("NOT_FOUND");
  }
  const response = NextResponse.redirect(
    new URL("/counter/login", request.url),
  );
  setDeviceCookie(response, token);
  return response;
});
