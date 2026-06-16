# syntax=docker/dockerfile:1.7
FROM node:22-bookworm-slim AS deps
WORKDIR /app
COPY package.json pnpm-lock.yaml* ./
RUN corepack enable && pnpm install --frozen-lockfile=false

FROM node:22-bookworm-slim AS build
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN corepack enable && pnpm build
RUN pnpm prune --prod

FROM node:22-bookworm-slim AS runtime
LABEL org.opencontainers.image.title="autodns-backup" \
  org.opencontainers.image.description="Export-only InterNetX AutoDNS DNS zone backup client" \
  org.opencontainers.image.source="https://github.com/wiesty/adb" \
  org.opencontainers.image.licenses="PolyForm-Internal-Use-1.0.0"
ENV NODE_ENV=production \
  BACKUP_MODE=incremental \
  DATABASE_PATH=/data/backup.sqlite \
  WORK_DIRECTORY=/data/work \
  LOCAL_BACKUP_PATH=/backup \
  GIT_EXPORT_PATH=/git-export
WORKDIR /app
RUN useradd --system --uid 10001 --home /app autodns \
  && mkdir -p /data/work /backup /git-export \
  && chown -R autodns:autodns /app /data /backup /git-export
COPY --from=build --chown=autodns:autodns /app/dist ./dist
COPY --from=build --chown=autodns:autodns /app/package.json ./package.json
COPY --from=build --chown=autodns:autodns /app/node_modules ./node_modules
USER autodns
VOLUME ["/data", "/backup", "/git-export"]
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 CMD node --experimental-sqlite dist/src/cli/index.js status >/dev/null || exit 1
ENTRYPOINT ["node", "--experimental-sqlite", "dist/src/cli/index.js"]
