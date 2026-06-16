import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { openDatabase } from "../../src/database/schema.js";
import { BackupRepository } from "../../src/database/repository.js";
import { refreshInventory } from "../../src/inventory/inventory.js";
import { LocalStorageDriver } from "../../src/storage/local.js";

describe("inventory safety", () => {
  it("rejects unexpectedly large drops", async () => {
    const dir = mkdtempSync(join(tmpdir(), "autodns-inventory-"));
    try {
      const repo = new BackupRepository(openDatabase(join(dir, "backup.sqlite")));
      const storage = new LocalStorageDriver(join(dir, "backup"));
      const oldRun = repo.createRun("inventory");
      repo.setInventoryCount(oldRun, 100);
      repo.finishRun(oldRun, "completed");
      const runId = repo.createRun("inventory");
      const client = {
        listZones: async () => ({ data: [{ origin: "example.com", virtualNameServer: "ns" }] })
      };
      await expect(
        refreshInventory({
          client: client as never,
          repo,
          storage,
          runId,
          pageSize: 500,
          missingConfirmationRuns: 3,
          maxDropPercent: 1
        })
      ).rejects.toThrow(/dropped/);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
