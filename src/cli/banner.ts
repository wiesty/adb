import type { AppConfig } from "../config/config.js";

const VERSION = "1.0.0";

export function renderStartupBanner(config: AppConfig): void {
  if (!config.LOG_BANNER || config.LOG_FORMAT !== "pretty" || config.LOG_LEVEL === "silent") return;

  const lines = [
    "",
    " ▗▄▖ ▗▄▄▄  ▗▄▄▖ ",
    "▐▌ ▐▌▐▌  █ ▐▌ ▐▌",
    "▐▛▀▜▌▐▌  █ ▐▛▀▚▖",
    "▐▌ ▐▌▐▙▄▄▀ ▐▙▄▞▘",
    "",
    `AutoDNS Backup Client v${VERSION}`,
    "",
    "Runtime",
    `  mode:              ${config.BACKUP_MODE}`,
    `  log format:        ${config.LOG_FORMAT}`,
    `  log level:         ${config.LOG_LEVEL}`,
    "",
    "AutoDNS",
    `  base URL:          ${config.AUTODNS_BASE_URL}`,
    `  context:           ${config.AUTODNS_CONTEXT ? "configured" : "missing"}`,
    `  username:          ${config.AUTODNS_USERNAME ? "configured" : "missing"}`,
    "",
    "Backup",
    `  concurrency:       ${config.BACKUP_CONCURRENCY}`,
    `  requests/sec:      ${config.BACKUP_REQUESTS_PER_SECOND}`,
    `  timeout:           ${config.BACKUP_REQUEST_TIMEOUT_MS}ms`,
    `  max retries:       ${config.BACKUP_MAX_RETRIES}`,
    `  force re-export:   ${config.FORCE_REEXPORT_AFTER_DAYS} day(s)`,
    "",
    "Storage",
    `  driver:            ${config.STORAGE_DRIVER}`,
    `  local path:        ${config.STORAGE_DRIVER === "local" ? config.LOCAL_BACKUP_PATH : "not used"}`,
    `  s3 endpoint:       ${config.STORAGE_DRIVER === "s3" ? (config.S3_ENDPOINT ? "configured" : "default provider endpoint") : "not used"}`,
    `  s3 bucket:         ${config.STORAGE_DRIVER === "s3" ? (config.S3_BUCKET ? "configured" : "missing") : "not used"}`,
    "",
    "Git Export",
    `  enabled:           ${config.GIT_EXPORT_ENABLED}`,
    `  path:              ${config.GIT_EXPORT_ENABLED ? config.GIT_EXPORT_PATH : "not used"}`,
    `  write BIND:        ${config.GIT_EXPORT_WRITE_BIND}`,
    ""
  ];

  process.stderr.write(`${lines.join("\n")}\n`);
}
