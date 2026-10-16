import type { NextConfig } from "next";
import {
  PHASE_DEVELOPMENT_SERVER,
  PHASE_PRODUCTION_SERVER,
} from "next/constants";
import { getEnv } from "./src/lib/env";

export default function nextConfig(phase: string): NextConfig {
  const isServer =
    phase === PHASE_DEVELOPMENT_SERVER || phase === PHASE_PRODUCTION_SERVER;

  // The server refuses to start with missing or invalid env vars (P0-02).
  // Build and typegen phases do not need runtime secrets.
  const env = isServer ? getEnv() : undefined;

  return {
    cacheComponents: true,
    partialPrefetching: true,
    // Phones on the LAN open the dev server by the PC's address (Tech §3),
    // which Next.js blocks for dev assets unless it is listed here.
    allowedDevOrigins: env ? [new URL(env.APP_BASE_URL).hostname] : [],
    turbopack: {
      rules: {
        "*.css": {
          loaders: ["@tailwindcss/turbopack"],
          as: "*.css",
        },
      },
    },
  };
}
