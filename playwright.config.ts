import { existsSync } from "node:fs";
import { defineConfig, devices } from "@playwright/test";
import { e2eTestDatabaseUrl } from "./tests/integration/databases";

// End-to-end tests (Tech §12): the customer pages on a phone viewport and
// the Counter on a landscape tablet, the queue board on a 1080p TV, against a dev server on its own port and its own database (global-setup.ts).
// Stop your own `npm run dev` first: Next.js runs one dev server per project.
if (existsSync(".env")) process.loadEnvFile(".env");
const testUrl = process.env.TEST_DATABASE_URL;
if (!testUrl)
  throw new Error("TEST_DATABASE_URL is not set (see .env.example)");

const port = 3100;
const baseURL = `http://localhost:${port}`;

export default defineConfig({
  testDir: "tests/e2e",
  globalSetup: "./tests/e2e/global-setup.ts",
  // One server and one database: keep the order predictable.
  workers: 1,
  fullyParallel: false,
  forbidOnly: true,
  reporter: "list",
  use: {
    baseURL,
    trace: "retain-on-failure",
  },
  projects: [
    {
      name: "phone",
      // The installed Chrome, so no browser download is needed.
      use: {
        ...devices["Pixel 7"],
        channel: "chrome",
        viewport: { width: 360, height: 780 },
      },
      testIgnore: ["counter*.spec.ts", "board*.spec.ts"],
    },
    {
      name: "tablet",
      testMatch: "counter*.spec.ts",
      use: {
        channel: "chrome",
        viewport: { width: 1280, height: 800 },
        hasTouch: true,
      },
    },
    {
      name: "tv",
      testMatch: "board*.spec.ts",
      use: { channel: "chrome", viewport: { width: 1920, height: 1080 } },
    },
  ],
  webServer: {
    command: `npx next dev -p ${port}`,
    // The home page needs no database, so this does not depend on setup order.
    url: baseURL,
    reuseExistingServer: false,
    timeout: 120_000,
    env: {
      DATABASE_URL: e2eTestDatabaseUrl(testUrl),
      APP_BASE_URL: baseURL,
    },
  },
});
