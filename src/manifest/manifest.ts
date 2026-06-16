import type { BackupRepository } from "../database/repository.js";

export function buildManifest(repo: BackupRepository, runId: string): Record<string, unknown> {
  const run = repo.runRow(runId);
  const jobs = repo.jobRows(runId);
  return {
    schemaVersion: 1,
    runId,
    type: run.type,
    startedAt: run.started_at,
    completedAt: run.completed_at,
    inventoryCount: run.inventory_count,
    successfulCount: jobs.filter((job) => job.status === "completed").length,
    failedCount: jobs.filter((job) => job.status === "failed").length,
    deletedCount: jobs.filter((job) => job.status === "deleted").length,
    skippedCount: jobs.filter((job) => job.status === "skipped").length,
    zones: jobs.map((job) => ({
      origin: job.origin,
      virtualNameServer: job.virtual_name_server,
      status: job.status,
      reason: job.reason,
      recordCount: job.record_count,
      objectKey: job.object_key,
      bindObjectKey: job.bind_object_key,
      compressedSize: job.compressed_size,
      sha256: job.compressed_sha256,
      contentHash: job.content_hash,
      warnings: job.warning_json ? JSON.parse(String(job.warning_json)) : []
    }))
  };
}
