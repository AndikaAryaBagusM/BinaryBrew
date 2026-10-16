import { afterAll, describe, expect, it, vi } from "vitest";
import { GET } from "@/app/api/health/route";
import { closeSql } from "@/db/client";

// connection() needs a Next.js request scope; outside one it only has to resolve.
vi.mock("next/server", async (importOriginal) => ({
  ...(await importOriginal<typeof import("next/server")>()),
  connection: async () => {},
}));

afterAll(closeSql);

describe("GET /api/health", () => {
  it("returns ok when the database answers", async () => {
    const response = await GET();
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      data: { status: "ok", database: "ok" },
    });
  });
});
