import { mkdirSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname } from "node:path";
import type { DatabaseSync as DatabaseSyncType } from "node:sqlite";

const require = createRequire(import.meta.url);
const { DatabaseSync } = require("node:sqlite") as typeof import("node:sqlite");

export function openDatabase(path: string): DatabaseSyncType {
  mkdirSync(dirname(path), { recursive: true });
  const db = new DatabaseSync(path);
  db.exec("PRAGMA journal_mode = WAL;");
  db.exec("PRAGMA foreign_keys = ON;");
  migrate(db);
  return db;
}

export function migrate(db: DatabaseSyncType): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS backup_runs (
      id TEXT PRIMARY KEY,
      type TEXT NOT NULL,
      status TEXT NOT NULL,
      started_at TEXT NOT NULL,
      completed_at TEXT,
      inventory_count INTEGER NOT NULL DEFAULT 0,
      successful_count INTEGER NOT NULL DEFAULT 0,
      failed_count INTEGER NOT NULL DEFAULT 0,
      deleted_count INTEGER NOT NULL DEFAULT 0,
      skipped_count INTEGER NOT NULL DEFAULT 0,
      manifest_key TEXT,
      error TEXT
    );

    CREATE TABLE IF NOT EXISTS zones_inventory (
      zone_key TEXT PRIMARY KEY,
      origin TEXT NOT NULL,
      origin_ascii TEXT NOT NULL,
      virtual_name_server TEXT NOT NULL,
      created_at TEXT,
      updated_at TEXT,
      status_json TEXT,
      metadata_hash TEXT NOT NULL,
      last_seen_at TEXT NOT NULL,
      last_inventory_run_id TEXT NOT NULL,
      last_successful_backup_at TEXT,
      last_content_hash TEXT,
      last_backed_up_metadata_hash TEXT,
      last_object_key TEXT,
      last_validated_at TEXT,
      missing_seen_count INTEGER NOT NULL DEFAULT 0,
      lifecycle_status TEXT NOT NULL DEFAULT 'visible'
    );

    CREATE TABLE IF NOT EXISTS export_jobs (
      id TEXT PRIMARY KEY,
      run_id TEXT NOT NULL REFERENCES backup_runs(id),
      zone_key TEXT NOT NULL,
      origin TEXT NOT NULL,
      virtual_name_server TEXT NOT NULL,
      status TEXT NOT NULL,
      reason TEXT NOT NULL,
      attempts INTEGER NOT NULL DEFAULT 0,
      next_attempt_at TEXT,
      locked_at TEXT,
      object_key TEXT,
      bind_object_key TEXT,
      content_hash TEXT,
      compressed_sha256 TEXT,
      compressed_size INTEGER,
      record_count INTEGER,
      warning_json TEXT,
      error TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      UNIQUE(run_id, zone_key)
    );

    CREATE TABLE IF NOT EXISTS api_attempts (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      run_id TEXT,
      zone_key TEXT,
      method TEXT NOT NULL,
      path TEXT NOT NULL,
      attempt INTEGER NOT NULL,
      status INTEGER,
      duration_ms INTEGER NOT NULL,
      error TEXT,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS errors (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      run_id TEXT,
      zone_key TEXT,
      severity TEXT NOT NULL,
      message TEXT NOT NULL,
      detail_json TEXT,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS backup_objects (
      object_key TEXT PRIMARY KEY,
      run_id TEXT NOT NULL,
      zone_key TEXT,
      kind TEXT NOT NULL,
      sha256 TEXT NOT NULL,
      content_hash TEXT,
      compressed_size INTEGER NOT NULL,
      storage_driver TEXT NOT NULL,
      created_at TEXT NOT NULL,
      verified_at TEXT,
      transaction_id TEXT
    );

    CREATE INDEX IF NOT EXISTS export_jobs_run_status_idx ON export_jobs(run_id, status);
    CREATE INDEX IF NOT EXISTS zones_inventory_origin_idx ON zones_inventory(origin_ascii);
    CREATE INDEX IF NOT EXISTS backup_objects_zone_idx ON backup_objects(zone_key, created_at);
  `);
}
