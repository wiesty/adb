import type { AutoDnsResourceRecord, AutoDnsZone } from "../api/schemas.js";
import { toAsciiDomain } from "../utils/path.js";

export interface BindExport {
  zoneFile: string;
  warnings: string[];
}

const supported = new Set(["A", "AAAA", "CNAME", "MX", "TXT", "SRV", "CAA", "NS", "PTR", "SOA"]);

export function exportBind(zone: AutoDnsZone): BindExport {
  const warnings: string[] = [];
  const origin = fqdn(toAsciiDomain(zone.origin));
  const lines = [`$ORIGIN ${origin}`, "$TTL 3600"];
  const records = zone.resourceRecords ?? [];
  for (const record of records) {
    const type = record.type.toUpperCase();
    if (!supported.has(type)) {
      if (record.raw) lines.push(record.raw);
      else {
        warnings.push(`unsupported record type ${type} for ${record.name ?? "@"}`);
        lines.push(`; unsupported ${type} ${record.name ?? "@"} ${record.value ?? ""}`.trim());
      }
      continue;
    }
    lines.push(renderRecord(record, origin));
  }
  return { zoneFile: `${lines.join("\n")}\n`, warnings };
}

function renderRecord(record: AutoDnsResourceRecord, origin: string): string {
  const name = renderName(record.name, origin);
  const ttl = record.ttl ?? 3600;
  const type = record.type.toUpperCase();
  const value = record.value ?? "";
  if (type === "MX") return `${name} ${ttl} IN MX ${record.pref ?? 10} ${fqdnValue(value)}`;
  if (type === "TXT") return `${name} ${ttl} IN TXT ${renderTxt(value)}`;
  if (type === "SRV") return `${name} ${ttl} IN SRV ${renderSrv(record, value)}`;
  if (["CNAME", "NS", "PTR"].includes(type)) return `${name} ${ttl} IN ${type} ${fqdnValue(value)}`;
  if (type === "SOA") return `${name} ${ttl} IN SOA ${value}`;
  return `${name} ${ttl} IN ${type} ${value}`;
}

function renderName(name: string | undefined, origin: string): string {
  if (!name || name === "@" || name === origin.replace(/\.$/, "")) return "@";
  return fqdnValue(toAsciiDomain(name));
}

function fqdn(name: string): string {
  return name.endsWith(".") ? name : `${name}.`;
}

function fqdnValue(value: string): string {
  if (!value || value === "@") return "@";
  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(value) || value.includes(":")) return value;
  return fqdn(toAsciiDomain(value));
}

function renderTxt(value: string): string {
  const parts = value.match(/.{1,255}/g) ?? [""];
  return parts.map((part) => `"${part.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`).join(" ");
}

function renderSrv(record: AutoDnsResourceRecord, value: string): string {
  const tokens = value.trim().split(/\s+/);
  if (tokens.length >= 4)
    return `${tokens[0]} ${tokens[1]} ${tokens[2]} ${fqdnValue(tokens.slice(3).join(" "))}`;
  const priority = record.pref ?? 0;
  return `${priority} 0 0 ${fqdnValue(value)}`;
}
