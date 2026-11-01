import { redirect } from "next/navigation";
import { sessionFromCookies } from "@/modules/auth/server";
import type { SessionUser } from "@/modules/auth/service";

// Owner pages (O-01..O-16): no owner session → the login page. Every page
// checks for itself; the layout does not re-run on client navigation.
export async function ownerSessionOrLogin(): Promise<SessionUser> {
  const session = await sessionFromCookies();
  if (!session || session.role !== "owner") redirect("/owner/login");
  return session;
}

// A server value in the shape the JSON routes send (dates as ISO strings).
export function asJson<T>(value: unknown): T {
  return JSON.parse(JSON.stringify(value)) as T;
}
