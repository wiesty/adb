import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { GitExportWriter } from "../../src/storage/gitExport.js";

describe("GitExportWriter", () => {
  it("writes stable pretty JSON paths for git diffs", async () => {
    const dir = mkdtempSync(join(tmpdir(), "autodns-git-export-"));
    try {
      const writer = new GitExportWriter(true, dir, true);
      const result = await writer.writeZone({
        origin: "münich.example",
        virtualNameServer: "ns1.example",
        wrapper: { schemaVersion: 1, zone: { data: [{ origin: "münich.example" }] } },
        bindZoneFile: "$ORIGIN xn--mnich-kva.example.\n"
      });
      expect(result.jsonPath).toMatch(
        /zones\/xn--mnich-kva\.example-[a-f0-9]{12}\/ns1\.example-[a-f0-9]{12}\/zone\.json/
      );
      const json = readFileSync(join(dir, result.jsonPath!), "utf8");
      expect(json).toContain('\n  "schemaVersion": 1');
      expect(readFileSync(join(dir, result.bindPath!), "utf8")).toContain("$ORIGIN");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
