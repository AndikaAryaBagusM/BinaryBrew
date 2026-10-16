import { z } from "zod";

const secret = z
  .string()
  .regex(
    /^[0-9a-f]{64,}$/i,
    "must be 32+ random bytes as hex (64+ characters)",
  );

// Variables the app server needs. Seed (SEED_*) and test (TEST_DATABASE_URL)
// variables are validated by the scripts that use them.
export const envSchema = z.object({
  DATABASE_URL: z.url({ protocol: /^postgres(ql)?$/ }),
  APP_BASE_URL: z.url({ protocol: /^https?$/ }),
  TOKEN_HASH_PEPPER: secret,
  PAYMENT_PROVIDER: z.enum(["mock"]),
  PAYMENT_WEBHOOK_SECRET: secret,
  TZ: z.literal("Asia/Jakarta"),
});

export type Env = z.infer<typeof envSchema>;

export function parseEnv(source: Record<string, string | undefined>): Env {
  const result = envSchema.safeParse(source);
  if (!result.success) {
    const problems = result.error.issues
      .map((issue) => `  ${issue.path.join(".")}: ${issue.message}`)
      .join("\n");
    throw new Error(
      `Invalid environment variables (see .env.example):\n${problems}`,
    );
  }
  return result.data;
}

let cached: Env | undefined;

export function getEnv(): Env {
  cached ??= parseEnv(process.env);
  return cached;
}
