import pino from "pino";
import type { AppConfig } from "../config/config.js";

export function createLogger(config: Pick<AppConfig, "LOG_LEVEL">) {
  return pino({
    level: config.LOG_LEVEL,
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
