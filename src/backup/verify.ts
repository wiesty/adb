import type { BackupRepository } from "../database/repository.js";
import type { StorageDriver } from "../storage/storage.js";

export async function verifyBackups(repo: BackupRepository, storage: StorageDriver): Promise<{
  checked: number;
  failed: Array<{ objectKey: string; reason: string }>;
}> {
  const failed: Array<{ objectKey: string; reason: string }> = [];
  const objects = repo.allBackupObjects();
  for (const object of objects) {
    const key = String(object.object_key);
    const head = await storage.headObject(key);
    if (!head.exists) failed.push({ objectKey: key, reason: "missing object" });
    if (head.size !== undefined && head.size !== Number(object.compressed_size)) {
      failed.push({ objectKey: key, reason: "size mismatch" });
    }
    if (head.sha256 && head.sha256 !== object.sha256) {
      failed.push({ objectKey: key, reason: "sha256 mismatch" });
    }
  }
  return { checked: objects.length, failed };
}
