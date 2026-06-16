# AutoDNS Backup Client

Export-only backup client for InterNetX AutoDNS DomainRobot DNS zones.

The client only reads existing zones and writes backups. It does not create, update, import, restore
or delete AutoDNS zones. The authoritative backup is compressed JSON; BIND files and Git-friendly JSON
files are additional export formats.

## What It Does

- lists all visible DNS zones via AutoDNS pagination
- fetches full zone detail responses
- supports incremental and full backups
- resumes interrupted runs through SQLite
- writes gzip JSON backups to local storage or S3-compatible storage
- optionally writes stable pretty JSON files for Git diffs
- optionally writes BIND zone files
- verifies stored objects and emits structured logs

## Quickstart

### Docker Image

```bash
docker pull ghcr.io/wiesty/adb:latest
cp .env.example .env
```

Fill `.env`, then run a one-shot backup:

```bash
docker run --rm --env-file .env \
  -e BACKUP_MODE=incremental \
  -v autodns-data:/data \
  -v "$PWD/backup:/backup" \
  -v "$PWD/git-export:/git-export" \
  ghcr.io/wiesty/adb:latest
```

Select the command with `BACKUP_MODE`:

```env
BACKUP_MODE=inventory
BACKUP_MODE=incremental
BACKUP_MODE=full
BACKUP_MODE=verify
BACKUP_MODE=status
```

The container is a private one-shot job. It exposes no ports and should not be run as a public
service.

### Local Development

```bash
pnpm install
pnpm build
cp .env.example .env
```

Fill `.env`, then run:

```bash
node --experimental-sqlite dist/src/cli/index.js inventory
node --experimental-sqlite dist/src/cli/index.js incremental
node --experimental-sqlite dist/src/cli/index.js verify
```

Local Docker build:

```bash
docker build -t ghcr.io/wiesty/adb:local .
docker run --rm --env-file .env \
  -e BACKUP_MODE=incremental \
  -v autodns-data:/data \
  -v "$PWD/backup:/backup" \
  -v "$PWD/git-export:/git-export" \
  ghcr.io/wiesty/adb:local
```

## CLI

```bash
autodns-backup inventory
autodns-backup incremental
autodns-backup full
autodns-backup verify
autodns-backup status
autodns-backup export-bind --zone example.com
autodns-backup restore-preview --zone example.com
```

`restore-preview` only shows available backup data. There is no automatic restore command.

## Docs

The extended documentation is written so each page can be copied directly into a GitHub Wiki. Suggested
wiki page names:

- [Home](https://github.com/wiesty/adb/wiki)
- [Configuration](https://github.com/wiesty/adb/wiki/Configuration)
- [Licensing](https://github.com/wiesty/adb/wiki/Licensing)
- [Docker Image](https://github.com/wiesty/adb/wiki/Docker-Image)
- [AutoDNS API](https://github.com/wiesty/adb/wiki/AutoDNS-API)
- [AutoDNS Permissions](https://github.com/wiesty/adb/wiki/AutoDNS-Permissions)
- [Backup Format](https://github.com/wiesty/adb/wiki/Backup-Format)
- [Storage](https://github.com/wiesty/adb/wiki/Storage)
- [Git Export](https://github.com/wiesty/adb/wiki/Git-Export)
- [Operations](https://github.com/wiesty/adb/wiki/Operations)
- [Security](https://github.com/wiesty/adb/wiki/Security)

## Important Defaults

```env
BACKUP_CONCURRENCY=2
BACKUP_REQUESTS_PER_SECOND=2
BACKUP_REQUEST_TIMEOUT_MS=30000
BACKUP_MAX_RETRIES=5
FORCE_REEXPORT_AFTER_DAYS=7
STORAGE_DRIVER=s3
GIT_EXPORT_ENABLED=true
```

AutoDNS documents 3 requests per second per IP. This client defaults to 2.

## Safety Notes

- Use a dedicated AutoDNS API user with read-only permissions.
- Run the container only in a private environment; do not expose it publicly.
- Do not pass credentials as CLI arguments.
- Secrets are not written to SQLite, manifests, backups, logs or webhook payloads.
- The client never deletes backup objects.
- DNS zone data can be sensitive; push `git-export/` only to private repositories.
- See [Security](SECURITY.md).

## Validation

```bash
pnpm lint
pnpm typecheck
pnpm test
pnpm build
```
