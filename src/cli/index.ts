#!/usr/bin/env node
import { Command, Option } from "commander";
import { loadDotEnvFile } from "../config/dotenv.js";
import { openDatabase } from "../database/schema.js";
import { BackupRepository } from "../database/repository.js";
import { loadConfig, publicConfig } from "../config/config.js";
import { createLogger } from "../monitoring/logger.js";
import { createStorage } from "../storage/factory.js";
import { AutoDnsClient } from "../api/client.js";
import { BackupRunner } from "../backup/runner.js";
import { verifyBackups } from "../backup/verify.js";
import { toAsciiDomain, zoneKey } from "../utils/path.js";
import { gunzipJson } from "../utils/hash.js";
import { exportBind } from "../bind/exporter.js";
import { AutoDnsAuthError } from "../api/errors.js";
import { renderStartupBanner } from "./banner.js";
import { z } from "zod";

const ExitCode = {
  Ok: 0,
  General: 1,
  Config: 2,
  Auth: 3,
  Incomplete: 4,
  Integrity: 5,
  Storage: 6
} as const;

loadDotEnvFile();

async function withContext<T>(
  fn: (ctx: Awaited<ReturnType<typeof createContext>>) => Promise<T>
): Promise<T> {
  const config = loadConfig();
  renderStartupBanner(config);
  const logger = createLogger(config);
  logger.debug({ config: publicConfig(config) }, "configuration loaded");
  const db = openDatabase(config.DATABASE_PATH);
  const repo = new BackupRepository(db);
  const storage = createStorage(config);
  const client = new AutoDnsClient(config, {
    onAttempt: (attempt) => repo.recordApiAttempt(undefined, undefined, attempt)
  });
  return fn({ config, logger, repo, storage, client });
}

async function createContext() {
  const config = loadConfig();
  renderStartupBanner(config);
  const logger = createLogger(config);
  const db = openDatabase(config.DATABASE_PATH);
  const repo = new BackupRepository(db);
  const storage = createStorage(config);
  const client = new AutoDnsClient(config);
  return { config, logger, repo, storage, client };
}

async function runBackup(mode: "inventory" | "incremental" | "full"): Promise<void> {
  await withContext(async ({ config, repo, storage, client, logger }) => {
    const runner = new BackupRunner(config, repo, client, storage, logger);
    const result = await runner.run(mode);
    process.exitCode = result.success ? ExitCode.Ok : ExitCode.Incomplete;
  });
}

async function runVerify(): Promise<void> {
  await withContext(async ({ repo, storage }) => {
    const result = await verifyBackups(repo, storage);
    console.log(JSON.stringify(result, null, 2));
    process.exitCode = result.failed.length ? ExitCode.Integrity : ExitCode.Ok;
  });
}

async function runStatus(): Promise<void> {
  await withContext(async ({ repo }) => {
    console.log(JSON.stringify(repo.statusSummary(), null, 2));
  });
}

async function runConfiguredMode(): Promise<void> {
  const mode = process.env.BACKUP_MODE ?? "incremental";
  if (mode === "inventory" || mode === "incremental" || mode === "full") {
    await runBackup(mode);
    return;
  }
  if (mode === "verify") {
    await runVerify();
    return;
  }
  if (mode === "status") {
    await runStatus();
    return;
  }
  throw new Error(`unsupported BACKUP_MODE: ${mode}`);
}

const program = new Command();
program
  .name("autodns-backup")
  .description("Export-only AutoDNS DNS zone backup client")
  .version("1.0.0");

program.action(() => main(runConfiguredMode));

program
  .command("inventory")
  .description("Refresh paginated AutoDNS zone inventory")
  .action(() => main(() => runBackup("inventory")));
program
  .command("incremental")
  .description("Run resumable incremental backup")
  .action(() => main(() => runBackup("incremental")));
program
  .command("full")
  .description("Run resumable full backup")
  .action(() => main(() => runBackup("full")));

program
  .command("verify")
  .description("Verify stored backup objects against SQLite metadata")
  .action(() => main(runVerify));

program
  .command("status")
  .description("Show local backup status")
  .action(() => main(runStatus));

program
  .command("restore-preview")
  .description("Show available backup metadata for a zone. Does not restore anything.")
  .addOption(new Option("--zone <zone>", "zone origin").makeOptionMandatory())
  .action((opts: { zone: string }) =>
    main(async () => {
      await withContext(async ({ repo }) => {
        console.log(JSON.stringify(repo.latestObjectsForOrigin(toAsciiDomain(opts.zone)), null, 2));
      });
    })
  );

program
  .command("export-bind")
  .description("Render the latest JSON backup for a zone as BIND zone text")
  .addOption(new Option("--zone <zone>", "zone origin").makeOptionMandatory())
  .option("--virtual-name-server <name>", "virtual nameserver")
  .action((opts: { zone: string; virtualNameServer?: string }) =>
    main(async () => {
      await withContext(async ({ repo, storage }) => {
        const rows = repo.latestObjectsForOrigin(toAsciiDomain(opts.zone));
        const row = opts.virtualNameServer
          ? rows.find((entry) => entry.virtual_name_server === opts.virtualNameServer)
          : rows[0];
        if (!row?.last_object_key) throw new Error("no backup data found for zone");
        const wrapper = z
          .object({ zone: z.object({ data: z.array(z.unknown()) }).passthrough() })
          .passthrough()
          .parse(gunzipJson(await storage.getObject(String(row.last_object_key))));
        const zone = wrapper.zone.data[0];
        if (!zone || typeof zone !== "object")
          throw new Error("backup object does not contain a zone");
        const bind = exportBind(zone as never);
        console.log(bind.zoneFile);
        if (bind.warnings.length) console.error(JSON.stringify({ warnings: bind.warnings }));
      });
    })
  );

async function main(fn: () => Promise<void>): Promise<void> {
  try {
    await fn();
  } catch (error) {
    if (error instanceof z.ZodError) {
      console.error(
        JSON.stringify(
          { error: "configuration or validation error", issues: error.issues },
          null,
          2
        )
      );
      process.exitCode = ExitCode.Config;
      return;
    }
    if (error instanceof AutoDnsAuthError) {
      console.error(JSON.stringify({ error: "authentication failed" }));
      process.exitCode = ExitCode.Auth;
      return;
    }
    console.error(
      JSON.stringify({ error: error instanceof Error ? error.message : String(error) })
    );
    process.exitCode = ExitCode.General;
  }
}

void program.parseAsync(process.argv);

export { ExitCode, zoneKey };
