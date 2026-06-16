import { mkdirSync, readdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { sha256Hex } from "../utils/hash.js";
import type { StorageDriver, StoredObject } from "./storage.js";

export class LocalStorageDriver implements StorageDriver {
  readonly name = "local" as const;

  constructor(private readonly root: string) {}

  async putObject(key: string, body: Buffer | string, _contentType: string): Promise<StoredObject> {
    const target = this.resolve(key);
    mkdirSync(dirname(target), { recursive: true });
    const buffer = Buffer.isBuffer(body) ? body : Buffer.from(body, "utf8");
    const tmp = `${target}.tmp-${process.pid}-${Date.now()}`;
    writeFileSync(tmp, buffer, { flag: "wx" });
    const written = readFileSync(tmp);
    const sha = sha256Hex(written);
    if (sha !== sha256Hex(buffer)) throw new Error(`hash mismatch while writing ${key}`);
    renameSync(tmp, target);
    return { key, size: buffer.length, sha256: sha };
  }

  async headObject(key: string): Promise<{ exists: boolean; size?: number; sha256?: string }> {
    try {
      const buffer = readFileSync(this.resolve(key));
      return { exists: true, size: buffer.length, sha256: sha256Hex(buffer) };
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return { exists: false };
      throw error;
    }
  }

  async getObject(key: string): Promise<Buffer> {
    return readFileSync(this.resolve(key));
  }

  async cleanupTemp(): Promise<void> {
    cleanupDir(this.root);
  }

  private resolve(key: string): string {
    if (key.startsWith("/") || key.includes("..") || key.includes("\\")) {
      throw new Error(`unsafe storage key: ${key}`);
    }
    return join(this.root, key);
  }
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
