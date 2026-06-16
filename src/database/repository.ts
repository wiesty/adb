import { randomUUID } from "node:crypto";
import type { DatabaseSync as DatabaseSyncType } from "node:sqlite";
import { nowIso } from "../utils/time.js";

export type RunType = "inventory" | "incremental" | "full" | "verify";
export type JobStatus =
  | "pending"
  | "running"
  | "completed"
  | "retry"
  | "failed"
  | "deleted"
  | "skipped";

export interface InventoryZoneRow {
  zoneKey: string;
  origin: string;
  originAscii: string;
  virtualNameServer: string;
  createdAt?: string;
  updatedAt?: string;
  metadataHash: string;
  statusJson: string;
}

export interface ExportJob {
  id: string;
  run_id: string;
  zone_key: string;
  origin: string;
  virtual_name_server: string;
  status: JobStatus;
  reason: string;
  attempts: number;
  object_key?: string;
  content_hash?: string;
}

export class BackupRepository {
  constructor(private readonly db: DatabaseSyncType) {}

  transaction<T>(fn: () => T): T {
    this.db.exec("BEGIN IMMEDIATE;");
    try {
      const value = fn();
      this.db.exec("COMMIT;");
      return value;
    } catch (error) {
      this.db.exec("ROLLBACK;");
      throw error;
    }
  }

  createRun(type: RunType, id = randomUUID()): string {
    const started = nowIso();
    this.db
      .prepare("INSERT INTO backup_runs (id, type, status, started_at) VALUES (?, ?, 'running', ?)")
      .run(id, type, started);
    return id;
  }

  findIncompleteRun(type: RunType): string | undefined {
    const row = this.db
      .prepare(
        "SELECT id FROM backup_runs WHERE type = ? AND status = 'running' ORDER BY started_at DESC LIMIT 1"
      )
      .get(type) as { id: string } | undefined;
    return row?.id;
  }

  updateRunCounts(runId: string): void {
    const row = this.db
      .prepare(
        `SELECT
          SUM(status IN ('completed')) successful,
          SUM(status = 'failed') failed,
          SUM(status = 'deleted') deleted,
          SUM(status = 'skipped') skipped
        FROM export_jobs WHERE run_id = ?`
      )
      .get(runId) as { successful: number; failed: number; deleted: number; skipped: number };
    this.db
      .prepare(
        `UPDATE backup_runs SET successful_count=?, failed_count=?, deleted_count=?, skipped_count=?
         WHERE id=?`
      )
      .run(row.successful ?? 0, row.failed ?? 0, row.deleted ?? 0, row.skipped ?? 0, runId);
  }

  finishRun(
    runId: string,
    status: "completed" | "failed",
    manifestKey?: string,
    error?: string
  ): void {
    this.updateRunCounts(runId);
    this.db
      .prepare(
        "UPDATE backup_runs SET status=?, completed_at=?, manifest_key=?, error=? WHERE id=?"
      )
      .run(status, nowIso(), manifestKey ?? null, error ?? null, runId);
  }

  resetOrphanRunningJobs(): void {
    this.db
      .prepare(
        `UPDATE export_jobs
         SET status = CASE WHEN attempts > 0 THEN 'retry' ELSE 'pending' END,
             locked_at = NULL,
             updated_at = ?
         WHERE status = 'running'`
      )
      .run(nowIso());
  }

  upsertInventoryZone(runId: string, zone: InventoryZoneRow): void {
    this.db
      .prepare(
        `INSERT INTO zones_inventory (
          zone_key, origin, origin_ascii, virtual_name_server, created_at, updated_at, status_json,
          metadata_hash, last_seen_at, last_inventory_run_id, missing_seen_count, lifecycle_status
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, 'visible')
        ON CONFLICT(zone_key) DO UPDATE SET
          origin=excluded.origin,
          origin_ascii=excluded.origin_ascii,
          virtual_name_server=excluded.virtual_name_server,
          created_at=excluded.created_at,
          updated_at=excluded.updated_at,
          status_json=excluded.status_json,
          metadata_hash=excluded.metadata_hash,
          last_seen_at=excluded.last_seen_at,
          last_inventory_run_id=excluded.last_inventory_run_id,
          missing_seen_count=0,
          lifecycle_status='visible'`
      )
      .run(
        zone.zoneKey,
        zone.origin,
        zone.originAscii,
        zone.virtualNameServer,
        zone.createdAt ?? null,
        zone.updatedAt ?? null,
        zone.statusJson,
        zone.metadataHash,
        nowIso(),
        runId
      );
  }

