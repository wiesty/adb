import type { AppConfig } from "../config/config.js";
import { AutoDnsAuthError, AutoDnsHttpError } from "../api/errors.js";
import type { AutoDnsClient } from "../api/client.js";
import type { BackupRepository } from "../database/repository.js";
import type { Logger } from "../monitoring/logger.js";
import { sendAlert } from "../monitoring/webhook.js";
import { exportBind } from "../bind/exporter.js";
import { buildManifest } from "../manifest/manifest.js";
import type { StorageDriver } from "../storage/storage.js";
import { GitExportWriter } from "../storage/gitExport.js";
import { canonicalZonePayload, gzipJson, sha256Hex } from "../utils/hash.js";
import { pathSegment, safeJoinKey } from "../utils/path.js";
import { daysAgo, timestampForPath } from "../utils/time.js";
import { sanitizeError } from "../security/redact.js";
import { refreshInventory } from "../inventory/inventory.js";

export class BackupRunner {
  constructor(
    private readonly config: AppConfig,
    private readonly repo: BackupRepository,
    private readonly client: AutoDnsClient,
    private readonly storage: StorageDriver,
    private readonly logger: Logger
  ) {}

  async run(
    type: "inventory" | "incremental" | "full"
  ): Promise<{ runId: string; success: boolean }> {
    await this.storage.cleanupTemp?.();
    const gitExport = GitExportWriter.fromConfig(this.config);
    await gitExport.cleanupTemp();
    this.repo.resetOrphanRunningJobs();
    const existing = this.repo.findIncompleteRun(type);
    const runId = existing ?? this.repo.createRun(type);
    this.logger.info({ runId, type, resumed: Boolean(existing) }, "backup run started");
    try {
      if (!existing || type === "inventory") {
        const inventory = await refreshInventory({
          client: this.client,
          repo: this.repo,
          storage: this.storage,
          runId,
          pageSize: this.config.INVENTORY_PAGE_SIZE,
          missingConfirmationRuns: this.config.MISSING_CONFIRMATION_RUNS,
          maxDropPercent: this.config.MAX_INVENTORY_DROP_PERCENT
        });
        this.logger.info(
          { runId, inventoryCount: inventory.count, missingCount: inventory.missingCount },
          "inventory refreshed"
        );
      }
      if (type !== "inventory") this.enqueueJobs(runId, type);
      if (type !== "inventory") await this.processJobs(runId, gitExport);
      const failed = this.repo.jobRows(runId).filter((job) => job.status === "failed").length;
      const manifest = buildManifest(this.repo, runId);
      await gitExport.writeIndex({
        schemaVersion: 1,
        generatedAt: new Date().toISOString(),
        runId,
        zones: manifest.zones
      });
      const manifestKey = `manifests/${timestampForPath()}.json`;
      const manifestBody = JSON.stringify(manifest, null, 2);
      const stored = await this.storage.putObject(manifestKey, manifestBody, "application/json");
      this.repo.addBackupObject({
        objectKey: manifestKey,
        runId,
        kind: "manifest",
        sha256: stored.sha256,
        compressedSize: stored.size,
        storageDriver: this.storage.name
      });
      const success = failed <= this.config.MAX_FAILED_ZONES;
      this.repo.finishRun(
        runId,
        success ? "completed" : "failed",
        manifestKey,
        success ? undefined : "too many failed zones"
      );
      if (!success) {
        await sendAlert(this.config.ALERT_WEBHOOK_URL, this.logger, {
          severity: "critical",
          event: "backup_incomplete",
          runId,
          failed
        });
      }
      return { runId, success };
    } catch (error) {
      const sanitized = sanitizeError(error);
      this.repo.recordError(
        runId,
        undefined,
        "critical",
        String(sanitized.message ?? "backup run failed"),
        sanitized
      );
      this.repo.finishRun(runId, "failed", undefined, String(sanitized.message ?? error));
      await sendAlert(this.config.ALERT_WEBHOOK_URL, this.logger, {
        severity: "critical",
        event: error instanceof AutoDnsAuthError ? "auth_failed" : "backup_failed",
        runId,
        error: sanitized
      });
      throw error;
    }
  }

  private enqueueJobs(runId: string, type: "incremental" | "full"): void {
    const forceBefore = daysAgo(this.config.FORCE_REEXPORT_AFTER_DAYS);
    for (const zone of this.repo.visibleInventory()) {
      const needs =
        type === "full" ||
        !zone.last_successful_backup_at ||
        !zone.last_content_hash ||
        !zone.last_object_key ||
        String(zone.last_successful_backup_at) < forceBefore ||
        zone.metadata_hash !== zone.last_backed_up_metadata_hash;
      this.repo.enqueueJob(runId, zone, needs ? type : "unchanged", !needs);
    }
    this.repo.updateRunCounts(runId);
  }

  private async processJobs(runId: string, gitExport: GitExportWriter): Promise<void> {
    const workers = Array.from({ length: this.config.BACKUP_CONCURRENCY }, () =>
      this.worker(runId, gitExport)
    );
    await Promise.all(workers);
    this.repo.updateRunCounts(runId);
  }

