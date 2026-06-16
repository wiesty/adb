import { mkdirSync, readdirSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import type { AppConfig } from "../config/config.js";
import { pathSegment, safeJoinKey } from "../utils/path.js";

export interface GitExportInput {
  origin: string;
  virtualNameServer: string;
  wrapper: unknown;
  bindZoneFile?: string;
  manifestEntry?: Record<string, unknown>;
}

export class GitExportWriter {
  constructor(
    private readonly enabled: boolean,
    private readonly root: string,
    private readonly writeBind: boolean
  ) {}

  static fromConfig(config: AppConfig): GitExportWriter {
    return new GitExportWriter(
      config.GIT_EXPORT_ENABLED,
      config.GIT_EXPORT_PATH,
      config.GIT_EXPORT_WRITE_BIND
    );
  }

  async cleanupTemp(): Promise<void> {
    if (!this.enabled) return;
    cleanupDir(this.root);
  }

  async writeZone(input: GitExportInput): Promise<{ jsonPath?: string; bindPath?: string }> {
    if (!this.enabled) return {};
    const zoneDir = safeJoinKey(
      "zones",
      pathSegment(input.origin, "zone"),
      pathSegment(input.virtualNameServer || "default", "vns")
    );
    const jsonPath = `${zoneDir}/zone.json`;
    writeAtomic(join(this.root, jsonPath), `${JSON.stringify(input.wrapper, null, 2)}\n`);

    let bindPath: string | undefined;
    if (this.writeBind && input.bindZoneFile !== undefined) {
      bindPath = `${zoneDir}/zone.bind`;
      writeAtomic(join(this.root, bindPath), input.bindZoneFile);
    }

    if (input.manifestEntry) {
      writeAtomic(
        join(this.root, `${zoneDir}/metadata.json`),
        `${JSON.stringify(input.manifestEntry, null, 2)}\n`
      );
    }

    return { jsonPath, bindPath };
  }

  async writeIndex(index: unknown): Promise<void> {
    if (!this.enabled) return;
    writeAtomic(join(this.root, "index.json"), `${JSON.stringify(index, null, 2)}\n`);
  }
}

function writeAtomic(target: string, body: string): void {
  mkdirSync(dirname(target), { recursive: true });
  const tmp = `${target}.tmp-${process.pid}-${Date.now()}`;
  writeFileSync(tmp, body, { flag: "wx", mode: 0o600 });
  renameSync(tmp, target);
}

function cleanupDir(dir: string): void {
  try {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = join(dir, entry.name);
      if (entry.isDirectory()) cleanupDir(full);
      else if (entry.name.includes(".tmp-")) rmSync(full, { force: true });
    }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
}
