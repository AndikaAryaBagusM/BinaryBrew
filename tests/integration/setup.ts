import { existsSync } from "node:fs";

// Integration tests run against the separate test database (Tech §3).
if (existsSync(".env")) process.loadEnvFile(".env");

const testUrl = process.env.TEST_DATABASE_URL;
if (!testUrl) {
  throw new Error("TEST_DATABASE_URL is not set (see .env.example)");
}
process.env.DATABASE_URL = testUrl;
