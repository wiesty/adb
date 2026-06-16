import { createHash } from "node:crypto";
import { gzipSync, gunzipSync } from "node:zlib";

export function sha256Hex(buffer: Buffer | string): string {
  return createHash("sha256").update(buffer).digest("hex");
}

export function gzipJson(value: unknown): Buffer {
  return gzipSync(Buffer.from(JSON.stringify(value), "utf8"), { level: 9 });
}

export function gunzipJson<T = unknown>(buffer: Buffer): T {
  return JSON.parse(gunzipSync(buffer).toString("utf8")) as T;
}

export function stableStringify(value: unknown): string {
  return JSON.stringify(sortDeep(value));
}

function sortDeep(value: unknown): unknown {
  if (Array.isArray(value)) return value.map((entry) => sortDeep(entry));
  if (!value || typeof value !== "object") return value;
  const obj = value as Record<string, unknown>;
  return Object.keys(obj)
    .sort()
    .reduce<Record<string, unknown>>((acc, key) => {
      acc[key] = sortDeep(obj[key]);
      return acc;
    }, {});
}

const volatileKeys = new Set(["stid", "ctid", "date", "transactionId"]);

export function canonicalZonePayload(zoneResponse: unknown): string {
  return stableStringify(stripVolatile(zoneResponse));
}

function stripVolatile(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stripVolatile);
  if (!value || typeof value !== "object") return value;
  const out: Record<string, unknown> = {};
  for (const [key, entry] of Object.entries(value)) {
    if (volatileKeys.has(key)) continue;
    out[key] = stripVolatile(entry);
  }
  return out;
}
