import type { AppConfig } from "../config/config.js";
import { LocalStorageDriver } from "./local.js";
import { S3StorageDriver } from "./s3.js";
import type { StorageDriver } from "./storage.js";

export function createStorage(config: AppConfig): StorageDriver {
  return config.STORAGE_DRIVER === "local"
    ? new LocalStorageDriver(config.LOCAL_BACKUP_PATH)
    : new S3StorageDriver(config);
}
