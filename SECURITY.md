# Security Policy

## Scope

This project is an export-only backup client for InterNetX AutoDNS DNS zones. It is intended to run as
a private backend job, not as a public service.

The client does not expose an HTTP server and does not need inbound network access.

## Supported Versions

Security fixes are provided for the current `main` branch and the latest published container image
tag. If versioned releases are used, only the latest minor release is supported unless otherwise
documented.

## Reporting A Vulnerability

Please do not open public issues for vulnerabilities involving credentials, backup data, path handling,
storage permissions or AutoDNS access.

Report privately to the project maintainer or owning organization through the agreed internal security
channel. Include:

- affected commit, tag or image digest
- reproduction steps
- expected and actual behavior
- impact assessment
- whether credentials, zone data or object storage access may have been exposed

Rotate any potentially exposed credentials immediately.

## Operational Security Requirements

- Run the container only in a private environment.
- Do not expose the container to the public internet.
- Do not publish `.env` files, SQLite databases, manifests, compressed backups or `git-export/` data.
- Use a dedicated AutoDNS API user with read-only permissions.
- Store secrets in environment variables, Docker secrets, CI secrets or secret files.
- Do not pass secrets as CLI arguments.
- Do not bake secrets into Docker images.
- Use private repositories for Git exports.
- Prefer S3/Object Storage versioning and Object Lock for retention.
- Do not grant delete permissions to the backup client.

## Network Security

The client needs outbound access to:

- AutoDNS API
- S3-compatible object storage, if `STORAGE_DRIVER=s3`
- optional alert webhook

It does not need inbound access. Firewall rules should block unsolicited inbound traffic.

## Secret Handling

The application attempts to prevent secrets from being written to:

- logs
- SQLite
- manifests
- backup files
- webhook payloads

Still, operators must protect all runtime files and volumes because DNS zone data itself can be
sensitive.

## Public CI Warning

Do not run production backups on public or untrusted CI runners. Use runners and infrastructure you
control.
