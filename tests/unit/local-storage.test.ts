import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { LocalStorageDriver } from "../../src/storage/local.js";

describe("local storage", () => {
  it("writes atomically and verifies hash", async () => {
    const dir = mkdtempSync(join(tmpdir(), "autodns-backup-"));
    try {
      const storage = new LocalStorageDriver(dir);
      const stored = await storage.putObject(
        "zones/example.json",
        Buffer.from("hello"),
        "text/plain"
      );
      const head = await storage.headObject("zones/example.json");
      expect(head).toMatchObject({ exists: true, size: 5, sha256: stored.sha256 });
      expect(await storage.getObject("zones/example.json")).toEqual(Buffer.from("hello"));
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
