import type { NextConfig } from "next";

// Phones on the LAN open the dev server by the PC's address (Tech §3), which
// Next.js blocks for dev assets unless it is listed here.
const lanHost = process.env.APP_BASE_URL
  ? new URL(process.env.APP_BASE_URL).hostname
  : undefined;

const nextConfig: NextConfig = {
  cacheComponents: true,
  partialPrefetching: true,
  allowedDevOrigins: lanHost ? [lanHost] : [],
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
};

export default nextConfig;
