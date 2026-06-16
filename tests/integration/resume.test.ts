import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { openDatabase } from "../../src/database/schema.js";
import { BackupRepository } from "../../src/database/repository.js";

describe("SQLite queue resume", () => {
  it("resets orphan running jobs and ignores duplicate jobs", () => {
    const dir = mkdtempSync(join(tmpdir(), "autodns-db-"));
    try {
      const repo = new BackupRepository(openDatabase(join(dir, "backup.sqlite")));
      const runId = repo.createRun("full");
      repo.upsertInventoryZone(runId, {
        zoneKey: "example.com\u0000ns",
        origin: "example.com",
        originAscii: "example.com",
        virtualNameServer: "ns",
        metadataHash: "meta",
        statusJson: "{}"
      });
      const zone = repo.visibleInventory()[0]!;
      repo.enqueueJob(runId, zone, "full");
      repo.enqueueJob(runId, zone, "full");
      const claimed = repo.claimNextJob(runId)!;
      expect(claimed.status).toBe("running");
      repo.resetOrphanRunningJobs();
      const rows = repo.jobRows(runId);
      expect(rows).toHaveLength(1);
      expect(rows[0]!.status).toBe("retry");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