  markMissingZones(runId: string, confirmationRuns: number): number {
    this.db
      .prepare(
        `UPDATE zones_inventory
         SET missing_seen_count = missing_seen_count + 1,
             lifecycle_status = CASE
               WHEN missing_seen_count + 1 >= ? THEN 'possibly_deleted'
               ELSE 'missing'
             END
         WHERE last_inventory_run_id <> ? AND lifecycle_status <> 'possibly_deleted'`
      )
      .run(confirmationRuns, runId);
    const row = this.db
      .prepare("SELECT COUNT(*) count FROM zones_inventory WHERE lifecycle_status <> 'visible'")
      .get() as { count: number };
    return row.count;
  }

  visibleInventory(): Array<Record<string, unknown>> {
    return this.db
      .prepare(
        "SELECT * FROM zones_inventory WHERE lifecycle_status = 'visible' ORDER BY origin_ascii"
      )
      .all() as Array<Record<string, unknown>>;
  }

  previousVisibleCount(runId: string): number | undefined {
    const row = this.db
      .prepare(
        `SELECT inventory_count count FROM backup_runs
         WHERE id <> ? AND inventory_count > 0
         ORDER BY started_at DESC LIMIT 1`
      )
      .get(runId) as { count: number } | undefined;
    return row?.count;
  }

  setInventoryCount(runId: string, count: number): void {
    this.db.prepare("UPDATE backup_runs SET inventory_count=? WHERE id=?").run(count, runId);
  }

