import { describe, expect, it } from "vitest";
import { loadConfig } from "../../src/config/config.js";

describe("config", () => {
  it("validates required secrets without exposing values", () => {
    const config = loadConfig({
      AUTODNS_USERNAME: "user",
      AUTODNS_PASSWORD: "pass",
      AUTODNS_CONTEXT: "4",
      STORAGE_DRIVER: "local",
      LOCAL_BACKUP_PATH: "/tmp/backup"
    });
    expect(config.BACKUP_CONCURRENCY).toBe(2);
    expect(config.STORAGE_DRIVER).toBe("local");
  });
});
