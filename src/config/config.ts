import { readFileSync } from "node:fs";
import { z } from "zod";

const booleanFromEnv = z.union([z.boolean(), z.string()]).transform((value) => {
  if (typeof value === "boolean") return value;
  return ["1", "true", "yes", "on"].includes(value.toLowerCase());
});

const intFromEnv = (defaultValue: number, min = 0) =>
  z
    .union([z.number(), z.string()])
    .optional()
    .transform((value) => (value === undefined || value === "" ? defaultValue : Number(value)))
    .pipe(z.number().int().min(min));

const optionalString = z
  .string()
  .optional()
  .transform((value) => (value === "" ? undefined : value));

const EnvSchema = z
  .object({
    AUTODNS_BASE_URL: z.string().url().default("https://api.autodns.com/v1"),
    AUTODNS_USERNAME: z.string().min(1),
    AUTODNS_PASSWORD: z.string().min(1),
    AUTODNS_CONTEXT: z.string().regex(/^\d+$/),
    AUTODNS_USER_AGENT: z.string().min(1).default("tenbyte-autodns-backup/1.0"),

    BACKUP_MODE: z
      .enum(["inventory", "incremental", "full", "verify", "status"])
      .default("incremental"),
    BACKUP_CONCURRENCY: intFromEnv(2, 1),
    BACKUP_REQUESTS_PER_SECOND: intFromEnv(2, 1),
    BACKUP_REQUEST_TIMEOUT_MS: intFromEnv(30000, 1000),
    BACKUP_MAX_RETRIES: intFromEnv(5, 0),
    FORCE_REEXPORT_AFTER_DAYS: intFromEnv(7, 1),
    MISSING_CONFIRMATION_RUNS: intFromEnv(3, 1),
    MAX_INVENTORY_DROP_PERCENT: intFromEnv(1, 0),
    MAX_FAILED_ZONES: intFromEnv(5, 0),
    INVENTORY_PAGE_SIZE: intFromEnv(500, 1),

    DATABASE_PATH: z.string().min(1).default("/data/backup.sqlite"),
    WORK_DIRECTORY: z.string().min(1).default("/data/work"),

    STORAGE_DRIVER: z.enum(["local", "s3"]).default("s3"),
    LOCAL_BACKUP_PATH: z.string().min(1).default("/backup"),

    GIT_EXPORT_ENABLED: booleanFromEnv.default(false),
    GIT_EXPORT_PATH: z.string().min(1).default("/git-export"),
    GIT_EXPORT_WRITE_BIND: booleanFromEnv.default(true),

    S3_ENDPOINT: optionalString,
    S3_REGION: z.string().min(1).default("eu-central-1"),
    S3_BUCKET: optionalString,
    S3_PREFIX: z.string().default("autodns"),
    S3_ACCESS_KEY_ID: optionalString,
    S3_SECRET_ACCESS_KEY: optionalString,
    S3_FORCE_PATH_STYLE: booleanFromEnv.default(false),
    S3_SERVER_SIDE_ENCRYPTION: optionalString,
    S3_KMS_KEY_ID: optionalString,

    ALERT_WEBHOOK_URL: optionalString,
    LOG_LEVEL: z
      .enum(["fatal", "error", "warn", "info", "debug", "trace", "silent"])
      .default("info")
  })
  .superRefine((value, ctx) => {
    if (value.STORAGE_DRIVER === "s3") {
      for (const key of ["S3_BUCKET", "S3_ACCESS_KEY_ID", "S3_SECRET_ACCESS_KEY"] as const) {
        if (!value[key]) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            path: [key],
            message: `${key} is required for STORAGE_DRIVER=s3`
          });
        }
      }
    }
  });

export type AppConfig = z.infer<typeof EnvSchema>;

const secretFileKeys = [
  "AUTODNS_USERNAME",
  "AUTODNS_PASSWORD",
  "AUTODNS_CONTEXT",
  "S3_ACCESS_KEY_ID",
  "S3_SECRET_ACCESS_KEY",
  "ALERT_WEBHOOK_URL"
] as const;

export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  const merged: Record<string, string | undefined> = { ...env };
  for (const key of secretFileKeys) {
    const file = env[`${key}_FILE`];
    if (file && !env[key]) {
      merged[key] = readFileSync(file, "utf8").trim();
    }
  }
  return EnvSchema.parse(merged);
}

export function publicConfig(config: AppConfig): Record<string, unknown> {
  return {
    autodnsBaseUrl: config.AUTODNS_BASE_URL,
    autodnsContext: config.AUTODNS_CONTEXT,
    backupMode: config.BACKUP_MODE,
    backupConcurrency: config.BACKUP_CONCURRENCY,
    backupRequestsPerSecond: config.BACKUP_REQUESTS_PER_SECOND,
    backupRequestTimeoutMs: config.BACKUP_REQUEST_TIMEOUT_MS,
    backupMaxRetries: config.BACKUP_MAX_RETRIES,
    forceReexportAfterDays: config.FORCE_REEXPORT_AFTER_DAYS,
    missingConfirmationRuns: config.MISSING_CONFIRMATION_RUNS,
    maxInventoryDropPercent: config.MAX_INVENTORY_DROP_PERCENT,
    maxFailedZones: config.MAX_FAILED_ZONES,
    storageDriver: config.STORAGE_DRIVER,
    gitExportEnabled: config.GIT_EXPORT_ENABLED,
    gitExportWriteBind: config.GIT_EXPORT_WRITE_BIND,
    s3EndpointConfigured: Boolean(config.S3_ENDPOINT),
    s3BucketConfigured: Boolean(config.S3_BUCKET),
    alertWebhookConfigured: Boolean(config.ALERT_WEBHOOK_URL)
  };
}