  enqueueJob(runId: string, zone: Record<string, unknown>, reason: string, skipped = false): void {
    const now = nowIso();
    const zoneKey = String(zone.zone_key);
    this.db
      .prepare(
        `INSERT OR IGNORE INTO export_jobs (
          id, run_id, zone_key, origin, virtual_name_server, status, reason, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        randomUUID(),
        runId,
        zoneKey,
        String(zone.origin),
        String(zone.virtual_name_server),
        skipped ? "skipped" : "pending",
        reason,
        now,
        now
      );
  }

  claimNextJob(runId: string): ExportJob | undefined {
    return this.transaction(() => {
      const job = this.db
        .prepare(
          `SELECT * FROM export_jobs
           WHERE run_id=? AND status IN ('pending', 'retry')
             AND (next_attempt_at IS NULL OR next_attempt_at <= ?)
           ORDER BY created_at ASC LIMIT 1`
        )
        .get(runId, nowIso()) as ExportJob | undefined;
      if (!job) return undefined;
      this.db
        .prepare(
          `UPDATE export_jobs SET status='running', locked_at=?, attempts=attempts+1, updated_at=?
           WHERE id=?`
        )
        .run(nowIso(), nowIso(), job.id);
      return { ...job, status: "running", attempts: job.attempts + 1 };
    });
  }

  completeJob(
    jobId: string,
    result: {
      objectKey: string;
      bindObjectKey?: string;
      contentHash: string;
      compressedSha256: string;
      compressedSize: number;
      recordCount: number;
      warnings: string[];
    }
  ): void {
    this.db
      .prepare(
        `UPDATE export_jobs SET status='completed', object_key=?, bind_object_key=?,
         content_hash=?, compressed_sha256=?, compressed_size=?, record_count=?, warning_json=?,
         error=NULL, updated_at=? WHERE id=?`
      )
      .run(
        result.objectKey,
        result.bindObjectKey ?? null,
        result.contentHash,
        result.compressedSha256,
        result.compressedSize,
        result.recordCount,
        JSON.stringify(result.warnings),
        nowIso(),
        jobId
      );
  }

  skipCompletedDuplicate(
    jobId: string,
    objectKey: string,
    contentHash: string,
    recordCount: number
  ): void {
    this.db
      .prepare(
        `UPDATE export_jobs SET status='completed', object_key=?, content_hash=?, record_count=?,
         warning_json='[]', updated_at=? WHERE id=?`
      )
      .run(objectKey, contentHash, recordCount, nowIso(), jobId);
  }

  retryJob(jobId: string, error: string, delayMs: number): void {
    this.db
      .prepare(
        "UPDATE export_jobs SET status='retry', error=?, next_attempt_at=?, updated_at=? WHERE id=?"
      )
      .run(error, new Date(Date.now() + delayMs).toISOString(), nowIso(), jobId);
  }

  failJob(jobId: string, error: string): void {
    this.db
      .prepare("UPDATE export_jobs SET status='failed', error=?, updated_at=? WHERE id=?")
      .run(error, nowIso(), jobId);
  }

  markZoneDeleted(jobId: string, error: string): void {
    this.db
      .prepare("UPDATE export_jobs SET status='deleted', error=?, updated_at=? WHERE id=?")
      .run(error, nowIso(), jobId);
  }

  recordApiAttempt(
    runId: string | undefined,
    zoneKey: string | undefined,
    attempt: {
      method: string;
      path: string;
      attempt: number;
      durationMs: number;
      status?: number;
      error?: string;
    }
  ): void {
    this.db
      .prepare(
        `INSERT INTO api_attempts
         (run_id, zone_key, method, path, attempt, status, duration_ms, error, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        runId ?? null,
        zoneKey ?? null,
        attempt.method,
        attempt.path,
        attempt.attempt,
        attempt.status == null ? null : attempt.status,
        attempt.durationMs,
        attempt.error == null ? null : attempt.error,
        nowIso()
      );
  }

  recordError(
    runId: string | undefined,
    zoneKey: string | undefined,
    severity: string,
    message: string,
    detail?: unknown
  ): void {
    this.db
      .prepare(
        "INSERT INTO errors (run_id, zone_key, severity, message, detail_json, created_at) VALUES (?, ?, ?, ?, ?, ?)"
      )
      .run(
        runId ?? null,
        zoneKey ?? null,
        severity,
        message,
        detail ? JSON.stringify(detail) : null,
        nowIso()
      );
  }

  addBackupObject(object: {
    objectKey: string;
    runId: string;
    zoneKey?: string;
    kind: string;
    sha256: string;
    contentHash?: string;
    compressedSize: number;
    storageDriver: string;
    transactionId?: string;
  }): void {
    this.db
      .prepare(
        `INSERT OR REPLACE INTO backup_objects
         (object_key, run_id, zone_key, kind, sha256, content_hash, compressed_size, storage_driver, created_at, verified_at, transaction_id)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        object.objectKey,
        object.runId,
        object.zoneKey ?? null,
        object.kind,
        object.sha256,
        object.contentHash ?? null,
        object.compressedSize,
        object.storageDriver,
        nowIso(),
        nowIso(),
        object.transactionId ?? null
      );
  }

  markZoneBackedUp(zoneKey: string, objectKey: string, contentHash: string): void {
    this.db
      .prepare(
        `UPDATE zones_inventory SET last_successful_backup_at=?, last_object_key=?, last_content_hash=?,
         last_backed_up_metadata_hash=metadata_hash,
         last_validated_at=? WHERE zone_key=?`
      )
      .run(nowIso(), objectKey, contentHash, nowIso(), zoneKey);
  }

  latestObjectForZone(zoneKey: string): { object_key: string; content_hash: string } | undefined {
    return this.db
      .prepare(
        "SELECT object_key, content_hash FROM backup_objects WHERE zone_key=? AND kind='zone-json' ORDER BY created_at DESC LIMIT 1"
      )
      .get(zoneKey) as { object_key: string; content_hash: string } | undefined;
  }

  latestObjectsForOrigin(originAscii: string): Array<Record<string, unknown>> {
    return this.db
      .prepare(
        `SELECT z.origin, z.virtual_name_server, z.zone_key, z.last_object_key, z.last_successful_backup_at,
                o.sha256, o.compressed_size, o.created_at
         FROM zones_inventory z
         LEFT JOIN backup_objects o ON o.object_key = z.last_object_key
         WHERE z.origin_ascii = ?
         ORDER BY z.virtual_name_server`
      )
      .all(originAscii) as Array<Record<string, unknown>>;
  }

  jobRows(runId: string): Array<Record<string, unknown>> {
    return this.db
      .prepare("SELECT * FROM export_jobs WHERE run_id=? ORDER BY origin")
      .all(runId) as Array<Record<string, unknown>>;
  }

  runRow(runId: string): Record<string, unknown> {
    return this.db.prepare("SELECT * FROM backup_runs WHERE id=?").get(runId) as Record<
      string,
      unknown
    >;
  }

  allBackupObjects(): Array<Record<string, unknown>> {
    return this.db.prepare("SELECT * FROM backup_objects ORDER BY created_at DESC").all() as Array<
      Record<string, unknown>
    >;
  }

  statusSummary(): Record<string, unknown> {
    const runs = this.db
      .prepare("SELECT * FROM backup_runs ORDER BY started_at DESC LIMIT 10")
      .all() as Array<Record<string, unknown>>;
    const zones = this.db
      .prepare(
        "SELECT lifecycle_status, COUNT(*) count FROM zones_inventory GROUP BY lifecycle_status"
      )
      .all();
    const jobs = this.db
      .prepare("SELECT status, COUNT(*) count FROM export_jobs GROUP BY status")
      .all();
    return { runs, zones, jobs };
  }
}
