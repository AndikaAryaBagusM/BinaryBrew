import { afterAll, describe, expect, it, vi } from "vitest";

// connection() needs a Next.js request scope; outside one it only has to resolve.
vi.mock("next/server", async (importOriginal) => ({
  ...(await importOriginal<typeof import("next/server")>()),
  connection: async () => {},
}));

// Nothing listens on port 1, so the connection is refused immediately.
process.env.DATABASE_URL = "postgres://binarybrew:x@127.0.0.1:1/binarybrew";

const { GET } = await import("@/app/api/health/route");
const { closeSql } = await import("@/db/client");

afterAll(closeSql);

describe("GET /api/health without a database", () => {
  it("returns 503 with a stable error code", async () => {
    const response = await GET();
    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({
      error: { code: "DB_UNAVAILABLE", message: "Database unavailable" },
    });
  });
});
