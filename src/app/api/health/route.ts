import { connection } from "next/server";
import { pingDatabase } from "@/db/client";

export async function GET() {
  // Always answer at request time; a health check must never be prerendered.
  await connection();
  try {
    await pingDatabase();
    return Response.json({ data: { status: "ok", database: "ok" } });
  } catch {
    return Response.json(
      { error: { code: "DB_UNAVAILABLE", message: "Database unavailable" } },
      { status: 503 },
    );
  }
}
