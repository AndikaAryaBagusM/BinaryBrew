import { Writable } from "node:stream";
import { describe, expect, it } from "vitest";
import { createLogger } from "@/lib/logger";

function capture() {
  const lines: Record<string, unknown>[] = [];
  const stream = new Writable({
    write(chunk, _encoding, done) {
      lines.push(JSON.parse(chunk.toString()));
      done();
    },
  });
  return { logger: createLogger({ level: "info" }, stream), lines };
}

describe("logger", () => {
  it("writes structured JSON with the message", () => {
    const { logger, lines } = capture();
    logger.info({ orderId: "abc" }, "order created");
    expect(lines[0]).toMatchObject({ msg: "order created", orderId: "abc" });
  });

  it("redacts tokens, PINs, passwords and secrets (Tech §9)", () => {
    const { logger, lines } = capture();
    logger.info(
      {
        password: "hunter2",
        pin: "123456",
        token: "tok",
        body: { pin: "654321", password: "x", qrToken: "q" },
        user: { pinHash: "h", passwordHash: "h" },
        session: { token: "s", tokenHash: "th" },
        headers: { cookie: "bb_session=s", authorization: "Bearer t" },
        webhook: { secret: "w" },
        safe: "kept",
      },
      "login attempt",
    );
    const line = JSON.stringify(lines[0]);
    for (const leaked of [
      "hunter2",
      "123456",
      "654321",
      "bb_session",
      "Bearer",
    ]) {
      expect(line).not.toContain(leaked);
    }
    expect(lines[0]).toMatchObject({
      password: "[Redacted]",
      pin: "[Redacted]",
      token: "[Redacted]",
      body: {
        pin: "[Redacted]",
        password: "[Redacted]",
        qrToken: "[Redacted]",
      },
      user: { pinHash: "[Redacted]", passwordHash: "[Redacted]" },
      session: { token: "[Redacted]", tokenHash: "[Redacted]" },
      headers: { cookie: "[Redacted]", authorization: "[Redacted]" },
      webhook: { secret: "[Redacted]" },
      safe: "kept",
    });
  });
});
