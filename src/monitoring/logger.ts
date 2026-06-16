import pino from "pino";
import type { AppConfig } from "../config/config.js";

export function createLogger(config: Pick<AppConfig, "LOG_LEVEL" | "LOG_FORMAT">) {
  return pino({
    level: config.LOG_LEVEL,
    transport:
      config.LOG_FORMAT === "pretty"
        ? {
            target: "pino-pretty",
            options: {
              colorize: process.stdout.isTTY,
              translateTime: "SYS:yyyy-mm-dd HH:MM:ss",
              ignore: "pid,hostname",
              messageFormat: "{msg}"
            }
          }
        : undefined,
    redact: {
      paths: [
        "AUTODNS_PASSWORD",
        "AUTODNS_USERNAME",
        "S3_SECRET_ACCESS_KEY",
        "S3_ACCESS_KEY_ID",
        "ALERT_WEBHOOK_URL",
        "*.authorization",
        "*.Authorization",
        "headers.authorization",
        "headers.Authorization"
      ],
      censor: "[REDACTED]"
    }
  });
}

export type Logger = ReturnType<typeof createLogger>;