  private async worker(runId: string, gitExport: GitExportWriter): Promise<void> {
    while (true) {
      const job = this.repo.claimNextJob(runId);
      if (!job) return;
      const log = this.logger.child({
        runId,
        zoneId: job.zone_key,
        origin: job.origin,
        virtualNameServer: job.virtual_name_server
      });
      try {
        const response = await this.client.getZoneInfo(job.origin, job.virtual_name_server);
        const zone = response.data[0];
        if (!zone) throw new Error("AutoDNS zone detail response contained no zone");
        const contentHash = sha256Hex(canonicalZonePayload(response));
        const latest = this.repo.latestObjectForZone(job.zone_key);
        const recordCount = zone.resourceRecords?.length ?? 0;
        const exportedAt = new Date().toISOString();
        const wrapper = {
          schemaVersion: 1,
          exportedAt,
          source: {
            provider: "AutoDNS",
            origin: job.origin,
            virtualNameServer: job.virtual_name_server,
            sourceUpdatedAt: zone.updated,
            transactionId: response.stid
          },
          zone: response
        };
        const bind = exportBind(zone);
        if (latest?.content_hash === contentHash) {
          await gitExport.writeZone({
            origin: job.origin,
            virtualNameServer: job.virtual_name_server,
            wrapper,
            bindZoneFile: bind.zoneFile,
            manifestEntry: {
              schemaVersion: 1,
              origin: job.origin,
              virtualNameServer: job.virtual_name_server,
              sourceUpdatedAt: zone.updated,
              contentHash,
              authoritativeCompressedObjectKey: latest.object_key,
              recordCount,
              warnings: bind.warnings,
              deduplicated: true
            }
          });
          this.repo.skipCompletedDuplicate(job.id, latest.object_key, contentHash, recordCount);
          this.repo.markZoneBackedUp(job.zone_key, latest.object_key, contentHash);
          log.info(
            { resultStatus: "deduplicated", objectKey: latest.object_key },
            "zone unchanged"
          );
          continue;
        }
        const compressed = gzipJson(wrapper);
        const compressedSha = sha256Hex(compressed);
        const zonePath = safeJoinKey(
          "zones",
          pathSegment(job.origin, "zone"),
          pathSegment(job.virtual_name_server || "default", "vns"),
          `${timestampForPath()}.json.gz`
        );
        const stored = await this.storage.putObject(zonePath, compressed, "application/gzip");
        if (stored.sha256 !== compressedSha)
          throw new Error(`stored hash mismatch for ${zonePath}`);
        let bindObjectKey: string | undefined;
        if (bind.zoneFile.trim()) {
          bindObjectKey = safeJoinKey(
            "bind",
            pathSegment(job.origin, "zone"),
            `${timestampForPath()}.zone`
          );
          await this.storage.putObject(bindObjectKey, bind.zoneFile, "text/dns");
        }
        await gitExport.writeZone({
          origin: job.origin,
          virtualNameServer: job.virtual_name_server,
          wrapper,
          bindZoneFile: bind.zoneFile,
          manifestEntry: {
            schemaVersion: 1,
            origin: job.origin,
            virtualNameServer: job.virtual_name_server,
            sourceUpdatedAt: zone.updated,
            contentHash,
            authoritativeCompressedObjectKey: zonePath,
            bindObjectKey,
            recordCount,
            warnings: bind.warnings
          }
        });
        this.repo.transaction(() => {
          this.repo.completeJob(job.id, {
            objectKey: zonePath,
            bindObjectKey,
            contentHash,
            compressedSha256: compressedSha,
            compressedSize: compressed.length,
            recordCount,
            warnings: bind.warnings
          });
          this.repo.addBackupObject({
            objectKey: zonePath,
            runId,
            zoneKey: job.zone_key,
            kind: "zone-json",
            sha256: compressedSha,
            contentHash,
            compressedSize: compressed.length,
            storageDriver: this.storage.name,
            transactionId: response.stid
          });
          this.repo.markZoneBackedUp(job.zone_key, zonePath, contentHash);
        });
        log.info({ resultStatus: "completed", objectKey: zonePath, recordCount }, "zone exported");
      } catch (error) {
        const sanitized = sanitizeError(error);
        if (error instanceof AutoDnsHttpError && error.status === 404) {
          this.repo.markZoneDeleted(
            job.id,
            "zone not found during detail fetch; inventory should be refreshed"
          );
          log.warn({ resultStatus: "deleted" }, "zone returned 404");
          continue;
        }
        if (error instanceof AutoDnsAuthError) throw error;
        if (job.attempts <= this.config.BACKUP_MAX_RETRIES) {
          this.repo.retryJob(
            job.id,
            String(sanitized.message ?? error),
            Math.min(30000, 500 * 2 ** job.attempts)
          );
        } else {
          this.repo.failJob(job.id, String(sanitized.message ?? error));
          this.repo.recordError(
            runId,
            job.zone_key,
            "error",
            String(sanitized.message ?? "zone export failed"),
            sanitized
          );
        }
        log.error({ error: sanitized, resultStatus: "failed" }, "zone export failed");
      }
    }
  }
}
