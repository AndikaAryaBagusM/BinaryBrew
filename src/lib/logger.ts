import pino, { type DestinationStream, type LoggerOptions } from "pino";

// Never log tokens, PINs or passwords (Tech §9).
const SENSITIVE_KEYS = [
  "password",
  "passwordHash",
  "pin",
  "pinHash",
  "token",
  "tokenHash",
  "qrToken",
  "secret",
  "cookie",
  "authorization",
];

// pino redaction paths are not recursive: cover the top level and two levels down.
const redactPaths = SENSITIVE_KEYS.flatMap((key) => [
  key,
  `*.${key}`,
  `*.*.${key}`,
]);

export function createLogger(
  options: LoggerOptions = {},
  destination?: DestinationStream,
) {
  const config: LoggerOptions = {
    level: process.env.NODE_ENV === "test" ? "silent" : "info",
    timestamp: pino.stdTimeFunctions.isoTime,
    redact: { paths: redactPaths },
    ...options,
  };
  return destination ? pino(config, destination) : pino(config);
}

export const logger = createLogger();
