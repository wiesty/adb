import type { AutoDnsClient } from "../api/client.js";
import type { AutoDnsZone } from "../api/schemas.js";
import type { BackupRepository } from "../database/repository.js";
import { gzipJson, sha256Hex, stableStringify } from "../utils/hash.js";
import { toAsciiDomain, zoneKey } from "../utils/path.js";
import { timestampForPath } from "../utils/time.js";
import type { StorageDriver } from "../storage/storage.js";

export async function refreshInventory(args: {
  client: AutoDnsClient;
  repo: BackupRepository;
  storage: StorageDriver;
  runId: string;
  pageSize: number;
  missingConfirmationRuns: number;
  maxDropPercent: number;
}): Promise<{ count: number; inventoryKey: string; missingCount: number }> {
  const previous = args.repo.previousVisibleCount(args.runId);
  let offset = 0;
  let count = 0;
  const all: AutoDnsZone[] = [];
  while (true) {
    const response = await args.client.listZones(offset, args.pageSize);
    for (const zone of response.data) {
      const vns = zone.virtualNameServer ?? "";
      const key = zoneKey(zone.origin, vns);
      const metadata = {
        origin: zone.origin,
        idn: zone.idn,
        virtualNameServer: vns,
        created: zone.created,
        updated: zone.updated,
        dnssec: zone.dnssec,
        domainsafe: zone.domainsafe,
        action: zone.action,
        roid: zone.roid
      };
      args.repo.upsertInventoryZone(args.runId, {
        zoneKey: key,
        origin: zone.origin,
        originAscii: toAsciiDomain(zone.origin),
        virtualNameServer: vns,
        createdAt: zone.created,
        updatedAt: zone.updated,
        statusJson: JSON.stringify(metadata),
        metadataHash: sha256Hex(stableStringify(metadata))
      });
      all.push(zone);
      count++;
    }
    if (response.data.length < args.pageSize) break;
    offset += args.pageSize;
  }
  if (previous && previous > 0 && count < previous) {
    const dropPercent = ((previous - count) / previous) * 100;
    if (dropPercent > args.maxDropPercent) {
      throw new Error(
        `inventory count dropped from ${previous} to ${count} (${dropPercent.toFixed(2)}%), exceeds configured limit`
      );
    }
  }
  args.repo.setInventoryCount(args.runId, count);
  const missingCount = args.repo.markMissingZones(args.runId, args.missingConfirmationRuns);
  const body = gzipJson({
    schemaVersion: 1,
    runId: args.runId,
    exportedAt: new Date().toISOString(),
    zones: all
  });
  const inventoryKey = `inventories/${timestampForPath()}.json.gz`;
  await args.storage.putObject(inventoryKey, body, "application/gzip");
  args.repo.addBackupObject({
    objectKey: inventoryKey,
    runId: args.runId,
    kind: "inventory",
    sha256: sha256Hex(body),
    compressedSize: body.length,
    storageDriver: args.storage.name
  });
  return { count, inventoryKey, missingCount };
}
